/**
 * Shopee Open Platform API Integration Module
 * Direct integration with Shopee API for OAuth, product management, and marketing.
 *
 * Live API Base: https://partner.shopeemobile.com
 * Auth Base: https://partner.shopeemobile.com
 * Live Partner ID: 2030365
 */

import crypto from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { shopeeAccounts, shopeeProducts } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { db } from "./db";

// Live production endpoints
const SHOPEE_API_BASE = "https://partner.shopeemobile.com";
const SHOPEE_AUTH_BASE = "https://partner.shopeemobile.com";

// ============ SIGNATURE HELPERS ============

/**
 * Generate HMAC-SHA256 signature for Shopee API requests.
 * Shopee requires: partner_id + api_path + timestamp + access_token + shop_id
 */
function generateSignature(
  path: string,
  timestamp: number,
  accessToken?: string,
  shopId?: number
): string {
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const partnerKey = ENV.shopeePartnerKey;

  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) {
    baseString += accessToken;
  }
  if (shopId !== undefined) {
    baseString += shopId;
  }

  return crypto
    .createHmac("sha256", partnerKey)
    .update(baseString)
    .digest("hex");
}

/**
 * Build a signed URL for Shopee API requests
 */
function buildSignedUrl(
  path: string,
  params: Record<string, string | number> = {},
  accessToken?: string,
  shopId?: number
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const sign = generateSignature(path, timestamp, accessToken, shopId);

  const urlParams = new URLSearchParams({
    partner_id: partnerId.toString(),
    timestamp: timestamp.toString(),
    sign,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, v.toString()])
    ),
  });

  if (accessToken) {
    urlParams.set("access_token", accessToken);
  }
  if (shopId !== undefined) {
    urlParams.set("shop_id", shopId.toString());
  }

  return `${SHOPEE_API_BASE}${path}?${urlParams.toString()}`;
}

// ============ OAUTH FLOW ============

/**
 * Generate the OAuth authorization URL for a user to connect their Shopee shop.
 * The user will be redirected to Shopee to authorize the app.
 */
export function getAuthorizationUrl(_redirectUrl?: string, _state?: string): string {
  const partnerId = process.env.SHOPEE_PARTNER_ID!;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY!;
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}`;
  const sign = crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");

  console.log({ partnerId, path, timestamp, baseString, sign });

  const redirect = encodeURIComponent("https://marketplace-sistema-production-04eb.up.railway.app/api/shopee/callback");

  return `https://partner.shopeemobile.com/api/v2/shop/auth_partner?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${redirect}`;
}

/**
 * Exchange the authorization code + shop_id for access_token and refresh_token.
 */
export async function exchangeCodeForToken(code: string, shopId: number) {
  const path = "/api/v2/auth/token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const sign = generateSignature(path, timestamp);

  const url = `${SHOPEE_API_BASE}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      shop_id: shopId,
      partner_id: partnerId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[Shopee OAuth] Token exchange failed:", response.status, errorBody);
    throw new Error(`Shopee OAuth token exchange failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  if (data.error) {
    console.error("[Shopee OAuth] API error:", data.error, data.message);
    throw new Error(`Shopee OAuth error: ${data.error} - ${data.message}`);
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expire_in as number,           // access token lifetime (~4h)
    refreshTokenExpiresIn: (data.refresh_token_expire_in as number) || 2592000, // ~30 days
    shopId: shopId,
  };
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken: string, shopId: number) {
  const path = "/api/v2/auth/access_token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const sign = generateSignature(path, timestamp);

  const url = `${SHOPEE_API_BASE}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      shop_id: shopId,
      partner_id: partnerId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[Shopee] Token refresh failed:", response.status, errorBody);
    throw new Error(`Shopee token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Shopee refresh error: ${data.error} - ${data.message}`);
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expire_in as number,
    refreshTokenExpiresIn: (data.refresh_token_expire_in as number) || 2592000,
  };
}

// ============ TOKEN MANAGEMENT ============

// Per-account lock to prevent concurrent token refreshes (avoids Shopee rotating the
// refresh token while a second request is still trying to use the old one).
const refreshLocks = new Map<number, Promise<void>>();

/**
 * Get a valid access token for a Shopee account, refreshing if expired.
 * Thread-safe: concurrent calls for the same account share one refresh promise.
 */
export async function getValidToken(accountId: number): Promise<{ accessToken: string; shopId: number }> {
  // Wait if another caller is already refreshing this account
  const existing = refreshLocks.get(accountId);
  if (existing) await existing;

  const [account] = await db
    .select()
    .from(shopeeAccounts)
    .where(eq(shopeeAccounts.id, accountId))
    .limit(1);

  if (!account) throw new Error("Shopee account not found");
  if (!account.isActive) throw new Error("Shopee account is inactive");
  if (account.tokenStatus === "needs_reauth") {
    throw new Error("Shopee account needs re-authorization. Please reconnect.");
  }

  const now = new Date();
  const expiresAt = new Date(account.tokenExpiresAt);
  const bufferMs = 5 * 60 * 1000; // 5 min buffer

  if (now.getTime() + bufferMs < expiresAt.getTime()) {
    return { accessToken: account.accessToken, shopId: account.shopId };
  }

  // Token expired or about to expire — acquire lock and refresh
  console.log(`[Shopee] Refreshing token for shop ${account.shopId}...`);
  let resolveLock!: () => void;
  const lockPromise = new Promise<void>(r => { resolveLock = r; });
  refreshLocks.set(accountId, lockPromise);

  try {
    const refreshed = await refreshAccessToken(account.refreshToken, account.shopId);
    const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
    const newRefreshExpiresAt = new Date(Date.now() + refreshed.refreshTokenExpiresIn * 1000);

    await db
      .update(shopeeAccounts)
      .set({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenExpiresAt: newExpiresAt,
        refreshTokenExpiresAt: newRefreshExpiresAt,
        tokenStatus: "active",
        lastUsedAt: new Date(),
      })
      .where(eq(shopeeAccounts.id, accountId));

    console.log(`[Shopee] Token refreshed for shop ${account.shopId}, expires ${newExpiresAt.toISOString()}`);
    return { accessToken: refreshed.accessToken, shopId: account.shopId };
  } catch (err: any) {
    console.error(`[Shopee] Token refresh failed for account ${accountId}:`, err.message);
    // Mark as needing re-authorization so the frontend can show the right state
    await db
      .update(shopeeAccounts)
      .set({ tokenStatus: "needs_reauth" })
      .where(eq(shopeeAccounts.id, accountId));
    throw err;
  } finally {
    resolveLock();
    refreshLocks.delete(accountId);
  }

}

// ============ SHOP API ============

/**
 * Get shop info from Shopee API.
 */
export async function getShopInfo(accessToken: string, shopId: number) {
  const path = "/api/v2/shop/get_shop_info";
  const url = buildSignedUrl(path, {}, accessToken, shopId);

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(`Shopee API error: ${data.error} - ${data.message}`);
  }

  return data.response;
}

// ============ PRODUCT API ============

/**
 * Get list of all item IDs in the shop.
 */
export async function getItemList(
  accessToken: string,
  shopId: number,
  offset: number = 0,
  pageSize: number = 100,
  itemStatus: string = "NORMAL"
) {
  const path = "/api/v2/product/get_item_list";
  const url = buildSignedUrl(
    path,
    {
      offset,
      page_size: pageSize,
      item_status: itemStatus,
    },
    accessToken,
    shopId
  );

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(`Shopee API error: ${data.error} - ${data.message}`);
  }

  return {
    items: data.response?.item as Array<{ item_id: number; item_status: string; update_time: number }> || [],
    totalCount: data.response?.total_count as number || 0,
    hasNextPage: data.response?.has_next_page as boolean || false,
    nextOffset: data.response?.next_offset as number || 0,
  };
}

/**
 * Get base info for multiple items (up to 50 at a time).
 */
export async function getItemBaseInfo(
  accessToken: string,
  shopId: number,
  itemIds: number[]
) {
  if (itemIds.length === 0) return [];
  if (itemIds.length > 50) {
    throw new Error("getItemBaseInfo supports max 50 items per request");
  }

  const path = "/api/v2/product/get_item_base_info";
  const url = buildSignedUrl(
    path,
    {
      item_id_list: itemIds.join(","),
    },
    accessToken,
    shopId
  );

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(`Shopee API error: ${data.error} - ${data.message}`);
  }

  return data.response?.item_list || [];
}

/**
 * Get extra info for items (sales, rating, etc.).
 */
export async function getItemExtraInfo(
  accessToken: string,
  shopId: number,
  itemIds: number[]
) {
  if (itemIds.length === 0) return [];
  if (itemIds.length > 50) {
    throw new Error("getItemExtraInfo supports max 50 items per request");
  }

  const path = "/api/v2/product/get_item_extra_info";
  const url = buildSignedUrl(
    path,
    {
      item_id_list: itemIds.join(","),
    },
    accessToken,
    shopId
  );

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(`Shopee API error: ${data.error} - ${data.message}`);
  }

  return data.response?.item_list || [];
}

/**
 * Update one or more fields of an item via Shopee API (update_item).
 * Pass only the fields you want to change alongside item_id.
 */
export async function updateItemFields(
  accessToken: string,
  shopId: number,
  itemId: number,
  fields: { name?: string; description?: string }
): Promise<void> {
  const path = "/api/v2/product/update_item";
  const url = buildSignedUrl(path, {}, accessToken, shopId);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId, ...fields }),
  });

  const data = await response.json();
  if (!response.ok || (data.error && data.error !== "")) {
    throw new Error(`Shopee update_item failed: ${data.error || response.status} - ${data.message || response.statusText}`);
  }
}

/** Convenience wrapper — update title only. */
export async function updateItemName(
  accessToken: string,
  shopId: number,
  itemId: number,
  name: string
): Promise<void> {
  return updateItemFields(accessToken, shopId, itemId, { name });
}

// ============ ACCOUNT MANAGEMENT ============

/**
 * Save or update a Shopee account after OAuth.
 */
export async function saveAccount(
  userId: number,
  shopId: number,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  shopName?: string,
  refreshTokenExpiresIn?: number
) {
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  const refreshTokenExpiresAt = new Date(
    Date.now() + (refreshTokenExpiresIn ?? 2592000) * 1000
  );

  console.log("[saveAccount] Buscando conta existente:", { userId, shopId });
  let existing: typeof shopeeAccounts.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(shopeeAccounts)
      .where(and(eq(shopeeAccounts.userId, userId), eq(shopeeAccounts.shopId, shopId)))
      .limit(1);
    existing = rows[0];
  } catch (err: any) {
    console.error("[saveAccount] Erro no SELECT:", err.message, "cause:", err.cause?.message ?? err.cause, "code:", err.cause?.code ?? err.code);
    throw err;
  }

  if (existing) {
    console.log("[saveAccount] Atualizando conta existente id:", existing.id);
    try {
      await db
        .update(shopeeAccounts)
        .set({
          accessToken,
          refreshToken,
          tokenExpiresAt,
          refreshTokenExpiresAt,
          tokenStatus: "active",
          shopName: shopName || existing.shopName,
          isActive: 1,
        })
        .where(eq(shopeeAccounts.id, existing.id));
    } catch (err: any) {
      console.error("[saveAccount] Erro no UPDATE:", err.message, "cause:", err.cause?.message ?? err.cause, "code:", err.cause?.code ?? err.code);
      throw err;
    }
    return existing.id;
  } else {
    console.log("[saveAccount] Inserindo nova conta");
    try {
      const [result] = await db.insert(shopeeAccounts).values({
        userId,
        shopId,
        shopName: shopName || `Loja Shopee ${shopId}`,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        refreshTokenExpiresAt,
        tokenStatus: "active",
        region: "BR",
        isActive: 1,
      });
      console.log("[saveAccount] Inserido com sucesso, insertId:", result.insertId);
      return result.insertId;
    } catch (err: any) {
      console.error("[saveAccount] Erro no INSERT:", err.message, "cause:", err.cause?.message ?? err.cause, "code:", err.cause?.code ?? err.code);
      throw err;
    }
  }
}

/**
 * Get all Shopee accounts for a user.
 */
export async function getAccounts(userId: number) {
  return db
    .select({
      id: shopeeAccounts.id,
      shopId: shopeeAccounts.shopId,
      shopName: shopeeAccounts.shopName,
      region: shopeeAccounts.region,
      shopStatus: shopeeAccounts.shopStatus,
      totalProducts: shopeeAccounts.totalProducts,
      isActive: shopeeAccounts.isActive,
      tokenStatus: shopeeAccounts.tokenStatus,
      tokenExpiresAt: shopeeAccounts.tokenExpiresAt,
      refreshTokenExpiresAt: shopeeAccounts.refreshTokenExpiresAt,
      lastSyncAt: shopeeAccounts.lastSyncAt,
      createdAt: shopeeAccounts.createdAt,
    })
    .from(shopeeAccounts)
    .where(eq(shopeeAccounts.userId, userId))
    .orderBy(desc(shopeeAccounts.createdAt));
}

/**
 * Delete (deactivate) a Shopee account.
 */
export async function deactivateAccount(userId: number, accountId: number) {
  await db
    .update(shopeeAccounts)
    .set({ isActive: 0 })
    .where(and(eq(shopeeAccounts.id, accountId), eq(shopeeAccounts.userId, userId)));
}

// ============ PRODUCT SYNC ============

// ─── INTERNAL: collect item IDs across all statuses ──────────────────────────

async function _collectIds(
  accessToken: string,
  shopId: number
): Promise<{ itemIds: number[]; byStatus: Record<string, number> }> {
  const ALL_STATUSES = ["NORMAL", "UNLIST", "BANNED"] as const;
  const PAGE_SIZE = 100;
  const DELAY_MS = 300;

  const allIds = new Set<number>();
  const byStatus: Record<string, number> = {};

  for (const status of ALL_STATUSES) {
    let offset = 0;
    let page = 0;
    let statusCount = 0;
    while (true) {
      page++;
      const result = await getItemList(accessToken, shopId, offset, PAGE_SIZE, status);
      const items = result.items || [];

      console.log(
        `[Shopee] ${status} page ${page} offset ${offset}: ${items.length} items` +
        ` (total=${result.totalCount}, has_next=${result.hasNextPage}, next_offset=${result.nextOffset})`
      );

      if (items.length === 0) break;
      items.forEach((i) => allIds.add(i.item_id));
      statusCount += items.length;
      if (!result.hasNextPage) break;
      offset = result.nextOffset > 0 ? result.nextOffset : offset + PAGE_SIZE;
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
    if (statusCount > 0) byStatus[status] = statusCount;
  }

  return { itemIds: Array.from(allIds), byStatus };
}

// ─── PUBLIC BUILDING BLOCKS (used by background worker for checkpointed sync) ─

/**
 * Collect all item IDs using an existing access token.
 * Call getValidToken once before this — avoids redundant token fetches.
 */
export async function collectAllItemIds(
  accessToken: string,
  shopId: number
): Promise<{ itemIds: number[]; byStatus: Record<string, number> }> {
  return _collectIds(accessToken, shopId);
}

/**
 * Count all item IDs across NORMAL/UNLIST/BANNED (no product details, fast).
 */
export async function countShopeeItems(
  accountId: number
): Promise<{ total: number; byStatus: Record<string, number> }> {
  const { accessToken, shopId } = await getValidToken(accountId);
  const { itemIds, byStatus } = await _collectIds(accessToken, shopId);
  return { total: itemIds.length, byStatus };
}

/**
 * Upsert a single batch (max 50) of items into the local DB.
 * Returns per-batch add/update/error counts.
 */
export async function upsertItemBatch(
  accessToken: string,
  shopId: number,
  userId: number,
  accountId: number,
  itemIds: number[]
): Promise<{ added: number; updated: number; errors: Array<{ itemId: number; error: string }> }> {
  let added = 0;
  let updated = 0;
  const errors: Array<{ itemId: number; error: string }> = [];

  let items: any[] = [];
  try {
    items = await getItemBaseInfo(accessToken, shopId, itemIds);
  } catch (e: any) {
    console.warn(`[Shopee] getItemBaseInfo failed:`, e.message);
    itemIds.forEach((id) => errors.push({ itemId: id, error: `getItemBaseInfo: ${e.message}` }));
    return { added, updated, errors };
  }

  let extraInfoMap: Record<number, any> = {};
  try {
    const extraItems = await getItemExtraInfo(accessToken, shopId, itemIds);
    for (const ei of extraItems) extraInfoMap[ei.item_id] = ei;
  } catch (e) {
    console.warn("[Shopee] Failed to get extra info for batch:", e);
  }

  for (const item of items) {
    try {
      const extra = extraInfoMap[item.item_id] || {};
      const mainImage = item.image?.image_url_list?.[0] || "";
      const allImages = item.image?.image_url_list || [];
      const priceInfo = item.price_info?.[0] || {};
      const stockInfo = item.stock_info_v2?.summary_info || {};
      const attrs = item.attribute_list || [];
      const filledAttrs = attrs.filter((a: any) => a.attribute_value_list?.length > 0).length;

      const [existing] = await db
        .select({ id: shopeeProducts.id })
        .from(shopeeProducts)
        .where(and(eq(shopeeProducts.shopeeAccountId, accountId), eq(shopeeProducts.itemId, item.item_id)))
        .limit(1);

      const payload = {
        userId,
        shopeeAccountId: accountId,
        itemId: item.item_id,
        itemName: item.item_name || "",
        itemSku: item.item_sku || "",
        itemStatus: item.item_status || "NORMAL",
        categoryId: item.category_id || null,
        price: priceInfo.current_price?.toString() || priceInfo.original_price?.toString() || "0",
        stock: stockInfo.total_available_stock || 0,
        sold: extra.sale || 0,
        rating: extra.rating_star?.toString() || "0",
        imageUrl: mainImage,
        images: allImages,
        hasVideo: item.video_info?.length > 0 ? 1 : 0,
        attributes: attrs,
        attributesFilled: filledAttrs,
        attributesTotal: attrs.length,
        variations: item.model_list || null,
        weight: item.weight?.toString() || "0",
        dimensionLength: item.dimension?.package_length?.toString() || "",
        dimensionWidth: item.dimension?.package_width?.toString() || "",
        dimensionHeight: item.dimension?.package_height?.toString() || "",
        description: item.description || "",
        lastSyncAt: new Date(),
      };

      if (existing) {
        await db.update(shopeeProducts).set(payload).where(eq(shopeeProducts.id, existing.id));
        updated++;
      } else {
        await db.insert(shopeeProducts).values(payload);
        added++;
      }
    } catch (e: any) {
      console.warn(`[Shopee] Failed to upsert item ${item.item_id}:`, e.message);
      errors.push({ itemId: item.item_id, error: e.message });
    }
  }

  return { added, updated, errors };
}

/**
 * Delete local products whose IDs are no longer present in Shopee.
 */
export async function removeStaleProducts(
  accountId: number,
  liveIds: Set<number>
): Promise<number> {
  const local = await db
    .select({ id: shopeeProducts.id, itemId: shopeeProducts.itemId })
    .from(shopeeProducts)
    .where(eq(shopeeProducts.shopeeAccountId, accountId));

  let removed = 0;
  for (const p of local) {
    if (!liveIds.has(Number(p.itemId))) {
      await db.delete(shopeeProducts).where(eq(shopeeProducts.id, p.id));
      removed++;
    }
  }
  return removed;
}

/**
 * Update totalProducts + lastSyncAt on a Shopee account row.
 */
export async function updateAccountSyncMeta(
  accountId: number,
  totalProducts: number
): Promise<void> {
  await db
    .update(shopeeAccounts)
    .set({ totalProducts, lastSyncAt: new Date() })
    .where(eq(shopeeAccounts.id, accountId));
}

// ─── FULL BLOCKING SYNC (used directly via tRPC for small shops) ──────────────

/**
 * Sync all products from a Shopee shop to local database (blocking).
 */
export async function syncProducts(
  userId: number,
  accountId: number,
  onProgress?: (current: number, total: number, page?: number) => void
): Promise<{ added: number; updated: number; removed: number; total: number; errors: Array<{ itemId: number; error: string }> }> {
  const { accessToken, shopId } = await getValidToken(accountId);

  const { itemIds: allItemIds } = await collectAllItemIds(accessToken, shopId);
  const totalItems = allItemIds.length;
  let added = 0;
  let updated = 0;
  let page = 0;
  const errors: Array<{ itemId: number; error: string }> = [];

  console.log(`[Shopee] Collected ${totalItems} item IDs. Starting upsert...`);

  for (let i = 0; i < allItemIds.length; i += 50) {
    page++;
    const batch = allItemIds.slice(i, i + 50);
    const result = await upsertItemBatch(accessToken, shopId, userId, accountId, batch);
    added += result.added;
    updated += result.updated;
    errors.push(...result.errors);
    if (onProgress) onProgress(added + updated, totalItems, page);
    if (i + 50 < allItemIds.length) await new Promise((r) => setTimeout(r, 500));
  }

  const removed = await removeStaleProducts(accountId, new Set(allItemIds));
  await updateAccountSyncMeta(accountId, totalItems);

  console.log(
    `[Shopee] Sync done — added: ${added}, updated: ${updated}, removed: ${removed}, ` +
    `total: ${totalItems}, errors: ${errors.length}`
  );
  return { added, updated, removed, total: totalItems, errors };
}

/**
 * Get synced products from local database with pagination.
 */
export async function getLocalProducts(
  accountId: number,
  offset: number = 0,
  limit: number = 50
) {
  const products = await db
    .select()
    .from(shopeeProducts)
    .where(eq(shopeeProducts.shopeeAccountId, accountId))
    .orderBy(desc(shopeeProducts.sold))
    .limit(limit)
    .offset(offset);

  return products;
}

/**
 * Get product count for an account.
 */
export async function getProductCount(accountId: number) {
  const result = await db
    .select({ id: shopeeProducts.id })
    .from(shopeeProducts)
    .where(eq(shopeeProducts.shopeeAccountId, accountId));
  return result.length;
}

/**
 * Get product quality stats for an account.
 */
export async function getProductQualityStats(accountId: number) {
  const products = await db
    .select({
      attributesFilled: shopeeProducts.attributesFilled,
      attributesTotal: shopeeProducts.attributesTotal,
      hasVideo: shopeeProducts.hasVideo,
      images: shopeeProducts.images,
      description: shopeeProducts.description,
    })
    .from(shopeeProducts)
    .where(eq(shopeeProducts.shopeeAccountId, accountId));

  let withVideo = 0;
  let with5PlusImages = 0;
  let withDescription = 0;
  let totalAttrsFilled = 0;
  let totalAttrsTotal = 0;

  for (const p of products) {
    if (p.hasVideo) withVideo++;
    const imgCount = Array.isArray(p.images) ? p.images.length : 0;
    if (imgCount >= 5) with5PlusImages++;
    if (p.description && p.description.length > 50) withDescription++;
    totalAttrsFilled += p.attributesFilled || 0;
    totalAttrsTotal += p.attributesTotal || 0;
  }

  const total = products.length;
  return {
    total,
    withVideo,
    withVideoPercent: total > 0 ? Math.round((withVideo / total) * 100) : 0,
    with5PlusImages,
    with5PlusImagesPercent: total > 0 ? Math.round((with5PlusImages / total) * 100) : 0,
    withDescription,
    withDescriptionPercent: total > 0 ? Math.round((withDescription / total) * 100) : 0,
    avgAttrsFilled: totalAttrsTotal > 0 ? Math.round((totalAttrsFilled / totalAttrsTotal) * 100) : 0,
  };
}
