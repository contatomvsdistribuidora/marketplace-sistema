/**
 * Background Worker
 * Processes background jobs (export_ml, generate_titles, generate_descriptions, generate_images)
 * Runs as a loop on the server, checking for pending/scheduled jobs every 30 seconds.
 * Jobs can be scheduled for a specific time or queued for immediate processing.
 */

import { eq, and, or, lte, inArray, sql, desc, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { backgroundJobs, productCache, settings, shopeeAccounts } from "../drizzle/schema";
import * as ml from "./mercadolivre";
import * as aiMapper from "./ai-mapper";
import * as baselinker from "./baselinker";
import * as db from "./db";
import * as shopee from "./shopee";
import { notifyOwner } from "./_core/notification";

const POLL_INTERVAL = 30_000; // Check every 30 seconds
let isRunning = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function getDbInstance() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  try {
    return drizzle(url);
  } catch (error: any) {
    throw new Error(`DATABASE_URL inválida ("${url.slice(0, 30)}..."): ${error.message}`);
  }
}

// ============ JOB MANAGEMENT ============

export async function createBackgroundJob(data: {
  userId: number;
  type: "export_ml" | "generate_titles" | "generate_descriptions" | "generate_images" | "shopee_sync";
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
  totalItems: number;
  processedItems: number;
  successCount: number;
  errorCount: number;
  startedAt: Date;
  completedAt: Date;
  lastError: string;
  resultLog: any;
  productData: any;
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

// ─── Shopee sync checkpoint type ─────────────────────────────────────────────
interface ShopeeSyncCheckpoint {
  allItemIds: number[];
  byStatus: Record<string, number>;
  added: number;
  updated: number;
  errors: Array<{ itemId: number; error: string }>;
  checkpointedAt: string;
}

async function processShopeeSync(job: typeof backgroundJobs.$inferSelect) {
  console.log(`[BG Worker] shopee_sync #${job.id} starting for account ${job.accountId}`);

  const accountId = job.accountId;
  if (!accountId) throw new Error("accountId is required for shopee_sync jobs");

  // Get a valid token once (reused for all batches; refreshed automatically on expiry)
  let { accessToken, shopId } = await shopee.getValidToken(accountId);

  const saved = job.productData as ShopeeSyncCheckpoint | null;
  let allItemIds: number[];
  let byStatus: Record<string, number>;
  let added: number;
  let updated: number;
  const errors: Array<{ itemId: number; error: string }> = [];

  // ── Phase 1: collect IDs (or restore from checkpoint) ────────────────────────
  const isResume = !!(saved?.allItemIds?.length && (job.processedItems ?? 0) > 0);

  if (isResume) {
    allItemIds = saved!.allItemIds;
    byStatus = saved!.byStatus ?? {};
    added = saved!.added ?? 0;
    updated = saved!.updated ?? 0;
    console.log(
      `[BG Worker] shopee_sync #${job.id} RESUMING from offset ` +
      `${job.processedItems}/${allItemIds.length}`
    );
  } else {
    console.log(`[BG Worker] shopee_sync #${job.id} collecting item IDs...`);
    const collected = await shopee.collectAllItemIds(accessToken, shopId);
    allItemIds = collected.itemIds;
    byStatus = collected.byStatus;
    added = 0;
    updated = 0;

    // Save Phase-1 checkpoint so a crash before any upsert is recoverable
    await updateJobProgress(job.id, {
      totalItems: allItemIds.length,
      processedItems: 0,
      productData: {
        allItemIds,
        byStatus,
        added: 0,
        updated: 0,
        errors: [],
        checkpointedAt: new Date().toISOString(),
      } satisfies ShopeeSyncCheckpoint,
    });
    console.log(`[BG Worker] shopee_sync #${job.id} collected ${allItemIds.length} IDs`);
  }

  const totalItems = allItemIds.length;
  const startOffset = job.processedItems ?? 0;
  let batchesSinceCheckpoint = 0;

  // ── Phase 2: upsert batches from where we left off ────────────────────────────
  for (let i = startOffset; i < allItemIds.length; i += 50) {
    const batch = allItemIds.slice(i, i + 50);
    const batchResult = await shopee.upsertItemBatch(
      accessToken, shopId, job.userId, accountId, batch
    );

    // Propagate refreshed token so subsequent batches don't repeat the expiry retry
    if (batchResult.refreshedToken) {
      ({ accessToken, shopId } = batchResult.refreshedToken);
      console.log(`[BG Worker] shopee_sync #${job.id} token refreshed mid-sync`);
    }

    added += batchResult.added;
    updated += batchResult.updated;
    errors.push(...batchResult.errors);
    batchesSinceCheckpoint++;

    const processedNow = Math.min(i + batch.length, totalItems);

    // Lightweight progress update every batch (for the UI progress bar)
    await updateJobProgress(job.id, {
      processedItems: processedNow,
      totalItems,
      successCount: added + updated,
      errorCount: errors.length,
    });

    console.log(
      `[BG Worker] shopee_sync #${job.id} batch ${Math.ceil(processedNow / 50)}: ` +
      `${processedNow}/${totalItems} (+${batchResult.added} new, ~${batchResult.updated} upd, ` +
      `${batchResult.errors.length} err)`
    );

    // Full checkpoint every 100 items (2 batches of 50) or at the very end
    if (batchesSinceCheckpoint >= 2 || processedNow >= totalItems) {
      batchesSinceCheckpoint = 0;
      await updateJobProgress(job.id, {
        processedItems: processedNow,
        totalItems,
        successCount: added + updated,
        errorCount: errors.length,
        productData: {
          allItemIds,
          byStatus,
          added,
          updated,
          // Keep last 200 errors max to avoid unbounded JSON growth
          errors: errors.slice(-200),
          checkpointedAt: new Date().toISOString(),
        } satisfies ShopeeSyncCheckpoint,
      });
    }

    if (i + 50 < allItemIds.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // ── Phase 3: cleanup + finalize ───────────────────────────────────────────────
  const removed = await shopee.removeStaleProducts(accountId, new Set(allItemIds));
  await shopee.updateAccountSyncMeta(accountId, totalItems);

  await updateJobProgress(job.id, {
    processedItems: totalItems,
    successCount: added + updated,
    errorCount: errors.length,
    resultLog: { added, updated, removed, total: totalItems, errors },
    productData: null, // clear checkpoint — job is done
  });

  console.log(
    `[BG Worker] shopee_sync #${job.id} done — ` +
    `added: ${added}, updated: ${updated}, removed: ${removed}, errors: ${errors.length}`
  );
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
      case "shopee_sync":
        await processShopeeSync(job);
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
      shopee_sync: "Importação Shopee",
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

// ============ SHOPEE RESUME HELPERS ============

/**
 * Find the most recent shopee_sync job for an account that can be resumed:
 * status is "failed" OR "processing" but stale (not updated in 2+ min).
 * Returns null if nothing resumable exists.
 */
export async function getResumableShopeeJob(
  accountId: number,
  userId: number
): Promise<{
  jobId: number;
  processedItems: number;
  totalItems: number;
  errorCount: number;
  status: string;
  startedAt: Date | null;
  byStatus: Record<string, number>;
} | null> {
  const dbInst = getDbInstance();
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

  const rows = await dbInst
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.type, "shopee_sync"),
        eq(backgroundJobs.accountId, accountId),
        eq(backgroundJobs.userId, userId),
        or(
          eq(backgroundJobs.status, "failed"),
          and(
            eq(backgroundJobs.status, "processing"),
            lte(backgroundJobs.updatedAt, twoMinutesAgo)
          )
        )
      )
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(1);

  if (rows.length === 0) return null;

  const job = rows[0];
  const saved = job.productData as any;

  // Only resumable if we have the ID list and at least some progress
  if (!saved?.allItemIds?.length || (job.processedItems ?? 0) === 0) return null;
  if ((job.processedItems ?? 0) >= (job.totalItems ?? 0) && (job.totalItems ?? 0) > 0) return null;

  return {
    jobId: job.id,
    processedItems: job.processedItems ?? 0,
    totalItems: job.totalItems ?? 0,
    errorCount: job.errorCount ?? 0,
    status: job.status,
    startedAt: job.startedAt,
    byStatus: saved.byStatus ?? {},
  };
}

/** Re-queue a previously failed/stale job so the worker picks it up again. */
export async function resumeSyncJob(jobId: number): Promise<void> {
  const dbInst = getDbInstance();
  await dbInst
    .update(backgroundJobs)
    .set({ status: "queued", lastError: null })
    .where(eq(backgroundJobs.id, jobId));
}

/** Cancel all incomplete shopee_sync jobs for an account (used on fresh start). */
export async function cancelIncompleteShopeeJobs(
  accountId: number,
  userId: number
): Promise<void> {
  const dbInst = getDbInstance();
  await dbInst
    .update(backgroundJobs)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(
      and(
        eq(backgroundJobs.type, "shopee_sync"),
        eq(backgroundJobs.accountId, accountId),
        eq(backgroundJobs.userId, userId),
        or(
          eq(backgroundJobs.status, "processing"),
          eq(backgroundJobs.status, "failed"),
          eq(backgroundJobs.status, "queued")
        )
      )
    );
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

// ============ SHOPEE PROACTIVE TOKEN REFRESH ============

const TOKEN_REFRESH_INTERVAL = 60 * 60 * 1000; // every hour
const TOKEN_REFRESH_BUFFER_MS = 30 * 60 * 1000; // refresh if expiring within 30 min

async function refreshExpiringShopeeTokens() {
  let db;
  try {
    db = getDbInstance();
  } catch (error: any) {
    console.warn("[BG Worker] Shopee token refresh skipped:", error.message);
    return;
  }
  const threshold = new Date(Date.now() + TOKEN_REFRESH_BUFFER_MS);
  try {
    const expiring = await db
      .select({ id: shopeeAccounts.id, shopId: shopeeAccounts.shopId })
      .from(shopeeAccounts)
      .where(
        and(
          eq(shopeeAccounts.isActive, 1),
          eq(shopeeAccounts.tokenStatus, "active"),
          lt(shopeeAccounts.tokenExpiresAt, threshold)
        )
      );

    if (expiring.length === 0) return;
    console.log(`[BG Worker] Proactively refreshing ${expiring.length} Shopee token(s)...`);

    for (const account of expiring) {
      try {
        await shopee.getValidToken(account.id);
        console.log(`[BG Worker] Token refreshed proactively for shop ${account.shopId}`);
      } catch (e: any) {
        console.warn(`[BG Worker] Proactive refresh failed for account ${account.id}:`, e.message);
      }
    }
  } catch (e: any) {
    console.warn("[BG Worker] Proactive token refresh check failed:", e.message);
  }
}

export function startBackgroundWorker() {
  if (pollTimer) return; // Already running

  console.log("[BG Worker] Starting background worker (poll interval: 30s)");

  // Initial poll after 5 seconds
  setTimeout(pollForJobs, 5000);

  // Regular polling
  pollTimer = setInterval(pollForJobs, POLL_INTERVAL);

  // Proactive Shopee token refresh: run once at startup (after 10s) then every hour
  setTimeout(refreshExpiringShopeeTokens, 10_000);
  setInterval(refreshExpiringShopeeTokens, TOKEN_REFRESH_INTERVAL);
}

export function stopBackgroundWorker() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log("[BG Worker] Stopped background worker");
  }
}
