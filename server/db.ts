import { eq, and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  InsertUser,
  users,
  settings,
  marketplaces,
  categoryMappings,
  attributeTemplates,
  exportJobs,
  exportLogs,
  agentQueue,
  agentActions,
  mlListings,
  InsertAgentQueue,
  InsertAgentAction,
} from "../drizzle/schema";
import { like, or, isNotNull, inArray, ne, gte, lte } from "drizzle-orm";
import { ENV } from "./_core/env";
import * as schema from "../drizzle/schema";

console.log("[DB] DATABASE_URL:", process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:([^:@]+)@/, ":***@") : "NÃO DEFINIDA");

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  ssl: false as any,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export const db = drizzle(pool, { schema, mode: "default" });

pool.getConnection().then(conn => {
  console.log("✅ Banco conectado com sucesso!");
  conn.release();
}).catch(err => {
  console.error("❌ Erro ao conectar banco:", err.message);
});

// ============ USER ============
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; } else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============ SETTINGS ============
export async function getSetting(userId: number, key: string) {
  const result = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.settingKey, key)))
    .limit(1);
  return result.length > 0 ? result[0].settingValue : null;
}

export async function setSetting(userId: number, key: string, value: string) {
  const existing = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.settingKey, key)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ settingValue: value })
      .where(and(eq(settings.userId, userId), eq(settings.settingKey, key)));
  } else {
    await db.insert(settings).values({ userId, settingKey: key, settingValue: value });
  }
}

export async function deleteSetting(userId: number, key: string) {
  await db.delete(settings).where(and(eq(settings.userId, userId), eq(settings.settingKey, key)));
}

// ============ MARKETPLACES ============
export async function getMarketplaces() {
  return db.select().from(marketplaces).where(eq(marketplaces.active, 1));
}

export async function getMarketplaceById(id: number) {
  const result = await db.select().from(marketplaces).where(eq(marketplaces.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ============ CATEGORY MAPPINGS ============
export async function getCategoryMappings(userId: number, marketplaceId: number) {
  return db
    .select()
    .from(categoryMappings)
    .where(and(eq(categoryMappings.userId, userId), eq(categoryMappings.marketplaceId, marketplaceId)));
}

export async function saveCategoryMapping(data: {
  userId: number;
  marketplaceId: number;
  sourceCategory: string;
  targetCategoryId: string;
  targetCategoryName: string;
  targetCategoryPath?: string;
  confidence?: number;
}) {
  const existing = await db
    .select()
    .from(categoryMappings)
    .where(
      and(
        eq(categoryMappings.userId, data.userId),
        eq(categoryMappings.marketplaceId, data.marketplaceId),
        eq(categoryMappings.sourceCategory, data.sourceCategory)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(categoryMappings)
      .set({
        targetCategoryId: data.targetCategoryId,
        targetCategoryName: data.targetCategoryName,
        targetCategoryPath: data.targetCategoryPath || null,
        confidence: data.confidence || 0,
      })
      .where(eq(categoryMappings.id, existing[0].id));
  } else {
    await db.insert(categoryMappings).values({
      userId: data.userId,
      marketplaceId: data.marketplaceId,
      sourceCategory: data.sourceCategory,
      targetCategoryId: data.targetCategoryId,
      targetCategoryName: data.targetCategoryName,
      targetCategoryPath: data.targetCategoryPath || null,
      confidence: data.confidence || 0,
    });
  }
}

// ============ EXPORT JOBS ============
export async function createExportJob(data: {
  userId: number;
  marketplaceId: number;
  totalProducts: number;
  tagFilter?: string;
  config?: any;
}) {
  const result = await db.insert(exportJobs).values({
    userId: data.userId,
    marketplaceId: data.marketplaceId,
    totalProducts: data.totalProducts,
    tagFilter: data.tagFilter || null,
    config: data.config || null,
    status: "pending",
  }).$returningId();
  return result[0]?.id || null;
}

export async function updateExportJob(jobId: number, data: Partial<{
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  processedProducts: number;
  successCount: number;
  errorCount: number;
  startedAt: Date;
  completedAt: Date;
}>) {
  await db.update(exportJobs).set(data).where(eq(exportJobs.id, jobId));
}

export async function getExportJobs(userId: number, limit: number = 50) {
  return db
    .select()
    .from(exportJobs)
    .where(eq(exportJobs.userId, userId))
    .orderBy(desc(exportJobs.createdAt))
    .limit(limit);
}

export async function getExportJob(jobId: number) {
  const result = await db.select().from(exportJobs).where(eq(exportJobs.id, jobId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ============ EXPORT LOGS ============
export async function createExportLog(data: {
  jobId: number;
  userId: number;
  productId: string;
  productName?: string;
  marketplaceId: number;
  listingType?: string;
  mlItemId?: string;
  status: "success" | "error" | "skipped" | "pending";
  mappedCategory?: string;
  mappedAttributes?: any;
  errorMessage?: string;
  errorDetails?: any;
  baselinkerResponse?: any;
}) {
  await db.insert(exportLogs).values({
    jobId: data.jobId,
    userId: data.userId,
    productId: data.productId,
    productName: data.productName || null,
    marketplaceId: data.marketplaceId,
    listingType: data.listingType || null,
    mlItemId: data.mlItemId || null,
    status: data.status,
    mappedCategory: data.mappedCategory || null,
    mappedAttributes: data.mappedAttributes || null,
    errorMessage: data.errorMessage || null,
    errorDetails: data.errorDetails || null,
    baselinkerResponse: data.baselinkerResponse || null,
  });
}

export async function getExportLogs(jobId: number, limit: number = 500) {
  return db
    .select()
    .from(exportLogs)
    .where(eq(exportLogs.jobId, jobId))
    .orderBy(desc(exportLogs.createdAt))
    .limit(limit);
}

export async function getExportLogProductIds(jobId: number) {
  return db
    .select({
      productId: exportLogs.productId,
      productName: exportLogs.productName,
      status: exportLogs.status,
      mappedCategory: exportLogs.mappedCategory,
      mappedAttributes: exportLogs.mappedAttributes,
    })
    .from(exportLogs)
    .where(eq(exportLogs.jobId, jobId));
}

export async function getRecentLogs(userId: number, limit: number = 100) {
  return db
    .select()
    .from(exportLogs)
    .where(eq(exportLogs.userId, userId))
    .orderBy(desc(exportLogs.createdAt))
    .limit(limit);
}

// ============ EXPORT HISTORY ============
export async function getExportHistory(userId: number, filters?: {
  status?: string;
  listingType?: string;
  productName?: string;
  page?: number;
  pageSize?: number;
}) {
  const conditions: any[] = [eq(exportLogs.userId, userId)];
  if (filters?.status && filters.status !== "all") {
    conditions.push(eq(exportLogs.status, filters.status as any));
  }
  if (filters?.listingType && filters.listingType !== "all") {
    conditions.push(eq(exportLogs.listingType, filters.listingType));
  }
  if (filters?.productName) {
    conditions.push(like(exportLogs.productName, `%${filters.productName}%`));
  }

  const page = filters?.page || 1;
  const pageSize = filters?.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const [countResult, logs] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` })
      .from(exportLogs)
      .where(and(...conditions)),
    db.select({
      id: exportLogs.id,
      jobId: exportLogs.jobId,
      productId: exportLogs.productId,
      productName: exportLogs.productName,
      marketplaceId: exportLogs.marketplaceId,
      listingType: exportLogs.listingType,
      mlItemId: exportLogs.mlItemId,
      status: exportLogs.status,
      mappedCategory: exportLogs.mappedCategory,
      errorMessage: exportLogs.errorMessage,
      createdAt: exportLogs.createdAt,
    })
      .from(exportLogs)
      .where(and(...conditions))
      .orderBy(desc(exportLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
  ]);

  const total = countResult[0]?.count || 0;
  return {
    logs,
    total,
    totalPages: Math.ceil(total / pageSize),
    page,
    pageSize,
  };
}

export async function getExportHistoryStats(userId: number) {
  const [totals, byListingType, byStatus, uniqueProducts] = await Promise.all([
    db.select({
      total: sql<number>`COUNT(*)`,
      success: sql<number>`SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)`,
      error: sql<number>`SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)`,
      skipped: sql<number>`SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END)`,
    }).from(exportLogs).where(eq(exportLogs.userId, userId)),
    db.select({
      listingType: exportLogs.listingType,
      count: sql<number>`COUNT(*)`,
      successCount: sql<number>`SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)`,
    }).from(exportLogs).where(eq(exportLogs.userId, userId)).groupBy(exportLogs.listingType),
    db.select({
      status: exportLogs.status,
      count: sql<number>`COUNT(*)`,
    }).from(exportLogs).where(eq(exportLogs.userId, userId)).groupBy(exportLogs.status),
    db.select({
      count: sql<number>`COUNT(DISTINCT productId)`,
    }).from(exportLogs).where(and(eq(exportLogs.userId, userId), eq(exportLogs.status, "success"))),
  ]);

  return {
    totalExported: totals[0]?.total || 0,
    totalSuccess: totals[0]?.success || 0,
    totalError: totals[0]?.error || 0,
    totalSkipped: totals[0]?.skipped || 0,
    uniqueSuccessProducts: uniqueProducts[0]?.count || 0,
    byListingType: byListingType.map(r => ({
      listingType: r.listingType || "sem tipo",
      count: r.count,
      successCount: r.successCount,
    })),
    byStatus: byStatus.map(r => ({
      status: r.status,
      count: r.count,
    })),
  };
}

export async function getExportedProductIds(userId: number): Promise<string[]> {
  const results = await db.selectDistinct({ productId: exportLogs.productId })
    .from(exportLogs)
    .where(and(eq(exportLogs.userId, userId), eq(exportLogs.status, "success")));
  return results.map(r => r.productId);
}

export async function getExportedProductDetails(userId: number): Promise<{
  productId: string;
  marketplaceId: number;
  marketplaceName: string;
  listingType: string | null;
}[]> {
  return db.select({
    productId: exportLogs.productId,
    marketplaceId: exportLogs.marketplaceId,
    marketplaceName: marketplaces.name,
    listingType: exportLogs.listingType,
  })
    .from(exportLogs)
    .innerJoin(marketplaces, eq(exportLogs.marketplaceId, marketplaces.id))
    .where(and(eq(exportLogs.userId, userId), eq(exportLogs.status, "success")));
}

export async function getExportedMarketplaces(userId: number): Promise<{ id: number; name: string }[]> {
  return db.selectDistinct({
    id: marketplaces.id,
    name: marketplaces.name,
  })
    .from(exportLogs)
    .innerJoin(marketplaces, eq(exportLogs.marketplaceId, marketplaces.id))
    .where(and(eq(exportLogs.userId, userId), eq(exportLogs.status, "success")));
}

// ============ AGENT QUEUE ============
export async function addToAgentQueue(items: InsertAgentQueue[]) {
  const ids: number[] = [];
  for (const item of items) {
    const result = await db.insert(agentQueue).values(item).$returningId();
    if (result[0]?.id) ids.push(result[0].id);
  }
  return ids;
}

export async function getAgentQueue(userId: number, jobId?: number, status?: string) {
  const conditions = [eq(agentQueue.userId, userId)];
  if (jobId) conditions.push(eq(agentQueue.jobId, jobId));
  if (status) conditions.push(eq(agentQueue.status, status as any));
  return db.select().from(agentQueue).where(and(...conditions)).orderBy(desc(agentQueue.createdAt)).limit(500);
}

export async function getAgentQueueStats(userId: number, jobId?: number) {
  const conditions = [eq(agentQueue.userId, userId)];
  if (jobId) conditions.push(eq(agentQueue.jobId, jobId));
  const result = await db.select({
    total: sql<number>`COUNT(*)`,
    waiting: sql<number>`SUM(CASE WHEN queue_status = 'waiting' THEN 1 ELSE 0 END)`,
    processing: sql<number>`SUM(CASE WHEN queue_status = 'processing' THEN 1 ELSE 0 END)`,
    completed: sql<number>`SUM(CASE WHEN queue_status = 'completed' THEN 1 ELSE 0 END)`,
    failed: sql<number>`SUM(CASE WHEN queue_status = 'failed' THEN 1 ELSE 0 END)`,
  }).from(agentQueue).where(and(...conditions));
  return result[0] || { total: 0, waiting: 0, processing: 0, completed: 0, failed: 0 };
}

export async function updateAgentQueueItem(id: number, data: Partial<{
  status: "waiting" | "processing" | "completed" | "failed" | "skipped";
  errorMessage: string;
  screenshotUrl: string;
  processedAt: Date;
}>) {
  await db.update(agentQueue).set(data).where(eq(agentQueue.id, id));
}

export async function getNextQueueItem(userId: number) {
  const result = await db.select().from(agentQueue)
    .where(and(eq(agentQueue.userId, userId), eq(agentQueue.status, "waiting")))
    .orderBy(agentQueue.createdAt)
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

// ============ AGENT ACTIONS ============
export async function addAgentAction(data: InsertAgentAction) {
  const result = await db.insert(agentActions).values(data).$returningId();
  return result[0]?.id || null;
}

export async function getAgentActions(userId: number, jobId?: number, limit: number = 100) {
  const conditions = [eq(agentActions.userId, userId)];
  if (jobId) conditions.push(eq(agentActions.jobId, jobId));
  return db.select().from(agentActions).where(and(...conditions)).orderBy(desc(agentActions.createdAt)).limit(limit);
}

export async function getLatestScreenshot(userId: number) {
  const result = await db.select().from(agentActions)
    .where(and(
      eq(agentActions.userId, userId),
      sql`screenshotUrl IS NOT NULL AND screenshotUrl != ''`
    ))
    .orderBy(desc(agentActions.createdAt))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

// ============ STATS ============
export async function getDashboardStats(userId: number) {
  const jobs = await db
    .select({
      totalJobs: sql<number>`COUNT(*)`,
      totalExported: sql<number>`COALESCE(SUM(processedProducts), 0)`,
      totalErrors: sql<number>`COALESCE(SUM(errorCount), 0)`,
      totalSuccess: sql<number>`COALESCE(SUM(successCount), 0)`,
    })
    .from(exportJobs)
    .where(eq(exportJobs.userId, userId));

  return jobs[0] || { totalJobs: 0, totalExported: 0, totalErrors: 0, totalSuccess: 0 };
}
