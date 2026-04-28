/**
 * Image generation helper — Gemini 2.5 Flash Image (Imagen)
 *
 * Mantém a mesma assinatura externa da versão Forge para preservar callers.
 *
 * Example usage:
 *   const { url } = await generateImage({ prompt: "A serene landscape" });
 *
 * For editing / reference images:
 *   const { url } = await generateImage({
 *     prompt: "Add a rainbow",
 *     originalImages: [{ url: "https://example.com/photo.jpg" }],
 *   });
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { storagePut } from "../storage";
import { ENV } from "./env";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
};

const MODEL_NAME = "gemini-2.5-flash-image";
const MAX_REF_IMAGES = 4;
const MAX_REF_BYTES = 5 * 1024 * 1024;

let _client: GoogleGenerativeAI | null = null;

function getModel() {
  if (!ENV.geminiImageApiKey) {
    throw new Error("GEMINI_IMAGE_API_KEY is not configured");
  }
  if (!_client) {
    _client = new GoogleGenerativeAI(ENV.geminiImageApiKey);
  }
  return _client.getGenerativeModel({ model: MODEL_NAME });
}

type FetchedImage = { b64Json: string; mimeType: string };

async function fetchUrlAsBase64(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_REF_BYTES) return null;
    return {
      b64Json: buf.toString("base64"),
      mimeType: contentType.startsWith("image/") ? contentType : "image/jpeg",
    };
  } catch {
    return null;
  }
}

export async function generateImage(
  options: GenerateImageOptions,
): Promise<GenerateImageResponse> {
  if (!ENV.geminiImageApiKey) {
    throw new Error("GEMINI_IMAGE_API_KEY is not configured");
  }

  const refs = (options.originalImages ?? []).slice(0, MAX_REF_IMAGES);
  const parts: any[] = [];

  for (const img of refs) {
    if (img.b64Json) {
      parts.push({
        inlineData: {
          data: img.b64Json,
          mimeType: img.mimeType ?? "image/jpeg",
        },
      });
      continue;
    }
    if (img.url) {
      const fetched = await fetchUrlAsBase64(img.url);
      if (!fetched) continue;
      parts.push({
        inlineData: {
          data: fetched.b64Json,
          mimeType: img.mimeType ?? fetched.mimeType,
        },
      });
    }
  }

  parts.push({ text: options.prompt });

  const model = getModel();
  const result = await model.generateContent({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  } as any);

  const candidates: any[] = (result.response as any)?.candidates ?? [];
  let inlineData: { data: string; mimeType: string } | null = null;
  for (const c of candidates) {
    const cParts: any[] = c?.content?.parts ?? [];
    for (const p of cParts) {
      if (p?.inlineData?.data) {
        inlineData = {
          data: p.inlineData.data,
          mimeType: p.inlineData.mimeType ?? "image/png",
        };
        break;
      }
    }
    if (inlineData) break;
  }

  if (!inlineData) {
    let textFallback = "";
    try {
      textFallback = (result.response as any)?.text?.() ?? "";
    } catch {
      textFallback = "";
    }
    throw new Error(
      `Gemini did not return an image. Response was text-only — likely safety-filtered or quota exhausted. Text: ${String(textFallback).slice(0, 300)}`,
    );
  }

  const mimeType = inlineData.mimeType || "image/png";
  const ext =
    mimeType === "image/jpeg" || mimeType === "image/jpg" ? "jpg" : "png";
  const buffer = Buffer.from(inlineData.data, "base64");

  const { url } = await storagePut(
    `generated/${Date.now()}.${ext}`,
    buffer,
    mimeType,
  );

  return { url };
}
