import sharp from "sharp";
import { ENV } from "./env";
import { storagePut } from "../storage";

const MODEL_MAP = {
  "flux-klein-4b": "@cf/black-forest-labs/flux-2-klein-4b",
  "flux-klein-9b": "@cf/black-forest-labs/flux-2-klein-9b",
  "flux-dev":      "@cf/black-forest-labs/flux-2-dev",
} as const;

type ImageModelKey = keyof typeof MODEL_MAP;

function resolveModel(): { slug: string; isDev: boolean } {
  const key = ENV.imageModel as ImageModelKey;
  const slug = MODEL_MAP[key];
  if (!slug) {
    console.warn(`[imageGeneration] IMAGE_MODEL inválido: "${ENV.imageModel}". Usando flux-klein-4b.`);
    return { slug: MODEL_MAP["flux-klein-4b"], isDev: false };
  }
  return { slug, isDev: key === "flux-dev" };
}

const MAX_REF_IMAGES = 4;
const MAX_REF_BYTES = 5 * 1024 * 1024; // 5MB cap antes de resize
const REF_MAX_DIM = 512; // limite da API
const OUTPUT_W = 1024;
const OUTPUT_H = 1024;

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{ url?: string; b64Json?: string; mimeType?: string }>;
};

export type GenerateImageResponse = { url?: string };

type CFResponse = {
  result?: { image?: string };
  success?: boolean;
  errors?: Array<{ message?: string; code?: number }>;
};

async function fetchUrlAsBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ref image failed: ${res.status} ${url}`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_REF_BYTES) {
    throw new Error(`ref image too large: ${ab.byteLength} bytes`);
  }
  return Buffer.from(ab);
}

async function resizeToRefLimit(buf: Buffer): Promise<Buffer> {
  // Resize garantindo largura E altura <= 512, preservando aspect ratio.
  // Output sempre JPEG (mais leve, compatível com Flux 2).
  return sharp(buf)
    .resize({
      width: REF_MAX_DIM,
      height: REF_MAX_DIM,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function buildRefBuffer(ref: { url?: string; b64Json?: string; mimeType?: string }): Promise<Buffer | null> {
  let raw: Buffer | null = null;
  if (ref.b64Json) {
    raw = Buffer.from(ref.b64Json, "base64");
  } else if (ref.url) {
    raw = await fetchUrlAsBuffer(ref.url);
  }
  if (!raw) return null;
  return resizeToRefLimit(raw);
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const token = ENV.cloudflareAiApiToken;
  const accountId = ENV.r2.accountId; // mesma conta do R2

  if (!token) {
    throw new Error("CLOUDFLARE_AI_API_TOKEN não configurado");
  }
  if (!accountId) {
    throw new Error("R2_ACCOUNT_ID não configurado (usado também para Workers AI)");
  }

  const prompt = (options.prompt ?? "").trim();
  if (!prompt) {
    throw new Error("prompt vazio");
  }

  // Preparar reference images (até 4, todas resized a <=512x512)
  const refs = (options.originalImages ?? []).slice(0, MAX_REF_IMAGES);
  const refBuffers: Buffer[] = [];
  for (const ref of refs) {
    try {
      const buf = await buildRefBuffer(ref);
      if (buf) refBuffers.push(buf);
    } catch (err) {
      console.warn("[imageGeneration] ref ignorada:", (err as Error).message);
    }
  }

  // Montar multipart/form-data
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(OUTPUT_W));
  form.append("height", String(OUTPUT_H));
  const { slug, isDev } = resolveModel();
  if (isDev) {
    form.append("steps", "25");
  }
  refBuffers.forEach((buf, i) => {
    const blob = new Blob([new Uint8Array(buf)], { type: "image/jpeg" });
    form.append(`input_image_${i}`, blob, `ref_${i}.jpg`);
  });

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${slug}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // NÃO setar Content-Type manualmente — fetch + FormData define com boundary
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`Cloudflare Workers AI error ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as CFResponse;
  if (!json.success && json.errors?.length) {
    const msg = json.errors.map((e) => e.message ?? `code ${e.code}`).join("; ");
    throw new Error(`Cloudflare Workers AI failure: ${msg}`);
  }

  const b64 = json.result?.image;
  if (!b64) {
    throw new Error("Resposta sem campo result.image");
  }

  const buf = Buffer.from(b64, "base64");
  const key = `generated/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const stored = await storagePut(key, buf, "image/jpeg");

  return { url: stored.url };
}
