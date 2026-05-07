import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";
import { randomUUID } from "node:crypto";

const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // 30MB - limite Shopee
const ALLOWED_MIME = ["video/mp4", "video/quicktime", "video/webm"] as const;
type AllowedMime = (typeof ALLOWED_MIME)[number];

let _client: S3Client | null = null;
function getClient(): S3Client {
  if (_client) return _client;
  const { r2 } = ENV;
  if (!r2.accessKeyId || !r2.secretAccessKey || !r2.endpoint) {
    throw new Error("R2 credentials missing for video storage");
  }
  _client = new S3Client({
    region: "auto",
    endpoint: r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  return _client;
}

export function isAllowedVideoMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME as readonly string[]).includes(mime);
}

export function buildVideoKey(userId: number, contentType: string): string {
  const ext = contentType === "video/quicktime" ? "mov" : contentType.split("/")[1];
  return `video-bank/${userId}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
}

export function buildVideoPublicUrl(key: string): string {
  const { r2 } = ENV;
  if (!r2.publicUrl) throw new Error("R2_PUBLIC_URL missing");
  const publicUrl = r2.publicUrl.replace(/\/$/, "");
  const cleanKey = key.replace(/^\//, "");
  return `${publicUrl}/${cleanKey}`;
}

export async function getPresignedVideoUploadUrl(params: {
  userId: number;
  contentType: string;
  sizeBytes: number;
}): Promise<{ uploadUrl: string; key: string; publicUrl: string; expiresIn: number }> {
  if (!isAllowedVideoMime(params.contentType)) {
    throw new Error("Tipo de arquivo nao permitido. Use MP4, MOV ou WEBM.");
  }
  if (params.sizeBytes > MAX_VIDEO_BYTES) {
    throw new Error("Video maior que 30MB.");
  }
  if (params.sizeBytes < 1024) {
    throw new Error("Arquivo invalido.");
  }
  const { r2 } = ENV;
  if (!r2.bucketName) throw new Error("R2_BUCKET_NAME missing");
  const key = buildVideoKey(params.userId, params.contentType);
  const cmd = new PutObjectCommand({
    Bucket: r2.bucketName,
    Key: key,
    ContentType: params.contentType,
    ContentLength: params.sizeBytes,
  });
  const expiresIn = 600; // 10min
  const uploadUrl = await getSignedUrl(getClient(), cmd, { expiresIn });
  return { uploadUrl, key, publicUrl: buildVideoPublicUrl(key), expiresIn };
}

export async function verifyVideoUploaded(key: string): Promise<{ exists: boolean; size: number }> {
  const { r2 } = ENV;
  if (!r2.bucketName) throw new Error("R2_BUCKET_NAME missing");
  try {
    const res = await getClient().send(new HeadObjectCommand({ Bucket: r2.bucketName, Key: key }));
    return { exists: true, size: Number(res.ContentLength ?? 0) };
  } catch {
    return { exists: false, size: 0 };
  }
}

export async function downloadVideoFromUrl(sourceUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const lower = sourceUrl.toLowerCase();
  const blocked = ["youtube.com", "youtu.be", "tiktok.com", "instagram.com", "facebook.com/watch", "vimeo.com"];
  if (blocked.some(b => lower.includes(b))) {
    throw new Error(
      "URLs de YouTube, TikTok, Instagram, Vimeo e Facebook nao funcionam. " +
      "Use link direto pro arquivo .mp4 (Google Drive publico, Dropbox, ou seu site)."
    );
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(sourceUrl, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Falha ao baixar (HTTP ${res.status})`);
    const lenHeader = res.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_VIDEO_BYTES) {
      throw new Error("Video maior que 30MB.");
    }
    const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    let contentType = ct;
    if (!isAllowedVideoMime(contentType)) {
      if (lower.endsWith(".mp4")) contentType = "video/mp4";
      else if (lower.endsWith(".mov")) contentType = "video/quicktime";
      else if (lower.endsWith(".webm")) contentType = "video/webm";
      else throw new Error("URL nao aponta pra arquivo de video MP4/MOV/WEBM.");
    }
    const arr = await res.arrayBuffer();
    if (arr.byteLength > MAX_VIDEO_BYTES) throw new Error("Video maior que 30MB.");
    if (arr.byteLength < 1024) throw new Error("Arquivo invalido.");
    return { buffer: Buffer.from(arr), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadVideoBuffer(params: {
  userId: number;
  buffer: Buffer;
  contentType: string;
}): Promise<{ key: string; publicUrl: string }> {
  if (!isAllowedVideoMime(params.contentType)) {
    throw new Error("Tipo de arquivo nao permitido.");
  }
  if (params.buffer.length > MAX_VIDEO_BYTES) {
    throw new Error("Video maior que 30MB.");
  }
  const { r2 } = ENV;
  if (!r2.bucketName) throw new Error("R2_BUCKET_NAME missing");
  const key = buildVideoKey(params.userId, params.contentType);
  await getClient().send(
    new PutObjectCommand({
      Bucket: r2.bucketName,
      Key: key,
      Body: params.buffer,
      ContentType: params.contentType,
    }),
  );
  return { key, publicUrl: buildVideoPublicUrl(key) };
}

export const VIDEO_LIMITS = {
  maxBytes: MAX_VIDEO_BYTES,
  maxBytesMb: 30,
  allowedMime: ALLOWED_MIME,
};
