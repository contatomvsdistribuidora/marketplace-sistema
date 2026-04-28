import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { ENV } from "./_core/env";

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const { r2 } = ENV;
  if (!r2.accessKeyId || !r2.secretAccessKey || !r2.endpoint) {
    throw new Error(
      "R2 storage credentials missing. Configure R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT in .env",
    );
  }
  _client = new S3Client({
    region: "auto",
    endpoint: r2.endpoint,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
  });
  return _client;
}

/**
 * Upload arbitrário ao Cloudflare R2 (compatível S3).
 * Mantém assinatura idêntica à versão anterior (Forge) — não quebra callers.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { r2 } = ENV;
  if (!r2.bucketName || !r2.publicUrl) {
    throw new Error(
      "R2 storage config incomplete. Configure R2_BUCKET_NAME and R2_PUBLIC_URL.",
    );
  }

  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  await getClient().send(
    new PutObjectCommand({
      Bucket: r2.bucketName,
      Key: relKey,
      Body: body,
      ContentType: contentType,
    }),
  );

  const publicUrl = r2.publicUrl.replace(/\/$/, "");
  const key = relKey.replace(/^\//, "");
  return {
    key,
    url: `${publicUrl}/${key}`,
  };
}

/**
 * Stub: signed download URL (compatível com a API antiga da Forge).
 * Como o bucket está com Public Development URL habilitada, retornamos a URL pública diretamente.
 * Se um dia precisar de URL temporária privada, importar GetObjectCommand de @aws-sdk/client-s3
 * + getSignedUrl de @aws-sdk/s3-request-presigner.
 */
export async function storageGet(relKey: string): Promise<{ url: string }> {
  const { r2 } = ENV;
  const publicUrl = r2.publicUrl.replace(/\/$/, "");
  const key = relKey.replace(/^\//, "");
  return { url: `${publicUrl}/${key}` };
}
