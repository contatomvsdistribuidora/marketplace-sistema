import { eq, and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  settings,
  marketplaces,
  categoryMappings,
  attributeTemplates,
  exportJobs,
  exportLogs,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ USER ============
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
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
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============ SETTINGS ============
export async function getSetting(userId: number, key: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.settingKey, key)))
    .limit(1);
  return result.length > 0 ? result[0].settingValue : null;
}

export async function setSetting(userId: number, key: string, value: string) {
  const db = await getDb();
  if (!db) return;
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
  const db = await getDb();
  if (!db) return;
  await db.delete(settings).where(and(eq(settings.userId, userId), eq(settings.settingKey, key)));
}

// ============ MARKETPLACES ============
export async function getMarketplaces() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(marketplaces).where(eq(marketplaces.active, 1));
}

export async function getMarketplaceById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(marketplaces).where(eq(marketplaces.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ============ CATEGORY MAPPINGS ============
export async function getCategoryMappings(userId: number, marketplaceId: number) {
  const db = await getDb();
  if (!db) return [];
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
  const db = await getDb();
  if (!db) return;

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
  const db = await getDb();
  if (!db) return null;
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
  const db = await getDb();
  if (!db) return;
  await db.update(exportJobs).set(data).where(eq(exportJobs.id, jobId));
}

export async function getExportJobs(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(exportJobs)
    .where(eq(exportJobs.userId, userId))
    .orderBy(desc(exportJobs.createdAt))
    .limit(limit);
}

export async function getExportJob(jobId: number) {
  const db = await getDb();
  if (!db) return null;
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
  status: "success" | "error" | "skipped" | "pending";
  mappedCategory?: string;
  mappedAttributes?: any;
  errorMessage?: string;
  errorDetails?: any;
  baselinkerResponse?: any;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(exportLogs).values({
    jobId: data.jobId,
    userId: data.userId,
    productId: data.productId,
    productName: data.productName || null,
    marketplaceId: data.marketplaceId,
    status: data.status,
    mappedCategory: data.mappedCategory || null,
    mappedAttributes: data.mappedAttributes || null,
    errorMessage: data.errorMessage || null,
    errorDetails: data.errorDetails || null,
    baselinkerResponse: data.baselinkerResponse || null,
  });
}

export async function getExportLogs(jobId: number, limit: number = 500) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(exportLogs)
    .where(eq(exportLogs.jobId, jobId))
    .orderBy(desc(exportLogs.createdAt))
    .limit(limit);
}

export async function getRecentLogs(userId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(exportLogs)
    .where(eq(exportLogs.userId, userId))
    .orderBy(desc(exportLogs.createdAt))
    .limit(limit);
}

// ============ STATS ============
export async function getDashboardStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalJobs: 0, totalExported: 0, totalErrors: 0, totalSuccess: 0 };

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
