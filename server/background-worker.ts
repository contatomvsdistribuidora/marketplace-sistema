/**
 * Background Worker
 * Processes background jobs (export_ml, generate_titles, generate_descriptions, generate_images)
 * Runs as a loop on the server, checking for pending/scheduled jobs every 30 seconds.
 * Jobs can be scheduled for a specific time or queued for immediate processing.
 */

import { eq, and, or, lte, inArray, sql, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { backgroundJobs, productCache, settings } from "../drizzle/schema";
import * as ml from "./mercadolivre";
import * as aiMapper from "./ai-mapper";
import * as baselinker from "./baselinker";
import * as db from "./db";
import { notifyOwner } from "./_core/notification";

const POLL_INTERVAL = 30_000; // Check every 30 seconds
let isRunning = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function getDbInstance() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return drizzle(process.env.DATABASE_URL);
}

// ============ JOB MANAGEMENT ============

export async function createBackgroundJob(data: {
  userId: number;
  type: "export_ml" | "generate_titles" | "generate_descriptions" | "generate_images";
  marketplaceId?: number;
  accountId?: number;
  accountName?: string;
  tagFilter?: string;
  listingTypes?: string[];
  titleStyle?: string;
  descriptionStyle?: string;
  imageStyle?: string;
  concurrency?: number;
  productIds?: string[];
  productData?: any;
  totalItems: number;
  scheduledFor?: Date;
}) {
  const dbInst = getDbInstance();
  const status = data.scheduledFor ? "scheduled" : "queued";
  const [result] = await dbInst.insert(backgroundJobs).values({
    userId: data.userId,
    type: data.type,
    status,
    marketplaceId: data.marketplaceId || null,
    accountId: data.accountId || null,
    accountName: data.accountName || null,
    tagFilter: data.tagFilter || null,
    listingTypes: data.listingTypes || null,
    titleStyle: data.titleStyle || null,
    descriptionStyle: data.descriptionStyle || null,
    imageStyle: data.imageStyle || null,
    concurrency: data.concurrency || 5,
    productIds: data.productIds || null,
    productData: data.productData || null,
    totalItems: data.totalItems,
    scheduledFor: data.scheduledFor || null,
  }).$returningId();
  return result.id;
}

export async function getBackgroundJobs(userId: number, limit: number = 50) {
  const dbInst = getDbInstance();
  return dbInst.select().from(backgroundJobs)
    .where(eq(backgroundJobs.userId, userId))
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(limit);
}

export async function getBackgroundJob(jobId: number) {
  const dbInst = getDbInstance();
  const rows = await dbInst.select().from(backgroundJobs)
    .where(eq(backgroundJobs.id, jobId))
    .limit(1);
  return rows[0] || null;
}

export async function cancelBackgroundJob(jobId: number, userId: number) {
  const dbInst = getDbInstance();
  const job = await getBackgroundJob(jobId);
  if (!job || job.userId !== userId) return false;
  if (job.status === "completed" || job.status === "failed") return false;
  
  await dbInst.update(backgroundJobs).set({
    status: "cancelled",
    completedAt: new Date(),
  }).where(eq(backgroundJobs.id, jobId));
  return true;
}

async function updateJobProgress(jobId: number, data: Partial<{
  status: "scheduled" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  processedItems: number;
  successCount: number;
  errorCount: number;
  startedAt: Date;
  completedAt: Date;
  lastError: string;
  resultLog: any;
}>) {
  const dbInst = getDbInstance();
  await dbInst.update(backgroundJobs).set(data).where(eq(backgroundJobs.id, jobId));
}

// ============ JOB PROCESSING ============

async function processExportMLJob(job: typeof backgroundJobs.$inferSelect) {
  console.log(`[BG Worker] Processing export_ml job #${job.id} (${job.totalItems} items)`);
  
  const accountId = job.accountId;
  if (!accountId) throw new Error("accountId is required for export_ml jobs");
  
  const productData = job.productData as any[];
  if (!productData || productData.length === 0) throw new Error("No product data provided");
  
  const concurrency = job.concurrency || 5;
  let processedItems = job.processedItems || 0;
  let successCount = job.successCount || 0;
  let errorCount = job.errorCount || 0;
  const resultLog: any[] = (job.resultLog as any[]) || [];
  
  // Process from where we left off (supports resume)
  const remaining = productData.slice(processedItems);
  
  for (let i = 0; i < remaining.length; i += concurrency) {
    // Check if job was cancelled
    const currentJob = await getBackgroundJob(job.id);
    if (currentJob?.status === "cancelled") {
      console.log(`[BG Worker] Job #${job.id} was cancelled, stopping`);
      return;
    }
    
    const chunk = remaining.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (product: any) => {
        try {
          const result = await ml.publishProduct(job.userId, accountId, {
            productId: product.productId,
            name: product.name,
            description: product.description,
            price: product.price,
            stock: product.stock,
            ean: product.ean,
            sku: product.sku,
            brand: product.brand,
            images: product.images,
            features: product.features,
            categoryId: product.categoryId,
            listingType: product.listingType,
          });
          return { productId: product.productId, success: true, result };
        } catch (error: any) {
          return { productId: product.productId, success: false, error: error.message };
        }
      })
    );
    
    for (const r of chunkResults) {
      processedItems++;
      if (r.success) {
        successCount++;
        // Also create export log
        try {
          // Find or create export job for logging
          const exportJobId = await getOrCreateExportJobForBg(job);
          await db.createExportLog({
            jobId: exportJobId,
            userId: job.userId,
            productId: r.productId,
            productName: (r.result as any)?.productName || r.productId,
            marketplaceId: job.marketplaceId || 0,
            listingType: (r.result as any)?.listingType,
            mlItemId: (r.result as any)?.mlItemId,
            status: "success",
            mappedCategory: (r.result as any)?.categoryName,
            baselinkerResponse: r.result,
          });
        } catch (e) { /* ignore log errors */ }
      } else {
        errorCount++;
        try {
          const exportJobId = await getOrCreateExportJobForBg(job);
          await db.createExportLog({
            jobId: exportJobId,
            userId: job.userId,
            productId: r.productId,
            marketplaceId: job.marketplaceId || 0,
            status: "error",
            errorMessage: r.error,
          });
        } catch (e) { /* ignore log errors */ }
      }
      resultLog.push(r);
    }
    
    // Update progress in DB
    await updateJobProgress(job.id, {
      processedItems,
      successCount,
      errorCount,
      resultLog,
    });
    
    // Small delay between chunks to avoid rate limiting
    if (i + concurrency < remaining.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

// Cache export job IDs for background jobs
const bgExportJobCache = new Map<number, number>();

async function getOrCreateExportJobForBg(job: typeof backgroundJobs.$inferSelect): Promise<number> {
  if (bgExportJobCache.has(job.id)) return bgExportJobCache.get(job.id)!;
  
  const exportJobId = await db.createExportJob({
    userId: job.userId,
    marketplaceId: job.marketplaceId || 0,
    totalProducts: job.totalItems,
    tagFilter: job.tagFilter || undefined,
    config: { backgroundJobId: job.id },
  });
  
  if (exportJobId) {
    bgExportJobCache.set(job.id, exportJobId);
    return exportJobId;
  }
  return 0;
}

async function processGenerateTitlesJob(job: typeof backgroundJobs.$inferSelect) {
  console.log(`[BG Worker] Processing generate_titles job #${job.id} (${job.totalItems} items)`);
  
  const productData = job.productData as any[];
  if (!productData || productData.length === 0) throw new Error("No product data provided");
  
  const concurrency = job.concurrency || 5;
  let processedItems = job.processedItems || 0;
  let successCount = job.successCount || 0;
  let errorCount = job.errorCount || 0;
  const resultLog: any[] = (job.resultLog as any[]) || [];
  
  const remaining = productData.slice(processedItems);
  const marketplace = "Mercado Livre";
  const style = (job.titleStyle as "seo" | "descriptive" | "short") || "seo";
  
  for (let i = 0; i < remaining.length; i += concurrency) {
    const currentJob = await getBackgroundJob(job.id);
    if (currentJob?.status === "cancelled") return;
    
    const chunk = remaining.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (product: any) => {
        try {
          const result = await aiMapper.generateOptimizedTitle(
            product, marketplace, style
          );
          return { id: product.id, success: true, title: result.title, reasoning: result.reasoning };
        } catch (error: any) {
          return { id: product.id, success: false, error: error.message };
        }
      })
    );
    
    for (const r of chunkResults) {
      processedItems++;
      if (r.success) successCount++;
      else errorCount++;
      resultLog.push(r);
    }
    
    await updateJobProgress(job.id, { processedItems, successCount, errorCount, resultLog });
    
    if (i + concurrency < remaining.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

async function processGenerateDescriptionsJob(job: typeof backgroundJobs.$inferSelect) {
  console.log(`[BG Worker] Processing generate_descriptions job #${job.id} (${job.totalItems} items)`);
  
  const productData = job.productData as any[];
  if (!productData || productData.length === 0) throw new Error("No product data provided");
  
  const concurrency = job.concurrency || 5;
  let processedItems = job.processedItems || 0;
  let successCount = job.successCount || 0;
  let errorCount = job.errorCount || 0;
  const resultLog: any[] = (job.resultLog as any[]) || [];
  
  const remaining = productData.slice(processedItems);
  const marketplace = "Mercado Livre";
  const style = (job.descriptionStyle as "seo" | "detailed" | "short") || "seo";
  
  for (let i = 0; i < remaining.length; i += concurrency) {
    const currentJob = await getBackgroundJob(job.id);
    if (currentJob?.status === "cancelled") return;
    
    const chunk = remaining.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (product: any) => {
        try {
          const result = await aiMapper.generateOptimizedDescription(
            product, marketplace, style
          );
          return { id: product.id, success: true, description: result.description };
        } catch (error: any) {
          return { id: product.id, success: false, error: error.message };
        }
      })
    );
    
    for (const r of chunkResults) {
      processedItems++;
      if (r.success) successCount++;
      else errorCount++;
      resultLog.push(r);
    }
    
    await updateJobProgress(job.id, { processedItems, successCount, errorCount, resultLog });
    
    if (i + concurrency < remaining.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

async function processJob(job: typeof backgroundJobs.$inferSelect) {
  try {
    await updateJobProgress(job.id, { status: "processing", startedAt: new Date() });
    
    switch (job.type) {
      case "export_ml":
        await processExportMLJob(job);
        break;
      case "generate_titles":
        await processGenerateTitlesJob(job);
        break;
      case "generate_descriptions":
        await processGenerateDescriptionsJob(job);
        break;
      case "generate_images":
        // TODO: implement image generation
        break;
    }
    
    // Re-check if cancelled during processing
    const finalJob = await getBackgroundJob(job.id);
    if (finalJob?.status === "cancelled") return;
    
    await updateJobProgress(job.id, {
      status: "completed",
      completedAt: new Date(),
    });
    
    // Notify owner
    const typeLabels: Record<string, string> = {
      export_ml: "Exportação para Mercado Livre",
      generate_titles: "Geração de Títulos",
      generate_descriptions: "Geração de Descrições",
      generate_images: "Geração de Imagens",
    };
    
    try {
      await notifyOwner({
        title: `✅ Job #${job.id} Concluído - ${typeLabels[job.type] || job.type}`,
        content: `O job de background #${job.id} foi concluído.\n\nTotal: ${finalJob?.totalItems || job.totalItems}\nSucesso: ${finalJob?.successCount || 0}\nErros: ${finalJob?.errorCount || 0}\nConta: ${job.accountName || "N/A"}`,
      });
    } catch (e) {
      console.warn(`[BG Worker] Failed to notify owner for job #${job.id}:`, e);
    }
    
    console.log(`[BG Worker] Job #${job.id} completed: ${finalJob?.successCount || 0} success, ${finalJob?.errorCount || 0} errors`);
  } catch (error: any) {
    console.error(`[BG Worker] Job #${job.id} failed:`, error.message);
    await updateJobProgress(job.id, {
      status: "failed",
      lastError: error.message,
      completedAt: new Date(),
    });
    
    try {
      await notifyOwner({
        title: `❌ Job #${job.id} Falhou`,
        content: `O job de background #${job.id} falhou com erro:\n${error.message}`,
      });
    } catch (e) {
      console.warn(`[BG Worker] Failed to notify owner for failed job #${job.id}:`, e);
    }
  }
}

// ============ WORKER LOOP ============

async function pollForJobs() {
  if (isRunning) return; // Prevent concurrent processing
  isRunning = true;
  
  try {
    const dbInst = getDbInstance();
    const now = new Date();
    
    // Find jobs that are queued or scheduled for now/past
    const pendingJobs = await dbInst.select().from(backgroundJobs)
      .where(
        or(
          eq(backgroundJobs.status, "queued"),
          and(
            eq(backgroundJobs.status, "scheduled"),
            lte(backgroundJobs.scheduledFor, now)
          )
        )
      )
      .orderBy(backgroundJobs.createdAt)
      .limit(1); // Process one at a time
    
    if (pendingJobs.length > 0) {
      const job = pendingJobs[0];
      console.log(`[BG Worker] Found pending job #${job.id} (type: ${job.type}, items: ${job.totalItems})`);
      await processJob(job);
    }
  } catch (error: any) {
    console.error("[BG Worker] Poll error:", error.message);
  } finally {
    isRunning = false;
  }
}

export function startBackgroundWorker() {
  if (pollTimer) return; // Already running
  
  console.log("[BG Worker] Starting background worker (poll interval: 30s)");
  
  // Initial poll after 5 seconds
  setTimeout(pollForJobs, 5000);
  
  // Regular polling
  pollTimer = setInterval(pollForJobs, POLL_INTERVAL);
}

export function stopBackgroundWorker() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[BG Worker] Stopped background worker");
  }
}
