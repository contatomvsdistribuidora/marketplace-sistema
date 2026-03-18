/**
 * Shopee Open Platform API Integration Module
 * Direct integration with Shopee API for OAuth, product management, and marketing.
 *
 * API Base (Brazil): https://openplatform.shopee.com.br
 * Sandbox: https://openplatform.sandbox.test-stable.shopee.sg
 * Partner ID: 1219908 (Test)
 */

import crypto from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { shopeeAccounts, shopeeProducts } from "../drizzle/schema";
import { ENV } from "./_core/env";

// Use test/sandbox environment while in Developing status
const SHOPEE_API_BASE = "https://openplatform.shopee.com.br";
const SHOPEE_AUTH_BASE = "https://openplatform.shopee.com.br";

// ============ DATABASE HELPERS ============

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return drizzle(process.env.DATABASE_URL);
}

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
export function getAuthorizationUrl(redirectUrl: string, state?: string): string {
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const sign = generateSignature(path, timestamp);

  const params = new URLSearchParams({
    partner_id: partnerId.toString(),
    timestamp: timestamp.toString(),
    sign,
    redirect: redirectUrl,
  });

  if (state) {
    // Encode state in the redirect URL as query param
    const redirectWithState = `${redirectUrl}${redirectUrl.includes("?") ? "&" : "?"}state=${encodeURIComponent(state)}`;
    params.set("redirect", redirectWithState);
  }

  return `${SHOPEE_AUTH_BASE}${path}?${params.toString()}`;
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
    expiresIn: data.expire_in as number, // seconds (usually 14400 = 4 hours)
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
  };
}

// ============ TOKEN MANAGEMENT ============

/**
 * Get a valid access token for a Shopee account, refreshing if expired.
 */
export async function getValidToken(accountId: number): Promise<{ accessToken: string; shopId: number }> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(shopeeAccounts)
    .where(eq(shopeeAccounts.id, accountId))
    .limit(1);

  if (!account) throw new Error("Shopee account not found");
  if (!account.isActive) throw new Error("Shopee account is inactive");

  const now = new Date();
  const expiresAt = new Date(account.tokenExpiresAt);
  const bufferMs = 5 * 60 * 1000; // 5 min buffer

  if (now.getTime() + bufferMs < expiresAt.getTime()) {
    // Token still valid
    return { accessToken: account.accessToken, shopId: account.shopId };
  }

  // Token expired or about to expire, refresh it
  console.log(`[Shopee] Refreshing token for shop ${account.shopId}...`);
  const refreshed = await refreshAccessToken(account.refreshToken, account.shopId);

  // Update in database
  await db
    .update(shopeeAccounts)
    .set({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
    })
    .where(eq(shopeeAccounts.id, accountId));

  return { accessToken: refreshed.accessToken, shopId: account.shopId };
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
  shopName?: string
) {
  const db = getDb();
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  // Check if account already exists
  const [existing] = await db
    .select()
    .from(shopeeAccounts)
    .where(and(eq(shopeeAccounts.userId, userId), eq(shopeeAccounts.shopId, shopId)))
    .limit(1);

  if (existing) {
    // Update existing account
    await db
      .update(shopeeAccounts)
      .set({
        accessToken,
        refreshToken,
        tokenExpiresAt,
        shopName: shopName || existing.shopName,
        isActive: 1,
      })
      .where(eq(shopeeAccounts.id, existing.id));
    return existing.id;
  } else {
    // Insert new account
    const [result] = await db.insert(shopeeAccounts).values({
      userId,
      shopId,
      shopName: shopName || `Loja Shopee ${shopId}`,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      region: "BR",
      isActive: 1,
    });
    return result.insertId;
  }
}

/**
 * Get all Shopee accounts for a user.
 */
export async function getAccounts(userId: number) {
  const db = getDb();
  return db
    .select({
      id: shopeeAccounts.id,
      shopId: shopeeAccounts.shopId,
      shopName: shopeeAccounts.shopName,
      region: shopeeAccounts.region,
      shopStatus: shopeeAccounts.shopStatus,
      totalProducts: shopeeAccounts.totalProducts,
      isActive: shopeeAccounts.isActive,
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
  const db = getDb();
  await db
    .update(shopeeAccounts)
    .set({ isActive: 0 })
    .where(and(eq(shopeeAccounts.id, accountId), eq(shopeeAccounts.userId, userId)));
}

// ============ PRODUCT SYNC ============

/**
 * Sync all products from a Shopee shop to local database.
 * Returns the count of synced products.
 */
export async function syncProducts(
  userId: number,
  accountId: number,
  onProgress?: (current: number, total: number) => void
): Promise<{ synced: number; total: number }> {
  const { accessToken, shopId } = await getValidToken(accountId);
  const db = getDb();

  let allItemIds: number[] = [];
  let offset = 0;
  let hasMore = true;

  // Step 1: Get all item IDs
  while (hasMore) {
    const result = await getItemList(accessToken, shopId, offset, 100, "NORMAL");
    allItemIds.push(...result.items.map((i) => i.item_id));
    hasMore = result.hasNextPage;
    offset = result.nextOffset;
  }

  // Also get UNLIST items
  offset = 0;
  hasMore = true;
  while (hasMore) {
    const result = await getItemList(accessToken, shopId, offset, 100, "UNLIST");
    allItemIds.push(...result.items.map((i) => i.item_id));
    hasMore = result.hasNextPage;
    offset = result.nextOffset;
  }

  const totalItems = allItemIds.length;
  let synced = 0;

  // Step 2: Get base info in batches of 50
  for (let i = 0; i < allItemIds.length; i += 50) {
    const batch = allItemIds.slice(i, i + 50);
    const items = await getItemBaseInfo(accessToken, shopId, batch);

    // Get extra info for this batch
    let extraInfoMap: Record<number, any> = {};
    try {
      const extraItems = await getItemExtraInfo(accessToken, shopId, batch);
      for (const ei of extraItems) {
        extraInfoMap[ei.item_id] = ei;
      }
    } catch (e) {
      console.warn("[Shopee] Failed to get extra info for batch:", e);
    }

    for (const item of items) {
      const extra = extraInfoMap[item.item_id] || {};
      const mainImage = item.image?.image_url_list?.[0] || "";
      const allImages = item.image?.image_url_list || [];
      const priceInfo = item.price_info?.[0] || {};
      const stockInfo = item.stock_info_v2?.summary_info || {};
      const attrs = item.attribute_list || [];
      const filledAttrs = attrs.filter((a: any) => a.attribute_value_list?.length > 0).length;

      // Upsert product
      const [existing] = await db
        .select()
        .from(shopeeProducts)
        .where(
          and(
            eq(shopeeProducts.shopeeAccountId, accountId),
            eq(shopeeProducts.itemId, item.item_id)
          )
        )
        .limit(1);

      const productData = {
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
        await db
          .update(shopeeProducts)
          .set(productData)
          .where(eq(shopeeProducts.id, existing.id));
      } else {
        await db.insert(shopeeProducts).values(productData);
      }

      synced++;
      if (onProgress) {
        onProgress(synced, totalItems);
      }
    }

    // Rate limiting: Shopee allows ~10 requests/second for shop-level APIs
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Update account total products
  await db
    .update(shopeeAccounts)
    .set({
      totalProducts: totalItems,
      lastSyncAt: new Date(),
    })
    .where(eq(shopeeAccounts.id, accountId));

  return { synced, total: totalItems };
}

/**
 * Get synced products from local database with pagination.
 */
export async function getLocalProducts(
  accountId: number,
  offset: number = 0,
  limit: number = 50
) {
  const db = getDb();
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
  const db = getDb();
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
  const db = getDb();
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
