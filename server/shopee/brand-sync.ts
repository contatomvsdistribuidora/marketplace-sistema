/**
 * Lazy + bulk brand-sync infrastructure for Shopee categories.
 *
 * The data model:
 *   shopee_brand_cache         — one row per (region, categoryId) holding the
 *                                full brandList JSON array (existing table).
 *   shopee_brand_sync_progress — per (accountId, categoryId) state machine
 *                                that drives lazy reads and bulk syncs.
 *
 * Reading flow (getBrandsForCategory):
 *   - Cache hit (updatedAt < TTL): return brands.
 *   - Cache miss + no recent sync: fire-and-forget syncBrandsForCategory,
 *     return [] (the wizard polls / refetches on focus, so the next read
 *     gets the populated data).
 *   - Cache miss + sync in progress: return [] (don't double-sync).
 *
 * Writing flow (syncBrandsForCategory):
 *   - If progress row says done & < 24h old: bail out as a cache hit.
 *   - If progress row says in_progress < 5min ago: bail (another worker
 *     is already on it).
 *   - Otherwise: claim in_progress, fetch all pages from Shopee with
 *     rate-limit + retry, write the full brandList JSON in one upsert
 *     at the end, mark done.
 *
 * Errors don't poison the cache: status='error' allows retry on the next
 * call (effectively a 1h TTL via the in_progress staleness check).
 */

import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { ENV } from "../_core/env";
import { shopeeBrandCache, shopeeBrandSyncProgress } from "../../drizzle/schema";
import { withRateLimit, ShopeeHttpError } from "./rate-limit";
import * as shopee from "../shopee";

const SHOPEE_API_BASE = "https://partner.shopeemobile.com";
const BRAND_LIST_PATH = "/api/v2/product/get_brand_list";
const PAGE_SIZE = 30;
const MAX_PAGES = 50;
const REGION = "BR";
const LANGUAGE = "pt-br";

export const TTL_MS = 24 * 60 * 60 * 1000;
export const STALE_LOCK_MS = 5 * 60 * 1000;

export interface ShopeeBrand {
  brand_id: number;
  original_brand_name: string;
  display_brand_name?: string;
}

export interface BrandPage {
  brand_list: ShopeeBrand[];
  is_end: boolean;
}

function sign(path: string, ts: number, accessToken: string, shopId: number): string {
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const baseString = `${partnerId}${path}${ts}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", ENV.shopeePartnerKey).update(baseString).digest("hex");
}

/**
 * Fetch a single page of /api/v2/product/get_brand_list. Internal callers
 * route through `__test.fetchBrandPage` (default = this function) so tests
 * can swap the implementation without mocking global fetch.
 */
export async function fetchBrandPage(
  accessToken: string,
  shopId: number,
  categoryId: number,
  offset: number,
): Promise<BrandPage> {
  const ts = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const signature = sign(BRAND_LIST_PATH, ts, accessToken, shopId);
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(ts),
    access_token: accessToken,
    shop_id: String(shopId),
    sign: signature,
    category_id: String(categoryId),
    status: "1",
    offset: String(offset),
    page_size: String(PAGE_SIZE),
    language: LANGUAGE,
  });
  const url = `${SHOPEE_API_BASE}${BRAND_LIST_PATH}?${params.toString()}`;
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    throw new ShopeeHttpError(res.status, `get_brand_list HTTP ${res.status}`, text);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ShopeeHttpError(res.status, `get_brand_list non-JSON response`, text);
  }
  if (parsed.error && parsed.error !== "") {
    // Shopee API errors come with HTTP 200 — map auth/permission errors so
    // retry doesn't waste calls.
    const msg = `Shopee ${parsed.error}: ${parsed.message ?? ""}`;
    if (parsed.error === "error_auth" || parsed.error === "error_permission") {
      throw new ShopeeHttpError(401, msg, text);
    }
    throw new ShopeeHttpError(500, msg, text);
  }
  const brand_list: ShopeeBrand[] = Array.isArray(parsed.response?.brand_list)
    ? parsed.response.brand_list
    : [];
  const is_end = !!parsed.response?.is_end;
  return { brand_list, is_end };
}

/**
 * Mutable indirection so tests can stub the network call. The SUT *must*
 * always go through `__test.fetchBrandPage(...)` instead of calling the
 * exported function directly — otherwise spies don't intercept it.
 */
export const __test = {
  fetchBrandPage: (
    accessToken: string,
    shopId: number,
    categoryId: number,
    offset: number,
  ) => fetchBrandPage(accessToken, shopId, categoryId, offset),
};

async function getProgressRow(accountId: number, categoryId: number) {
  const [row] = await db
    .select()
    .from(shopeeBrandSyncProgress)
    .where(
      and(
        eq(shopeeBrandSyncProgress.shopeeAccountId, accountId),
        eq(shopeeBrandSyncProgress.categoryId, categoryId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function upsertProgress(
  accountId: number,
  categoryId: number,
  patch: {
    status: "pending" | "in_progress" | "done" | "error";
    totalBrands?: number;
    syncedPages?: number;
    lastSyncedAt?: Date | null;
    errorMessage?: string | null;
  },
) {
  const existing = await getProgressRow(accountId, categoryId);
  if (existing) {
    await db
      .update(shopeeBrandSyncProgress)
      .set({
        status: patch.status,
        ...(patch.totalBrands !== undefined ? { totalBrands: patch.totalBrands } : {}),
        ...(patch.syncedPages !== undefined ? { syncedPages: patch.syncedPages } : {}),
        ...(patch.lastSyncedAt !== undefined ? { lastSyncedAt: patch.lastSyncedAt } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
      })
      .where(eq(shopeeBrandSyncProgress.id, existing.id));
  } else {
    await db.insert(shopeeBrandSyncProgress).values({
      shopeeAccountId: accountId,
      categoryId,
      status: patch.status,
      totalBrands: patch.totalBrands ?? 0,
      syncedPages: patch.syncedPages ?? 0,
      lastSyncedAt: patch.lastSyncedAt ?? null,
      errorMessage: patch.errorMessage ?? null,
    });
  }
}

async function upsertBrandCache(categoryId: number, brands: ShopeeBrand[]) {
  const [cached] = await db
    .select()
    .from(shopeeBrandCache)
    .where(and(eq(shopeeBrandCache.region, REGION), eq(shopeeBrandCache.categoryId, categoryId)))
    .limit(1);
  if (cached) {
    await db
      .update(shopeeBrandCache)
      .set({ brandList: brands })
      .where(and(eq(shopeeBrandCache.region, REGION), eq(shopeeBrandCache.categoryId, categoryId)));
  } else {
    await db.insert(shopeeBrandCache).values({
      region: REGION,
      categoryId,
      brandList: brands,
    });
  }
}

/**
 * Sync brands for a single (accountId, categoryId). Returns fromCache=true
 * when the call short-circuits because of TTL or another worker holding
 * the in_progress lock.
 */
export async function syncBrandsForCategory(
  accountId: number,
  categoryId: number,
): Promise<{ totalBrands: number; fromCache: boolean }> {
  const progress = await getProgressRow(accountId, categoryId);
  const now = Date.now();

  if (
    progress?.status === "done" &&
    progress.lastSyncedAt &&
    now - new Date(progress.lastSyncedAt).getTime() < TTL_MS
  ) {
    return { totalBrands: progress.totalBrands ?? 0, fromCache: true };
  }
  if (
    progress?.status === "in_progress" &&
    progress.updatedAt &&
    now - new Date(progress.updatedAt).getTime() < STALE_LOCK_MS
  ) {
    return { totalBrands: progress.totalBrands ?? 0, fromCache: true };
  }

  await upsertProgress(accountId, categoryId, { status: "in_progress" });

  const startedAt = Date.now();
  try {
    const { accessToken, shopId } = await shopee.getValidToken(accountId);
    const all: ShopeeBrand[] = [];
    let offset = 0;
    let pages = 0;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await withRateLimit(
        () => __test.fetchBrandPage(accessToken, shopId, categoryId, offset),
        { endpoint: `get_brand_list cat=${categoryId} offset=${offset}` },
      );
      pages += 1;
      all.push(...page.brand_list);
      if (page.is_end || page.brand_list.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    await upsertBrandCache(categoryId, all);
    await upsertProgress(accountId, categoryId, {
      status: "done",
      totalBrands: all.length,
      syncedPages: pages,
      lastSyncedAt: new Date(),
      errorMessage: null,
    });

    const ms = Date.now() - startedAt;
    console.log(
      `[Shopee BrandSync] cat=${categoryId} synced ${all.length} brands em ${pages} paginas em ${ms} ms`,
    );
    return { totalBrands: all.length, fromCache: false };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`[Shopee BrandSync] cat=${categoryId} failed:`, message);
    await upsertProgress(accountId, categoryId, {
      status: "error",
      errorMessage: message.slice(0, 500),
    });
    throw err;
  }
}

/**
 * Lazy reader. Fast path: serve the cached JSON. Slow path: trigger a
 * background sync and return [] so the UI can render an empty dropdown
 * while the data lands.
 */
export async function getBrandsForCategory(
  accountId: number,
  categoryId: number,
): Promise<ShopeeBrand[]> {
  const [cached] = await db
    .select()
    .from(shopeeBrandCache)
    .where(and(eq(shopeeBrandCache.region, REGION), eq(shopeeBrandCache.categoryId, categoryId)))
    .limit(1);
  const fresh =
    cached && cached.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < TTL_MS;
  if (fresh && Array.isArray(cached!.brandList)) {
    return cached!.brandList as ShopeeBrand[];
  }

  const progress = await getProgressRow(accountId, categoryId);
  const inProgressFresh =
    progress?.status === "in_progress" &&
    progress.updatedAt &&
    Date.now() - new Date(progress.updatedAt).getTime() < STALE_LOCK_MS;
  if (!inProgressFresh) {
    // Fire and forget — the wizard refetches on focus / on next call.
    syncBrandsForCategory(accountId, categoryId).catch((err) => {
      console.error(`[Shopee BrandSync] background sync failed for cat=${categoryId}:`, err?.message ?? err);
    });
  }

  if (cached && Array.isArray(cached.brandList)) {
    // Stale-while-revalidate: serve the previous list while the bg sync runs.
    return cached.brandList as ShopeeBrand[];
  }
  return [];
}

/**
 * Worker for the bulk-sync button. Iterates serially to respect Shopee's
 * rate limits. The caller is expected to dispatch this with setImmediate
 * so the tRPC mutation returns immediately.
 */
export async function runBulkSync(
  accountId: number,
  categoryIds: number[],
): Promise<{ total: number; synced: number; errors: number; durationMs: number }> {
  const startedAt = Date.now();
  let synced = 0;
  let errors = 0;
  for (const categoryId of categoryIds) {
    try {
      await syncBrandsForCategory(accountId, categoryId);
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
