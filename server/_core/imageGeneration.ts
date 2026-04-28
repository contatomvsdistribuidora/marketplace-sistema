import sharp from "sharp";
import OpenAI from "openai";
import { ENV } from "./env";
import { storagePut } from "../storage";

type OpenAIQuality = "low" | "medium" | "high";

type ModelConfig =
  | { provider: "cloudflare"; slug: string; isDev: boolean }
  | { provider: "openai"; slug: string; quality: OpenAIQuality };

const MODEL_MAP: Record<string, ModelConfig> = {
  "flux-klein-4b": {
    provider: "cloudflare",
    slug: "@cf/black-forest-labs/flux-2-klein-4b",
    isDev: false,
  },
  "flux-klein-9b": {
    provider: "cloudflare",
    slug: "@cf/black-forest-labs/flux-2-klein-9b",
    isDev: false,
  },
  "flux-dev": {
    provider: "cloudflare",
    slug: "@cf/black-forest-labs/flux-2-dev",
    isDev: true,
  },
  "openai-gpt-image-1": {
    provider: "openai",
    slug: "gpt-image-1",
    quality: "medium",
  },
  "openai-gpt-image-1-low": {
    provider: "openai",
    slug: "gpt-image-1",
    quality: "low",
  },
  "openai-gpt-image-1-high": {
    provider: "openai",
    slug: "gpt-image-1",
    quality: "high",
  },
};

const FALLBACK_KEY = "flux-klein-4b";
const MAX_REF_IMAGES = 4;
const MAX_REF_BYTES = 5 * 1024 * 1024;
const REF_MAX_DIM = 512;
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

function resolveModel(): ModelConfig {
  const key = ENV.imageModel;
  const cfg = MODEL_MAP[key];
  if (!cfg) {
    console.warn(`[imageGeneration] IMAGE_MODEL inválido: "${key}". Usando ${FALLBACK_KEY}.`);
    return MODEL_MAP[FALLBACK_KEY];
  }
  return cfg;
}

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

async function buildRefBuffer(
  ref: { url?: string; b64Json?: string; mimeType?: string }
): Promise<Buffer | null> {
  let raw: Buffer | null = null;
  if (ref.b64Json) {
    raw = Buffer.from(ref.b64Json, "base64");
  } else if (ref.url) {
    raw = await fetchUrlAsBuffer(ref.url);
  }
  if (!raw) return null;
  return resizeToRefLimit(raw);
}

// ---------- Cloudflare branch ----------
async function generateViaCloudflare(
  prompt: string,
  originalImages: GenerateImageOptions["originalImages"],
  cfg: Extract<ModelConfig, { provider: "cloudflare" }>
): Promise<GenerateImageResponse> {
  const token = ENV.cloudflareAiApiToken;
  const accountId = ENV.r2.accountId;

  if (!token) throw new Error("CLOUDFLARE_AI_API_TOKEN não configurado");
  if (!accountId) throw new Error("R2_ACCOUNT_ID não configurado (usado também para Workers AI)");

  const refs = (originalImages ?? []).slice(0, MAX_REF_IMAGES);
  const refBuffers: Buffer[] = [];
  for (const ref of refs) {
    try {
      const buf = await buildRefBuffer(ref);
      if (buf) refBuffers.push(buf);
    } catch (err) {
      console.warn("[imageGeneration] ref ignorada:", (err as Error).message);
    }
  }

  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(OUTPUT_W));
  form.append("height", String(OUTPUT_H));
  if (cfg.isDev) {
    form.append("steps", "25");
  }
  refBuffers.forEach((buf, i) => {
    const blob = new Blob([new Uint8Array(buf)], { type: "image/jpeg" });
    form.append(`input_image_${i}`, blob, `ref_${i}.jpg`);
  });

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cfg.slug}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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
  if (!b64) throw new Error("Resposta Cloudflare sem campo result.image");

  const buf = Buffer.from(b64, "base64");
  const key = `generated/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const stored = await storagePut(key, buf, "image/jpeg");
  return { url: stored.url };
}

// ---------- OpenAI branch ----------
let _openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!_openaiClient) {
    if (!ENV.openaiApiKey) {
      throw new Error("OPENAI_API_KEY não configurada");
    }
    _openaiClient = new OpenAI({ apiKey: ENV.openaiApiKey });
  }
  return _openaiClient;
}

async function generateViaOpenAI(
  prompt: string,
  originalImages: GenerateImageOptions["originalImages"],
  cfg: Extract<ModelConfig, { provider: "openai" }>
): Promise<GenerateImageResponse> {
  if (originalImages && originalImages.length > 0) {
    console.warn(
      "[imageGeneration] OpenAI provider ignora originalImages no images.generate. " +
      "Reference images requerem images.edit (não implementado)."
    );
  }

  const client = getOpenAIClient();
  const response = await client.images.generate({
    model: cfg.slug,
    prompt,
    n: 1,
    size: `${OUTPUT_W}x${OUTPUT_H}`,
    quality: cfg.quality,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Resposta OpenAI sem b64_json");
  }

  const buf = Buffer.from(b64, "base64");
  const key = `generated/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  const stored = await storagePut(key, buf, "image/png");
  return { url: stored.url };
}

// ---------- Public API ----------
export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const prompt = (options.prompt ?? "").trim();
  if (!prompt) throw new Error("prompt vazio");

  const cfg = resolveModel();

  if (cfg.provider === "cloudflare") {
    return generateViaCloudflare(prompt, options.originalImages, cfg);
  }
  return generateViaOpenAI(prompt, options.originalImages, cfg);
}
