/**
 * Lazy + bulk attribute-sync infrastructure for Shopee categories.
 * Mirrors brand-sync.ts (Phase 1) — same state machine, same locks.
 *
 * Tables:
 *   shopee_category_attribute_cache         — one row per
 *                                              (region, categoryId, language)
 *                                              with the full attribute_tree
 *                                              JSON returned by Shopee.
 *   shopee_category_attribute_sync_progress — per (accountId, categoryId,
 *                                              language) state machine.
 *
 * Reading flow (getAttributesForCategory):
 *   - Cache hit (updatedAt < TTL): return parsed attributes.
 *   - Cache miss: fire-and-forget syncAttributesForCategory and return
 *     the static fallback (shopee_category_attributes table). The router
 *     wraps the result with ensureBrandAttribute().
 *
 * Writing flow (syncAttributesForCategory):
 *   - If progress row says done & < 24h: bail out as a cache hit.
 *   - If progress row says in_progress < 5min ago: bail.
 *   - Otherwise: claim in_progress, fetch, upsert cache+progress, mark done.
 *
 * Errors don't poison the cache: status='error' allows immediate retry
 * (no TTL gate on errored rows).
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  shopeeCategoryAttributeCache,
  shopeeCategoryAttributeSyncProgress,
} from "../../drizzle/schema";
import { withRateLimit } from "./rate-limit";
import * as shopee from "../shopee";
import {
  __test as attributeTreeTest,
  parseAttributeTreeForFrontend,
  type ApiAttribute,
  type ParsedAttribute,
} from "./attribute-tree";

export const TTL_MS = 24 * 60 * 60 * 1000;
export const STALE_LOCK_MS = 5 * 60 * 1000;
const REGION = "BR";
const DEFAULT_LANGUAGE = "pt-BR";

async function getProgressRow(accountId: number, categoryId: number, language: string) {
  const [row] = await db
    .select()
    .from(shopeeCategoryAttributeSyncProgress)
    .where(
      and(
        eq(shopeeCategoryAttributeSyncProgress.shopeeAccountId, accountId),
        eq(shopeeCategoryAttributeSyncProgress.categoryId, categoryId),
        eq(shopeeCategoryAttributeSyncProgress.language, language),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function upsertProgress(
  accountId: number,
  categoryId: number,
  language: string,
  patch: {
    status: "pending" | "in_progress" | "done" | "error";
    attributeCount?: number;
    lastSyncedAt?: Date | null;
    errorMessage?: string | null;
  },
) {
  const existing = await getProgressRow(accountId, categoryId, language);
  if (existing) {
    await db
      .update(shopeeCategoryAttributeSyncProgress)
      .set({
        status: patch.status,
        ...(patch.attributeCount !== undefined ? { attributeCount: patch.attributeCount } : {}),
        ...(patch.lastSyncedAt !== undefined ? { lastSyncedAt: patch.lastSyncedAt } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
      })
      .where(eq(shopeeCategoryAttributeSyncProgress.id, existing.id));
  } else {
    await db.insert(shopeeCategoryAttributeSyncProgress).values({
      shopeeAccountId: accountId,
      categoryId,
      language,
      status: patch.status,
      attributeCount: patch.attributeCount ?? 0,
      lastSyncedAt: patch.lastSyncedAt ?? null,
      errorMessage: patch.errorMessage ?? null,
    });
  }
}

async function upsertAttributeCache(
  categoryId: number,
  language: string,
  tree: ApiAttribute[],
) {
  const [cached] = await db
    .select()
    .from(shopeeCategoryAttributeCache)
    .where(
      and(
        eq(shopeeCategoryAttributeCache.region, REGION),
        eq(shopeeCategoryAttributeCache.categoryId, categoryId),
        eq(shopeeCategoryAttributeCache.language, language),
      ),
    )
    .limit(1);
  if (cached) {
    await db
      .update(shopeeCategoryAttributeCache)
      .set({ attributeTree: tree, attributeCount: tree.length })
      .where(
        and(
          eq(shopeeCategoryAttributeCache.region, REGION),
          eq(shopeeCategoryAttributeCache.categoryId, categoryId),
          eq(shopeeCategoryAttributeCache.language, language),
        ),
      );
  } else {
    await db.insert(shopeeCategoryAttributeCache).values({
      region: REGION,
      categoryId,
      language,
      attributeTree: tree,
      attributeCount: tree.length,
    });
  }
}

/**
 * Sync the attribute_tree for a single (accountId, categoryId, language).
 * Returns fromCache=true when the call short-circuits because of TTL or a
 * fresh in_progress lock held by another worker.
 */
export async function syncAttributesForCategory(
  accountId: number,
  categoryId: number,
  language: string = DEFAULT_LANGUAGE,
): Promise<{ count: number; fromCache: boolean }> {
  const progress = await getProgressRow(accountId, categoryId, language);
  const now = Date.now();

  if (
    progress?.status === "done" &&
    progress.lastSyncedAt &&
    now - new Date(progress.lastSyncedAt).getTime() < TTL_MS
  ) {
    return { count: progress.attributeCount ?? 0, fromCache: true };
  }
  if (
    progress?.status === "in_progress" &&
    progress.updatedAt &&
    now - new Date(progress.updatedAt).getTime() < STALE_LOCK_MS
  ) {
    return { count: progress.attributeCount ?? 0, fromCache: true };
  }

  await upsertProgress(accountId, categoryId, language, { status: "in_progress" });

  const startedAt = Date.now();
  try {
    const { accessToken, shopId } = await shopee.getValidToken(accountId);
    const list = await withRateLimit(
      () => attributeTreeTest.fetchAttributeTree(accessToken, shopId, [categoryId], language),
      { endpoint: `get_attribute_tree cat=${categoryId}` },
    );
    const tree = list.find((e) => e.category_id === categoryId)?.attribute_tree ?? [];

    await upsertAttributeCache(categoryId, language, tree);
    await upsertProgress(accountId, categoryId, language, {
      status: "done",
      attributeCount: tree.length,
      lastSyncedAt: new Date(),
      errorMessage: null,
    });

    const ms = Date.now() - startedAt;
    console.log(
      `[Shopee AttributeSync] cat=${categoryId} synced ${tree.length} attrs em ${ms} ms`,
    );
    return { count: tree.length, fromCache: false };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`[Shopee AttributeSync] cat=${categoryId} failed:`, message);
    await upsertProgress(accountId, categoryId, language, {
      status: "error",
      errorMessage: message.slice(0, 500),
    });
    throw err;
  }
}

/**
 * Lazy reader. Fast path: serve parsed cached JSON. Slow path: trigger a
 * background sync and return [] so the caller (router) can fall back to
 * the static seed in shopee_category_attributes.
 */
export async function getAttributesForCategory(
  accountId: number,
  categoryId: number,
  language: string = DEFAULT_LANGUAGE,
): Promise<ParsedAttribute[]> {
  const [cached] = await db
    .select()
    .from(shopeeCategoryAttributeCache)
    .where(
      and(
        eq(shopeeCategoryAttributeCache.region, REGION),
        eq(shopeeCategoryAttributeCache.categoryId, categoryId),
        eq(shopeeCategoryAttributeCache.language, language),
      ),
    )
    .limit(1);

  const fresh =
    cached && cached.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < TTL_MS;
  if (fresh && Array.isArray(cached!.attributeTree)) {
    return parseAttributeTreeForFrontend(cached!.attributeTree as ApiAttribute[]);
  }

  const progress = await getProgressRow(accountId, categoryId, language);
  const inProgressFresh =
    progress?.status === "in_progress" &&
    progress.updatedAt &&
    Date.now() - new Date(progress.updatedAt).getTime() < STALE_LOCK_MS;
  if (!inProgressFresh) {
    syncAttributesForCategory(accountId, categoryId, language).catch((err) => {
      console.error(
        `[Shopee AttributeSync] background sync failed for cat=${categoryId}:`,
        err?.message ?? err,
      );
    });
  }

  if (cached && Array.isArray(cached.attributeTree)) {
    return parseAttributeTreeForFrontend(cached.attributeTree as ApiAttribute[]);
  }
  return [];
}

/**
 * Worker for the bulk-sync button. Iterates serially to respect Shopee's
 * rate limits. The caller dispatches this via setImmediate so the tRPC
 * mutation returns immediately.
 */
export async function runBulkSync(
  accountId: number,
  categoryIds: number[],
  language: string = DEFAULT_LANGUAGE,
): Promise<{ total: number; synced: number; errors: number; durationMs: number }> {
  const startedAt = Date.now();
  let synced = 0;
  let errors = 0;
  for (const categoryId of categoryIds) {
    try {
      await syncAttributesForCategory(accountId, categoryId, language);
      synced += 1;
    } catch {
      errors += 1;
    }
  }
  return {
    total: categoryIds.length,
    synced,
    errors,
    durationMs: Date.now() - startedAt,
  };
}
