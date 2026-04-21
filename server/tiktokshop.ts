/**
 * TikTok Shop API integration module
 * Handles OAuth, request signing, product management
 */
import crypto from "crypto";
import { ENV } from "./_core/env";
import { db } from "./db";
import { tiktokAccounts, tiktokListings } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── Constants ───────────────────────────────────────────────────────────────
const TT_AUTH_BASE = "https://auth.tiktok-shops.com";
const TT_API_BASE = "https://open-api.tiktokglobalshop.com";
const TT_AUTH_URL_US = "https://services.us.tiktokshop.com/open/authorize";
const TT_AUTH_URL_GLOBAL = "https://services.tiktokshop.com/open/authorize";
const PROD_DOMAIN = "https://blmarketexp-nqnujejx.manus.space";
const TT_CALLBACK_PATH = "/api/tiktok/callback";
const API_VERSION = "202309";

// ─── HMAC-SHA256 Signature ──────────────────────────────────────────────────
export function generateSign(
  path: string,
  queryParams: Record<string, string>,
  body: string | null,
  appSecret: string
): string {
  // 1. Extract all query params except sign and access_token, sort alphabetically
  const keys = Object.keys(queryParams)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();

  // 2. Concatenate key+value pairs
  let input = "";
  for (const key of keys) {
    input += key + queryParams[key];
  }

  // 3. Prepend path
  input = path + input;

  // 4. Append body if not multipart
  if (body) {
    input += body;
  }

  // 5. Wrap with secret
  input = appSecret + input + appSecret;

  // 6. HMAC-SHA256
  const hmac = crypto.createHmac("sha256", appSecret);
  hmac.update(input);
  return hmac.digest("hex");
}

// ─── API Request Helper ─────────────────────────────────────────────────────
async function ttApiRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params: Record<string, string> = {},
  body: Record<string, any> | null = null,
  accessToken?: string
): Promise<any> {
  const appKey = ENV.tiktokAppKey;
  const appSecret = ENV.tiktokAppSecret;

  // Add common params
  const queryParams: Record<string, string> = {
    ...params,
    app_key: appKey,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    version: API_VERSION,
  };

  if (accessToken) {
    queryParams.access_token = accessToken;
  }

  const bodyStr = body ? JSON.stringify(body) : null;
  const sign = generateSign(path, queryParams, bodyStr, appSecret);
  queryParams.sign = sign;

  // Build URL
  const qs = Object.entries(queryParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${TT_API_BASE}${path}?${qs}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers["x-tts-access-token"] = accessToken;
  }

  const fetchOpts: RequestInit = { method, headers };
  if (bodyStr && method !== "GET") {
    fetchOpts.body = bodyStr;
  }

  const resp = await fetch(url, fetchOpts);
  const data = await resp.json();
  return data;
}

// ─── OAuth ──────────────────────────────────────────────────────────────────

/** Generate the authorization URL for TikTok Shop OAuth */
export function getAuthorizationUrl(state: string, region: "US" | "GLOBAL" = "GLOBAL"): string {
  const baseUrl = region === "US" ? TT_AUTH_URL_US : TT_AUTH_URL_GLOBAL;
  return `${baseUrl}?service_id=${ENV.tiktokAppKey}&state=${encodeURIComponent(state)}`;
}

/** Exchange authorization code for access token */
export async function exchangeCodeForToken(authCode: string): Promise<{
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  openId: string;
  sellerName: string;
  sellerBaseRegion: string;
}> {
  const url = `${TT_AUTH_BASE}/api/v2/token/get?app_key=${ENV.tiktokAppKey}&app_secret=${ENV.tiktokAppSecret}&auth_code=${authCode}&grant_type=authorized_code`;
  
  const resp = await fetch(url);
  const data = await resp.json();

  if (data.code !== 0) {
    throw new Error(`TikTok token exchange failed: ${data.message || JSON.stringify(data)}`);
  }

  return {
    accessToken: data.data.access_token,
    accessTokenExpiresIn: data.data.access_token_expire_in,
    refreshToken: data.data.refresh_token,
    refreshTokenExpiresIn: data.data.refresh_token_expire_in,
    openId: data.data.open_id,
    sellerName: data.data.seller_name || "",
    sellerBaseRegion: data.data.seller_base_region || "",
  };
}

/** Refresh an expired access token */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  openId: string;
  sellerName: string;
}> {
  const url = `${TT_AUTH_BASE}/api/v2/token/refresh?app_key=${ENV.tiktokAppKey}&app_secret=${ENV.tiktokAppSecret}&refresh_token=${refreshToken}&grant_type=refresh_token`;

  const resp = await fetch(url);
  const data = await resp.json();

  if (data.code !== 0) {
    throw new Error(`TikTok token refresh failed: ${data.message || JSON.stringify(data)}`);
  }

  return {
    accessToken: data.data.access_token,
    accessTokenExpiresIn: data.data.access_token_expire_in,
    refreshToken: data.data.refresh_token,
    refreshTokenExpiresIn: data.data.refresh_token_expire_in,
    openId: data.data.open_id,
    sellerName: data.data.seller_name || "",
  };
}

/** Get a valid access token for a TikTok account, refreshing if needed */
export async function getValidToken(accountId: number): Promise<string> {

  const [account] = await db
    .select()
    .from(tiktokAccounts)
    .where(eq(tiktokAccounts.id, accountId))
    .limit(1);

  if (!account) throw new Error("TikTok account not found");

  const now = new Date();
  // If token expires within 1 hour, refresh it
  const expiresAt = new Date(account.accessTokenExpiresAt);
  if (expiresAt.getTime() - now.getTime() < 3600000) {
    try {
      const refreshed = await refreshAccessToken(account.refreshToken);
      await db
        .update(tiktokAccounts)
        .set({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          accessTokenExpiresAt: new Date(refreshed.accessTokenExpiresIn * 1000),
          refreshTokenExpiresAt: new Date(refreshed.refreshTokenExpiresIn * 1000),
        })
        .where(eq(tiktokAccounts.id, accountId));
      return refreshed.accessToken;
    } catch (err) {
      console.error("Failed to refresh TikTok token:", err);
      // Return existing token as fallback
      return account.accessToken;
    }
  }

  return account.accessToken;
}

// ─── Shop Management ────────────────────────────────────────────────────────

/** Get authorized shops for an account */
export async function getAuthorizedShops(accessToken: string): Promise<any[]> {
  const data = await ttApiRequest("GET", "/authorization/202309/shops", {}, null, accessToken);
  if (data.code !== 0) {
    throw new Error(`Failed to get shops: ${data.message}`);
  }
  return data.data?.shops || [];
}

// ─── Categories ─────────────────────────────────────────────────────────────

/** Get TikTok Shop categories */
export async function getCategories(accessToken: string, shopCipher: string): Promise<any[]> {
  const data = await ttApiRequest(
    "GET",
    "/product/202309/categories",
    { shop_cipher: shopCipher },
    null,
    accessToken
  );
  if (data.code !== 0) {
    throw new Error(`Failed to get categories: ${data.message}`);
  }
  return data.data?.categories || [];
}

/** Recommend category based on product title */
export async function recommendCategory(
  accessToken: string,
  shopCipher: string,
  productTitle: string
): Promise<any[]> {
  const data = await ttApiRequest(
    "POST",
    "/product/202309/categories/recommend",
    { shop_cipher: shopCipher },
    { product_title: productTitle },
    accessToken
  );
  if (data.code !== 0) {
    throw new Error(`Failed to recommend category: ${data.message}`);
  }
  return data.data?.categories || [];
}

/** Get category attributes/rules */
export async function getCategoryAttributes(
  accessToken: string,
  shopCipher: string,
  categoryId: string
): Promise<any> {
  const data = await ttApiRequest(
    "GET",
    "/product/202309/categories/" + categoryId + "/attributes",
    { shop_cipher: shopCipher },
    null,
    accessToken
  );
  if (data.code !== 0) {
    throw new Error(`Failed to get attributes: ${data.message}`);
  }
  return data.data?.attributes || [];
}

// ─── Product Image Upload ───────────────────────────────────────────────────

/** Upload a product image from URL */
export async function uploadProductImage(
  accessToken: string,
  shopCipher: string,
  imageUrl: string
): Promise<{ uri: string; url: string }> {
  const data = await ttApiRequest(
    "POST",
    "/product/202309/images/upload",
    { shop_cipher: shopCipher },
    { upload_type: 1, image_data: { image_url: imageUrl } },
    accessToken
  );
  if (data.code !== 0) {
    throw new Error(`Failed to upload image: ${data.message}`);
  }
  return {
    uri: data.data?.image_info?.image_id || "",
    url: data.data?.image_info?.image_url || "",
  };
}

// ─── Product Creation ───────────────────────────────────────────────────────

export interface TiktokProductInput {
  title: string;
  description: string;
  categoryId: string;
  brandId?: string;
  images: string[]; // image URIs from upload
  skus: {
    sellerSku: string;
    price: string;
    stock: number;
    salesAttributes?: Array<{
      attributeId: string;
      valueId?: string;
      customValue?: string;
    }>;
  }[];
  productAttributes?: Array<{
    attributeId: string;
    attributeValues: Array<{ valueId?: string; valueName?: string }>;
  }>;
  packageWeight?: string;
  packageDimensionUnit?: string;
  packageLength?: number;
  packageWidth?: number;
  packageHeight?: number;
}

/** Create a product on TikTok Shop */
export async function createProduct(
  accessToken: string,
  shopCipher: string,
  input: TiktokProductInput
): Promise<{ productId: string; skuIds: string[] }> {
  const body: any = {
    title: input.title,
    description: input.description,
    category_id: input.categoryId,
    main_images: input.images.map((uri) => ({ uri })),
    skus: input.skus.map((sku) => ({
      seller_sku: sku.sellerSku,
      original_price: sku.price,
      inventory: [{ warehouse_id: "0", quantity: sku.stock }],
      sales_attributes: sku.salesAttributes?.map((sa) => ({
        attribute_id: sa.attributeId,
        value_id: sa.valueId,
        custom_value: sa.customValue,
      })),
    })),
    is_cod_open: false,
  };

  if (input.brandId) {
    body.brand = { id: input.brandId };
  }

  if (input.productAttributes && input.productAttributes.length > 0) {
    body.product_attributes = input.productAttributes.map((attr) => ({
      attribute_id: attr.attributeId,
      attribute_values: attr.attributeValues.map((v) => ({
        value_id: v.valueId,
        value_name: v.valueName,
      })),
    }));
  }

  if (input.packageWeight) {
    body.package_weight = { value: input.packageWeight, unit: "KILOGRAM" };
  }

  if (input.packageLength && input.packageWidth && input.packageHeight) {
    body.package_dimensions = {
      length: input.packageLength.toString(),
      width: input.packageWidth.toString(),
      height: input.packageHeight.toString(),
      unit: "CENTIMETER",
    };
  }

  const data = await ttApiRequest(
    "POST",
    "/product/202309/products",
    { shop_cipher: shopCipher },
    body,
    accessToken
  );

  if (data.code !== 0) {
    throw new Error(`Failed to create product: ${data.message || JSON.stringify(data)}`);
  }

  return {
    productId: data.data?.product_id || "",
    skuIds: data.data?.skus?.map((s: any) => s.id) || [],
  };
}

// ─── DB Helpers ─────────────────────────────────────────────────────────────

/** Save or update a TikTok account after OAuth */
export async function saveTiktokAccount(
  userId: number,
  tokenData: {
    accessToken: string;
    accessTokenExpiresIn: number;
    refreshToken: string;
    refreshTokenExpiresIn: number;
    openId: string;
    sellerName: string;
    sellerBaseRegion: string;
  }
): Promise<number> {

  // Check if account already exists
  const existing = await db
    .select()
    .from(tiktokAccounts)
    .where(
      and(
        eq(tiktokAccounts.userId, userId),
        eq(tiktokAccounts.ttOpenId, tokenData.openId)
      )
    )
    .limit(1);

  const accessTokenExpiresAt = new Date(tokenData.accessTokenExpiresIn * 1000);
  const refreshTokenExpiresAt = new Date(tokenData.refreshTokenExpiresIn * 1000);

  if (existing.length > 0) {
    await db
      .update(tiktokAccounts)
      .set({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        sellerName: tokenData.sellerName,
        sellerBaseRegion: tokenData.sellerBaseRegion,
        isActive: 1,
      })
      .where(eq(tiktokAccounts.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(tiktokAccounts).values({
    userId,
    ttOpenId: tokenData.openId,
    sellerName: tokenData.sellerName,
    sellerBaseRegion: tokenData.sellerBaseRegion,
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
  });

  return result.insertId;
}

/** Get all TikTok accounts for a user */
export async function getUserTiktokAccounts(userId: number) {

  return db
    .select({
      id: tiktokAccounts.id,
      ttOpenId: tiktokAccounts.ttOpenId,
      sellerName: tiktokAccounts.sellerName,
      sellerBaseRegion: tiktokAccounts.sellerBaseRegion,
      shopId: tiktokAccounts.shopId,
      shopName: tiktokAccounts.shopName,
      shopRegion: tiktokAccounts.shopRegion,
      isActive: tiktokAccounts.isActive,
      lastUsedAt: tiktokAccounts.lastUsedAt,
      createdAt: tiktokAccounts.createdAt,
    })
    .from(tiktokAccounts)
    .where(and(eq(tiktokAccounts.userId, userId), eq(tiktokAccounts.isActive, 1)));
}

/** Disconnect a TikTok account */
export async function disconnectTiktokAccount(userId: number, accountId: number) {

  await db
    .update(tiktokAccounts)
    .set({ isActive: 0 })
    .where(and(eq(tiktokAccounts.id, accountId), eq(tiktokAccounts.userId, userId)));
}
