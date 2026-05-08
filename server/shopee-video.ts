/**
 * Cliente Shopee de upload de video.
 * Fluxo: init_video_upload -> upload_video_part (chunks 4MB) -> complete_video_upload -> get_video_upload_result (polling).
 *
 * Limites Shopee:
 * - Tamanho max: 30MB
 * - Duracao max: 60s (recomendado), aceita ate 90s
 * - Formato: MP4 H.264 (AAC audio)
 * - Resolucao recomendada: 1280x720 ou superior
 */
import * as crypto from "crypto";
import { generateSignature } from "./shopee";

const SHOPEE_API_BASE = process.env.SHOPEE_API_BASE_URL || "https://partner.shopeemobile.com";
const PART_SIZE = 4 * 1024 * 1024; // 4MB chunks (Shopee max por part)
const MAX_VIDEO_SIZE = 30 * 1024 * 1024; // 30MB total

function buildUrl(path: string, accessToken: string, shopId: number): string {
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID);
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignature(path, timestamp, accessToken, shopId);
  return `${SHOPEE_API_BASE}${path}?partner_id=${partnerId}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${sign}`;
}

interface InitVideoUploadResult {
  video_upload_id: string;
}

/**
 * Inicia upload e recebe video_upload_id.
 */
async function initVideoUpload(
  accessToken: string,
  shopId: number,
  fileSizeBytes: number,
  durationSeconds: number,
  fileMd5: string,
): Promise<InitVideoUploadResult> {
  const path = "/api/v2/media_space/init_video_upload";
  const url = buildUrl(path, accessToken, shopId);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_md5: fileMd5,
      file_size: fileSizeBytes,
      duration: durationSeconds,
    }),
  });
  const data: any = await res.json();
  if (data.error) {
    throw new Error(`Shopee init_video_upload: ${data.error} - ${data.message ?? ""}`);
  }
  if (!data?.response?.video_upload_id) {
    throw new Error(`Shopee init_video_upload sem video_upload_id: ${JSON.stringify(data)}`);
  }
  return { video_upload_id: data.response.video_upload_id };
}

/**
 * Sobe uma parte do video (chunk de ate 4MB).
 */
async function uploadVideoPart(
  accessToken: string,
  shopId: number,
  videoUploadId: string,
  partSeq: number,
  partBuffer: Buffer,
): Promise<void> {
  const path = "/api/v2/media_space/upload_video_part";
  const url = buildUrl(path, accessToken, shopId);

  const contentMd5 = crypto.createHash("md5").update(partBuffer).digest("hex");
  const boundary = `----VideoBoundary${Date.now()}${partSeq}`;
  const CRLF = "\r\n";

  const head = Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="video_upload_id"${CRLF}${CRLF}` +
    `${videoUploadId}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="part_seq"${CRLF}${CRLF}` +
    `${partSeq}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="content_md5"${CRLF}${CRLF}` +
    `${contentMd5}${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="part_content"; filename="part_${partSeq}.bin"${CRLF}` +
    `Content-Type: application/octet-stream${CRLF}${CRLF}`,
    "utf-8"
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, "utf-8");
  const body = Buffer.concat([head, partBuffer, tail]);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const data: any = await res.json();
  if (data.error) {
    throw new Error(`Shopee upload_video_part[${partSeq}]: ${data.error} - ${data.message ?? ""}`);
  }
}

/**
 * Finaliza upload depois de todas as partes enviadas.
 */
async function completeVideoUpload(
  accessToken: string,
  shopId: number,
  videoUploadId: string,
  partSeqList: number[],
  reportData?: { upload_cost?: number; report?: any },
): Promise<void> {
  const path = "/api/v2/media_space/complete_video_upload";
  const url = buildUrl(path, accessToken, shopId);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_upload_id: videoUploadId,
      part_seq_list: partSeqList,
      report_data: reportData ?? { upload_cost: 0 },
    }),
  });
  const data: any = await res.json();
  if (data.error) {
    throw new Error(`Shopee complete_video_upload: ${data.error} - ${data.message ?? ""}`);
  }
}

/**
 * Faz polling do status ate Shopee terminar de processar (max 60s).
 */
async function waitVideoProcessing(
  accessToken: string,
  shopId: number,
  videoUploadId: string,
  maxWaitMs: number = 60000,
): Promise<void> {
  const path = "/api/v2/media_space/get_video_upload_result";
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const partnerId = Number(process.env.SHOPEE_PARTNER_ID);
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSignature(path, timestamp, accessToken, shopId);
    const url = `${SHOPEE_API_BASE}${path}?partner_id=${partnerId}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${sign}&video_upload_id=${videoUploadId}`;

    const res = await fetch(url, { method: "GET" });
    const data: any = await res.json();
    if (data.error) {
      throw new Error(`Shopee get_video_upload_result: ${data.error} - ${data.message ?? ""}`);
    }
    const status = data?.response?.status;
    if (status === "SUCCEEDED") return;
    if (status === "FAILED") {
      throw new Error(`Shopee video processing FAILED: ${JSON.stringify(data.response)}`);
    }
    // INITIATED / TRANSCODING - espera mais
    console.log(`[shopee-video] polling status=${status}, aguardando...`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Shopee video processing timeout apos ${maxWaitMs}ms`);
}

/**
 * Funcao high-level: baixa video da URL, sobe na Shopee em chunks e retorna video_upload_id.
 */
export async function uploadVideoFromUrl(
  accessToken: string,
  shopId: number,
  videoUrl: string,
): Promise<string> {
  console.log(`[shopee-video] INICIO upload videoUrl=${videoUrl}`);

  // 1. Baixa video da URL
  console.log(`[shopee-video] baixando arquivo...`);
  const downloadRes = await fetch(videoUrl);
  if (!downloadRes.ok) {
    throw new Error(`Falha ao baixar video da URL ${videoUrl}: ${downloadRes.status}`);
  }
  const arrayBuffer = await downloadRes.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);
  console.log(`[shopee-video] baixado ${fileBuffer.length} bytes (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);

  if (fileBuffer.length > MAX_VIDEO_SIZE) {
    throw new Error(`Video tem ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB - limite Shopee e 30MB`);
  }

  const durationSeconds = 30;
  const fileMd5 = crypto.createHash("md5").update(fileBuffer).digest("hex");
  console.log(`[shopee-video] MD5=${fileMd5} duration=${durationSeconds}s`);

  // 2. init upload
  console.log(`[shopee-video] chamando init_video_upload...`);
  const { video_upload_id } = await initVideoUpload(
    accessToken,
    shopId,
    fileBuffer.length,
    durationSeconds,
    fileMd5,
  );
  console.log(`[shopee-video] init OK video_upload_id=${video_upload_id}`);

  // 3. Divide em chunks e sobe
  const totalParts = Math.ceil(fileBuffer.length / PART_SIZE);
  console.log(`[shopee-video] subindo ${totalParts} chunk(s) de ate ${PART_SIZE / 1024 / 1024}MB`);
  const partSeqList: number[] = [];
  for (let i = 0; i < totalParts; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, fileBuffer.length);
    const chunk = fileBuffer.subarray(start, end);
    console.log(`[shopee-video] chunk ${i + 1}/${totalParts} size=${chunk.length}`);
    await uploadVideoPart(accessToken, shopId, video_upload_id, i, chunk);
    console.log(`[shopee-video] chunk ${i + 1}/${totalParts} OK`);
    partSeqList.push(i);
    if (i < totalParts - 1) await new Promise(r => setTimeout(r, 200));
  }

  // 4. Complete
  console.log(`[shopee-video] chamando complete_video_upload com part_seq_list=${JSON.stringify(partSeqList)}`);
  await completeVideoUpload(accessToken, shopId, video_upload_id, partSeqList);
  console.log(`[shopee-video] complete OK`);

  // 5. Aguarda processamento
  console.log(`[shopee-video] aguardando processamento (polling ate 60s)...`);
  await waitVideoProcessing(accessToken, shopId, video_upload_id);
  console.log(`[shopee-video] SUCCEEDED video_upload_id=${video_upload_id}`);

  return video_upload_id;
}
