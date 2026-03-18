/**
 * Amazon SP-API Integration Module
 * Direct integration with Amazon Selling Partner API for OAuth, catalog search,
 * product listing creation, and account management.
 * 
 * API Base (North America): https://sellingpartnerapi-na.amazon.com
 * LWA Token URL: https://api.amazon.com/auth/o2/token
 * Marketplace ID (Brazil): A2Q3Y263D00KWC
 */

import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { amazonAccounts, amazonListings } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";

// ============ CONSTANTS ============

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const LWA_AUTH_URL = "https://www.amazon.com/ap/oa";

// SP-API endpoints by region
const SP_API_ENDPOINTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

// Marketplace IDs
const MARKETPLACE_IDS: Record<string, { id: string; name: string; region: string; domain: string }> = {
  BR: { id: "A2Q3Y263D00KWC", name: "Amazon Brasil", region: "na", domain: "amazon.com.br" },
  US: { id: "ATVPDKIKX0DER", name: "Amazon US", region: "na", domain: "amazon.com" },
  MX: { id: "A1AM78C64UM0Y8", name: "Amazon México", region: "na", domain: "amazon.com.mx" },
  CA: { id: "A2EUQ1WTGCTBG2", name: "Amazon Canadá", region: "na", domain: "amazon.ca" },
};

const DEFAULT_MARKETPLACE = "BR";

// ============ IN-MEMORY CACHES ============

const productTypeCache = new Map<string, { data: any; expiry: number }>();
const PRODUCT_TYPE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const catalogSearchCache = new Map<string, { data: any; expiry: number }>();
const CATALOG_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ============ DATABASE HELPERS ============

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return drizzle(process.env.DATABASE_URL);
}

// ============ LWA OAUTH FLOW ============

/**
 * Generate the LWA OAuth authorization URL for connecting an Amazon seller account
 */
export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const params = new URLSearchParams({
    application_id: ENV.amazonClientId,
    redirect_uri: redirectUri,
    state: state || "",
  });
  return `https://sellercentral.amazon.com.br/apps/authorize/consent?${params.toString()}`;
}

/**
 * Exchange LWA authorization code for access + refresh tokens
 */
export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const response = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: ENV.amazonClientId,
      client_secret: ENV.amazonClientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[Amazon OAuth] Token exchange failed:", response.status, errorBody);
    throw new Error(`Amazon OAuth token exchange failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
    tokenType: data.token_type as string,
  };
}

/**
 * Refresh an expired LWA access token
 */
export async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ENV.amazonClientId,
      client_secret: ENV.amazonClientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[Amazon OAuth] Token refresh failed:", response.status, errorBody);
    throw new Error(`Amazon OAuth token refresh failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
    tokenType: data.token_type as string,
  };
}

// ============ TOKEN MANAGEMENT ============

/**
 * Get a valid access token for an Amazon account, refreshing if needed
 */
export async function getValidToken(accountId: number): Promise<string> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(amazonAccounts)
    .where(eq(amazonAccounts.id, accountId))
    .limit(1);

  if (!account) throw new Error(`Amazon account ${accountId} not found`);
  if (!account.isActive) throw new Error(`Amazon account ${accountId} is inactive`);

  // Check if token is still valid (with 5 min buffer)
  const now = new Date();
  if (account.accessToken && account.tokenExpiresAt && account.tokenExpiresAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    return account.accessToken;
  }

  // Refresh the token
  console.log(`[Amazon] Refreshing token for account ${accountId}`);
  const tokenData = await refreshAccessToken(account.refreshToken);
  const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);

  await db
    .update(amazonAccounts)
    .set({
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      tokenExpiresAt: expiresAt,
      lastUsedAt: now,
    })
    .where(eq(amazonAccounts.id, accountId));

  return tokenData.accessToken;
}

// ============ SP-API REQUEST HELPER ============

/**
 * Make an authenticated request to the Amazon SP-API
 */
async function spApiRequest(
  accountId: number,
  method: string,
  path: string,
  body?: any,
  region: string = "na",
  retries: number = 2
): Promise<any> {
  const token = await getValidToken(accountId);
  const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.na;
  const url = `${baseUrl}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers: Record<string, string> = {
        "x-amz-access-token": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
      };

      const options: RequestInit = { method, headers };
      if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
        console.warn(`[Amazon SP-API] Rate limited, waiting ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        if (attempt < retries && (response.status >= 500 || response.status === 503)) {
          console.warn(`[Amazon SP-API] Server error ${response.status}, retrying...`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new Error(`SP-API ${method} ${path} failed: ${response.status} - ${errorBody}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error: any) {
      if (attempt < retries && error.message?.includes("fetch failed")) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

// ============ ACCOUNT MANAGEMENT ============

/**
 * Save or update Amazon account after OAuth callback
 */
export async function saveAccount(
  userId: number,
  tokenData: { accessToken: string; refreshToken: string; expiresIn: number },
  sellerId: string,
  marketplace: string = DEFAULT_MARKETPLACE
) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);
  const mkp = MARKETPLACE_IDS[marketplace] || MARKETPLACE_IDS.BR;

  // Try to get seller info
  let sellerName = sellerId;
  try {
    // We'll get seller name from the participation info later
    sellerName = sellerId;
  } catch (e) {
    console.warn("[Amazon] Could not fetch seller info:", e);
  }

  // Check if account already exists
  const existing = await db
    .select()
    .from(amazonAccounts)
    .where(and(eq(amazonAccounts.userId, userId), eq(amazonAccounts.sellerId, sellerId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(amazonAccounts)
      .set({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        tokenExpiresAt: expiresAt,
        marketplaceId: mkp.id,
        region: mkp.region,
        isActive: 1,
      })
      .where(eq(amazonAccounts.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(amazonAccounts).values({
    userId,
    sellerId,
    sellerName,
    marketplaceId: mkp.id,
    region: mkp.region,
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    tokenExpiresAt: expiresAt,
  });

  return result.insertId;
}

/**
 * Save account with manual refresh token (self-authorization)
 */
export async function saveAccountManual(
  userId: number,
  sellerId: string,
  refreshToken: string,
  sellerName?: string,
  marketplace: string = DEFAULT_MARKETPLACE
) {
  const db = getDb();
  const mkp = MARKETPLACE_IDS[marketplace] || MARKETPLACE_IDS.BR;

  // Try to get access token immediately
  let accessToken: string | null = null;
  let tokenExpiresAt: Date | null = null;
  try {
    const tokenData = await refreshAccessToken(refreshToken);
    accessToken = tokenData.accessToken;
    tokenExpiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);
  } catch (e) {
    console.warn("[Amazon] Could not get initial access token:", e);
  }

  // Check if account already exists
  const existing = await db
    .select()
    .from(amazonAccounts)
    .where(and(eq(amazonAccounts.userId, userId), eq(amazonAccounts.sellerId, sellerId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(amazonAccounts)
      .set({
        refreshToken,
        accessToken,
        tokenExpiresAt,
        sellerName: sellerName || existing[0].sellerName,
        marketplaceId: mkp.id,
        region: mkp.region,
        isActive: 1,
      })
      .where(eq(amazonAccounts.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(amazonAccounts).values({
    userId,
    sellerId,
    sellerName: sellerName || sellerId,
    marketplaceId: mkp.id,
    region: mkp.region,
    accessToken,
    refreshToken,
    tokenExpiresAt,
  });

  return result.insertId;
}

/**
 * Get all Amazon accounts for a user
 */
export async function getAccounts(userId: number) {
  const db = getDb();
  const accounts = await db
    .select({
      id: amazonAccounts.id,
      sellerId: amazonAccounts.sellerId,
      sellerName: amazonAccounts.sellerName,
      email: amazonAccounts.email,
      marketplaceId: amazonAccounts.marketplaceId,
      region: amazonAccounts.region,
      isActive: amazonAccounts.isActive,
      tokenExpiresAt: amazonAccounts.tokenExpiresAt,
      lastUsedAt: amazonAccounts.lastUsedAt,
      createdAt: amazonAccounts.createdAt,
    })
    .from(amazonAccounts)
    .where(eq(amazonAccounts.userId, userId))
    .orderBy(desc(amazonAccounts.createdAt));

  return accounts.map(a => ({
    ...a,
    marketplaceName: Object.values(MARKETPLACE_IDS).find(m => m.id === a.marketplaceId)?.name || "Amazon",
    tokenValid: a.tokenExpiresAt ? a.tokenExpiresAt.getTime() > Date.now() : false,
  }));
}

/**
 * Delete/disconnect an Amazon account
 */
export async function deleteAccount(userId: number, accountId: number) {
  const db = getDb();
  await db
    .update(amazonAccounts)
    .set({ isActive: 0 })
    .where(and(eq(amazonAccounts.id, accountId), eq(amazonAccounts.userId, userId)));
}

// ============ CATALOG SEARCH ============

/**
 * Search Amazon catalog by EAN/UPC/GTIN to find existing ASINs
 */
export async function searchCatalogByIdentifier(
  accountId: number,
  identifiers: string[],
  identifierType: string = "EAN",
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<any> {
  const cacheKey = `${identifiers.join(",")}_${identifierType}_${marketplaceId}`;
  const cached = catalogSearchCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.data;

  // Max 20 identifiers per request
  const batch = identifiers.slice(0, 20);
  const params = new URLSearchParams({
    marketplaceIds: marketplaceId,
    identifiers: batch.join(","),
    identifiersType: identifierType,
    includedData: "identifiers,summaries,images",
    pageSize: "20",
  });

  const result = await spApiRequest(
    accountId,
    "GET",
    `/catalog/2022-04-01/items?${params.toString()}`
  );

  catalogSearchCache.set(cacheKey, { data: result, expiry: Date.now() + CATALOG_CACHE_TTL });
  return result;
}

/**
 * Search Amazon catalog by keyword
 */
export async function searchCatalogByKeyword(
  accountId: number,
  keywords: string,
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<any> {
  const params = new URLSearchParams({
    marketplaceIds: marketplaceId,
    keywords,
    includedData: "identifiers,summaries,images",
    pageSize: "10",
  });

  return spApiRequest(
    accountId,
    "GET",
    `/catalog/2022-04-01/items?${params.toString()}`
  );
}

// ============ LISTING RESTRICTIONS ============

/**
 * Check if seller can list a specific ASIN
 */
export async function checkListingRestrictions(
  accountId: number,
  asin: string,
  sellerId: string,
  marketplaceId: string = MARKETPLACE_IDS.BR.id,
  conditionType: string = "new_new"
): Promise<{ canSell: boolean; reasons: any[] }> {
  try {
    const params = new URLSearchParams({
      marketplaceIds: marketplaceId,
      sellerId,
      asin,
      conditionType,
    });

    const result = await spApiRequest(
      accountId,
      "GET",
      `/listings/2021-08-01/restrictions?${params.toString()}`
    );

    const restrictions = result.restrictions || [];
    const reasons = restrictions.flatMap((r: any) => r.reasons || []);
    return { canSell: reasons.length === 0, reasons };
  } catch (error: any) {
    console.error("[Amazon] Restriction check failed:", error.message);
    return { canSell: false, reasons: [{ reasonCode: "ERROR", message: error.message }] };
  }
}

// ============ PRODUCT TYPE DEFINITIONS ============

/**
 * Search for product type definitions (categories) matching a keyword
 */
export async function searchProductTypes(
  accountId: number,
  keywords: string,
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<any> {
  const params = new URLSearchParams({
    marketplaceIds: marketplaceId,
    keywords,
  });

  return spApiRequest(
    accountId,
    "GET",
    `/definitions/2020-09-01/productTypes?${params.toString()}`
  );
}

/**
 * Get the JSON Schema for a specific product type (required/optional attributes)
 */
export async function getProductTypeDefinition(
  accountId: number,
  productType: string,
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<any> {
  const cacheKey = `${productType}_${marketplaceId}`;
  const cached = productTypeCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) return cached.data;

  const params = new URLSearchParams({
    marketplaceIds: marketplaceId,
    requirements: "LISTING",
    requirementsEnforced: "ENFORCED",
    locale: "pt_BR",
  });

  const result = await spApiRequest(
    accountId,
    "GET",
    `/definitions/2020-09-01/productTypes/${productType}?${params.toString()}`
  );

  productTypeCache.set(cacheKey, { data: result, expiry: Date.now() + PRODUCT_TYPE_CACHE_TTL });
  return result;
}

// ============ LISTING CREATION ============

/**
 * Create or fully update a listing on Amazon
 * Uses the Listings Items API (PUT)
 */
export async function putListingsItem(
  accountId: number,
  sellerId: string,
  sku: string,
  productType: string,
  attributes: Record<string, any>,
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<any> {
  const body = {
    productType,
    requirements: "LISTING",
    attributes,
  };

  return spApiRequest(
    accountId,
    "PUT",
    `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}?marketplaceIds=${marketplaceId}`,
    body
  );
}

/**
 * Partially update a listing (patch specific attributes)
 */
export async function patchListingsItem(
  accountId: number,
  sellerId: string,
  sku: string,
  patches: Array<{ op: string; path: string; value?: any }>,
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<any> {
  const body = {
    productType: "PRODUCT", // Will be overridden by Amazon
    patches,
  };

  return spApiRequest(
    accountId,
    "PATCH",
    `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}?marketplaceIds=${marketplaceId}`,
    body
  );
}

/**
 * Get listing details for a specific SKU
 */
export async function getListingsItem(
  accountId: number,
  sellerId: string,
  sku: string,
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<any> {
  const params = new URLSearchParams({
    marketplaceIds: marketplaceId,
    includedData: "summaries,attributes,issues,offers",
  });

  return spApiRequest(
    accountId,
    "GET",
    `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}?${params.toString()}`
  );
}

/**
 * Delete a listing
 */
export async function deleteListingsItem(
  accountId: number,
  sellerId: string,
  sku: string,
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<any> {
  return spApiRequest(
    accountId,
    "DELETE",
    `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}?marketplaceIds=${marketplaceId}`
  );
}

// ============ PUBLISH PRODUCT (HIGH-LEVEL) ============

/**
 * Publish a product from BaseLinker to Amazon
 * This is the main function that handles the full flow:
 * 1. Search catalog by EAN to find existing ASIN
 * 2. Check restrictions
 * 3. Map category to product type
 * 4. Build attributes using AI
 * 5. Create listing
 */
export async function publishProduct(
  accountId: number,
  product: {
    productId: string;
    name: string;
    sku: string;
    ean: string;
    price: string;
    stock: number;
    description: string;
    images: string[];
    weight?: string;
    category?: string;
    brand?: string;
    title?: string; // AI-generated title
  },
  options: {
    userId: number;
    marketplaceId?: string;
    productType?: string; // If already mapped
    conditionType?: string;
  }
): Promise<{
  success: boolean;
  asin?: string;
  sku: string;
  submissionId?: string;
  issues?: any[];
  error?: string;
}> {
  const db = getDb();
  const marketplaceId = options.marketplaceId || MARKETPLACE_IDS.BR.id;
  const conditionType = options.conditionType || "new_new";

  // Get account info
  const [account] = await db
    .select()
    .from(amazonAccounts)
    .where(eq(amazonAccounts.id, accountId))
    .limit(1);
  if (!account) throw new Error(`Amazon account ${accountId} not found`);

  const sellerId = account.sellerId;
  const sku = product.sku || `BL-${product.productId}`;
  let asin: string | undefined;

  try {
    // Step 1: Search catalog by EAN if available
    if (product.ean && product.ean.length >= 8) {
      console.log(`[Amazon] Searching catalog for EAN: ${product.ean}`);
      const catalogResult = await searchCatalogByIdentifier(accountId, [product.ean], "EAN", marketplaceId);
      
      if (catalogResult.numberOfResults > 0 && catalogResult.items?.length > 0) {
        asin = catalogResult.items[0].asin;
        console.log(`[Amazon] Found existing ASIN: ${asin}`);

        // Step 2: Check restrictions
        const restrictions = await checkListingRestrictions(accountId, asin!, sellerId, marketplaceId, conditionType);
        if (!restrictions.canSell) {
          const reason = restrictions.reasons[0]?.message || "Restrição de venda";
          // Save error listing
          await db.insert(amazonListings).values({
            userId: options.userId,
            amazonAccountId: accountId,
            asin,
            sku,
            productId: product.productId,
            productName: product.name,
            title: product.title || product.name,
            price: product.price,
            status: "error",
            errorMessage: `Restrição: ${reason}`,
          });
          return { success: false, asin, sku, error: `Restrição de venda: ${reason}` };
        }
      }
    }

    // Step 3: Determine product type
    let productType = options.productType;
    if (!productType) {
      productType = await mapProductType(accountId, product.name, product.category, marketplaceId);
    }

    // Step 4: Build listing attributes
    const title = product.title || product.name;
    const attributes: Record<string, any> = {
      condition_type: [{ value: conditionType, marketplace_id: marketplaceId }],
      merchant_suggested_asin: asin ? [{ value: asin, marketplace_id: marketplaceId }] : undefined,
      item_name: [{ value: title.substring(0, 200), marketplace_id: marketplaceId }],
      externally_assigned_product_identifier: product.ean ? [{
        type: "ean",
        value: product.ean,
        marketplace_id: marketplaceId,
      }] : undefined,
      list_price: [{ value: parseFloat(product.price) || 0, currency: "BRL", marketplace_id: marketplaceId }],
      purchasable_offer: [{
        our_price: [{ schedule: [{ value_with_tax: parseFloat(product.price) || 0 }] }],
        marketplace_id: marketplaceId,
        currency: "BRL",
      }],
      fulfillment_availability: [{
        fulfillment_channel_code: "DEFAULT",
        quantity: product.stock || 0,
        marketplace_id: marketplaceId,
      }],
      main_product_image_locator: product.images.length > 0 ? [{
        media_location: product.images[0],
        marketplace_id: marketplaceId,
      }] : undefined,
      other_product_image_locator_1: product.images.length > 1 ? [{
        media_location: product.images[1],
        marketplace_id: marketplaceId,
      }] : undefined,
      other_product_image_locator_2: product.images.length > 2 ? [{
        media_location: product.images[2],
        marketplace_id: marketplaceId,
      }] : undefined,
      other_product_image_locator_3: product.images.length > 3 ? [{
        media_location: product.images[3],
        marketplace_id: marketplaceId,
      }] : undefined,
      other_product_image_locator_4: product.images.length > 4 ? [{
        media_location: product.images[4],
        marketplace_id: marketplaceId,
      }] : undefined,
      product_description: product.description ? [{
        value: product.description.substring(0, 2000),
        marketplace_id: marketplaceId,
      }] : undefined,
      brand: product.brand ? [{
        value: product.brand,
        marketplace_id: marketplaceId,
      }] : undefined,
    };

    // Remove undefined attributes
    Object.keys(attributes).forEach(key => {
      if (attributes[key] === undefined) delete attributes[key];
    });

    // Step 5: Create listing
    console.log(`[Amazon] Creating listing for SKU: ${sku}, productType: ${productType}`);
    const result = await putListingsItem(accountId, sellerId, sku, productType, attributes, marketplaceId);

    const submissionId = result.submissionId || result.submission_id;
    const issues = result.issues || [];
    const hasErrors = issues.some((i: any) => i.severity === "ERROR");

    // Save listing to database
    await db.insert(amazonListings).values({
      userId: options.userId,
      amazonAccountId: accountId,
      asin,
      sku,
      productId: product.productId,
      productName: product.name,
      title: title,
      productType,
      price: product.price,
      status: hasErrors ? "error" : "active",
      submissionId,
      issues: issues.length > 0 ? issues : undefined,
      amzResponse: result,
      errorMessage: hasErrors ? issues.filter((i: any) => i.severity === "ERROR").map((i: any) => i.message).join("; ") : undefined,
    });

    return {
      success: !hasErrors,
      asin,
      sku,
      submissionId,
      issues,
      error: hasErrors ? issues.filter((i: any) => i.severity === "ERROR").map((i: any) => i.message).join("; ") : undefined,
    };
  } catch (error: any) {
    console.error(`[Amazon] Publish failed for ${product.name}:`, error.message);

    // Save error listing
    try {
      await db.insert(amazonListings).values({
        userId: options.userId,
        amazonAccountId: accountId,
        sku,
        productId: product.productId,
        productName: product.name,
        title: product.title || product.name,
        price: product.price,
        status: "error",
        errorMessage: error.message,
      });
    } catch (dbError) {
      console.error("[Amazon] Failed to save error listing:", dbError);
    }

    return { success: false, sku, error: error.message };
  }
}

// ============ AI PRODUCT TYPE MAPPING ============

/**
 * Use AI to map a product name/category to an Amazon product type
 */
export async function mapProductType(
  accountId: number,
  productName: string,
  sourceCategory?: string,
  marketplaceId: string = MARKETPLACE_IDS.BR.id
): Promise<string> {
  try {
    // First try to search Amazon's product type definitions
    const keywords = sourceCategory || productName.split(" ").slice(0, 3).join(" ");
    const searchResult = await searchProductTypes(accountId, keywords, marketplaceId);
    
    const productTypes = searchResult.productTypes || [];
    
    if (productTypes.length === 0) {
      // Fallback: use AI to determine product type
      return await aiMapProductType(productName, sourceCategory);
    }

    if (productTypes.length === 1) {
      return productTypes[0].name;
    }

    // Multiple results: use AI to pick the best one
    const options = productTypes.map((pt: any) => `${pt.name}: ${pt.displayName || pt.name}`).join("\n");
    
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an Amazon product categorization expert. Given a product name and a list of Amazon product types, select the most appropriate one. Return ONLY the product type name (the code before the colon), nothing else."
        },
        {
          role: "user",
          content: `Product: ${productName}\nCategory: ${sourceCategory || "N/A"}\n\nAvailable product types:\n${options}\n\nBest product type name:`
        }
      ],
    });

    const aiChoice = (response.choices?.[0]?.message?.content as string)?.trim();
    const matched = productTypes.find((pt: any) => pt.name === aiChoice);
    return matched ? matched.name : productTypes[0].name;
  } catch (error: any) {
    console.warn("[Amazon] Product type search failed, using AI fallback:", error.message);
    return aiMapProductType(productName, sourceCategory);
  }
}

/**
 * AI fallback for product type mapping when SP-API search fails
 */
async function aiMapProductType(productName: string, sourceCategory?: string): Promise<string> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an Amazon product categorization expert for the Brazilian marketplace.
Given a product name and optional category, determine the most appropriate Amazon product type code.
Common product types: PRODUCT, SHOES, SHIRT, PANTS, DRESS, BAG, WATCH, JEWELRY, TOY, BEAUTY, HEALTH, ELECTRONICS, HOME, KITCHEN, SPORTS, AUTOMOTIVE, BABY, PET, OFFICE, TOOLS.
Return ONLY the product type code in uppercase, nothing else.`
      },
      {
        role: "user",
        content: `Product: ${productName}\nCategory: ${sourceCategory || "N/A"}`
      }
    ],
  });

  return (response.choices?.[0]?.message?.content as string)?.trim() || "PRODUCT";
}

// ============ HELPERS ============

/**
 * Get marketplace info
 */
export function getMarketplaceInfo(code: string = DEFAULT_MARKETPLACE) {
  return MARKETPLACE_IDS[code] || MARKETPLACE_IDS.BR;
}

/**
 * Get all supported marketplaces
 */
export function getSupportedMarketplaces() {
  return Object.entries(MARKETPLACE_IDS).map(([code, info]) => ({
    code,
    ...info,
  }));
}

/**
 * Get seller participations (which marketplaces the seller is registered in)
 */
export async function getSellerParticipations(accountId: number): Promise<any> {
  try {
    const result = await spApiRequest(accountId, "GET", "/sellers/v1/marketplaceParticipations");
    return result.payload || [];
  } catch (error: any) {
    console.error("[Amazon] Failed to get seller participations:", error.message);
    return [];
  }
}
