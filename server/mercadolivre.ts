/**
 * Mercado Livre API Integration Module
 * Direct integration with ML API for OAuth, category prediction, and item creation.
 * 
 * API Base: https://api.mercadolibre.com
 * Auth URL (Brazil): https://auth.mercadolivre.com.br
 * Site ID: MLB (Brazil)
 */

import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { mlAccounts, mlListings } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { findBestCategory, validateCategoryId, getLocalCategoryInfo } from "./ml-categories";

const ML_API_BASE = "https://api.mercadolibre.com";
const ML_AUTH_URL = "https://auth.mercadolivre.com.br";
const ML_SITE_ID = "MLB";

// ============ DATABASE HELPERS ============

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return drizzle(process.env.DATABASE_URL);
}

// ============ OAUTH FLOW ============

/**
 * Generate the OAuth authorization URL for a user to connect their ML account
 */
export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ENV.mlAppId,
    redirect_uri: redirectUri,
  });
  if (state) {
    params.set("state", state);
  }
  return `${ML_AUTH_URL}/authorization?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const response = await fetch(`${ML_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ENV.mlAppId,
      client_secret: ENV.mlClientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[ML OAuth] Token exchange failed:", response.status, errorBody);
    throw new Error(`ML OAuth token exchange failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    tokenType: data.token_type as string,
    expiresIn: data.expires_in as number,
    scope: data.scope as string,
    userId: data.user_id as number,
    refreshToken: data.refresh_token as string,
  };
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(`${ML_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ENV.mlAppId,
      client_secret: ENV.mlClientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[ML OAuth] Token refresh failed:", response.status, errorBody);
    throw new Error(`ML OAuth token refresh failed: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token as string,
    tokenType: data.token_type as string,
    expiresIn: data.expires_in as number,
    scope: data.scope as string,
    userId: data.user_id as number,
    refreshToken: data.refresh_token as string,
  };
}

// ============ ACCOUNT MANAGEMENT ============

/**
 * Save or update ML account after OAuth callback
 */
export async function saveAccount(
  userId: number,
  tokenData: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    userId: number;
    scope: string;
  }
) {
  const db = getDb();
  const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);

  // Get user info from ML
  const userInfo = await getMlUserInfo(tokenData.accessToken);

  // Check if account already exists
  const existing = await db
    .select()
    .from(mlAccounts)
    .where(and(eq(mlAccounts.userId, userId), eq(mlAccounts.mlUserId, tokenData.userId)))
    .limit(1);

  if (existing.length > 0) {
    // Update existing account
    await db
      .update(mlAccounts)
      .set({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        tokenExpiresAt: expiresAt,
        scopes: tokenData.scope,
        nickname: userInfo.nickname,
        email: userInfo.email,
        isActive: 1,
      })
      .where(eq(mlAccounts.id, existing[0].id));
    return existing[0].id;
  }

  // Insert new account
  const [result] = await db.insert(mlAccounts).values({
    userId,
    mlUserId: tokenData.userId,
    nickname: userInfo.nickname,
    email: userInfo.email,
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    tokenExpiresAt: expiresAt,
    scopes: tokenData.scope,
    siteId: ML_SITE_ID,
  });

  return result.insertId;
}

/**
 * Get all ML accounts for a user
 */
export async function getAccounts(userId: number) {
  const db = getDb();
  const accounts = await db
    .select({
      id: mlAccounts.id,
      mlUserId: mlAccounts.mlUserId,
      nickname: mlAccounts.nickname,
      email: mlAccounts.email,
      siteId: mlAccounts.siteId,
      isActive: mlAccounts.isActive,
      tokenExpiresAt: mlAccounts.tokenExpiresAt,
      lastUsedAt: mlAccounts.lastUsedAt,
      createdAt: mlAccounts.createdAt,
    })
    .from(mlAccounts)
    .where(eq(mlAccounts.userId, userId))
    .orderBy(desc(mlAccounts.createdAt));

  return accounts.map((a) => ({
    ...a,
    isTokenExpired: a.tokenExpiresAt < new Date(),
  }));
}

/**
 * Get a valid access token for an ML account, refreshing if needed
 */
export async function getValidToken(accountId: number): Promise<string> {
  const db = getDb();
  const [account] = await db
    .select()
    .from(mlAccounts)
    .where(eq(mlAccounts.id, accountId))
    .limit(1);

  if (!account) throw new Error("ML account not found");
  if (!account.isActive) throw new Error("ML account is deactivated");

  // Check if token is still valid (with 5 min buffer)
  const bufferMs = 5 * 60 * 1000;
  if (account.tokenExpiresAt.getTime() > Date.now() + bufferMs) {
    // Update last used
    await db.update(mlAccounts).set({ lastUsedAt: new Date() }).where(eq(mlAccounts.id, accountId));
    return account.accessToken;
  }

  // Token expired or about to expire, refresh it
  console.log(`[ML] Refreshing token for account ${accountId} (${account.nickname})`);
  try {
    const newToken = await refreshAccessToken(account.refreshToken);
    const newExpiresAt = new Date(Date.now() + newToken.expiresIn * 1000);

    await db
      .update(mlAccounts)
      .set({
        accessToken: newToken.accessToken,
        refreshToken: newToken.refreshToken,
        tokenExpiresAt: newExpiresAt,
        lastUsedAt: new Date(),
      })
      .where(eq(mlAccounts.id, accountId));

    return newToken.accessToken;
  } catch (error) {
    console.error(`[ML] Failed to refresh token for account ${accountId}:`, error);
    // Mark account as inactive
    await db.update(mlAccounts).set({ isActive: 0 }).where(eq(mlAccounts.id, accountId));
    throw new Error("Failed to refresh ML token. Please reconnect the account.");
  }
}

/**
 * Disconnect/remove an ML account
 */
export async function disconnectAccount(userId: number, accountId: number) {
  const db = getDb();
  await db
    .update(mlAccounts)
    .set({ isActive: 0 })
    .where(and(eq(mlAccounts.id, accountId), eq(mlAccounts.userId, userId)));
  return { success: true };
}

/**
 * Delete an ML account permanently
 */
export async function deleteAccount(userId: number, accountId: number) {
  const db = getDb();
  await db
    .delete(mlAccounts)
    .where(and(eq(mlAccounts.id, accountId), eq(mlAccounts.userId, userId)));
  return { success: true };
}

// ============ ML API CALLS ============

/**
 * Make an authenticated API call to ML
 */
async function mlApiCall(accessToken: string, method: string, path: string, body?: unknown) {
  const url = `${ML_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const options: RequestInit = { method, headers };
  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  let data: any;
  const responseText = await response.text();
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error(`[ML API] ${method} ${path} - non-JSON response:`, responseText.substring(0, 500));
    throw new Error(`ML API error ${response.status}: Non-JSON response`);
  }

  if (!response.ok) {
    // Extract detailed error info from ML API response
    const errorDetails: string[] = [];
    if (data.message) errorDetails.push(data.message);
    if (data.error) errorDetails.push(data.error);
    if (data.cause && Array.isArray(data.cause)) {
      for (const cause of data.cause) {
        const causeMsg = [cause.code, cause.message, cause.type].filter(Boolean).join(': ');
        if (causeMsg) errorDetails.push(causeMsg);
        // Show which fields are missing
        if (cause.references) {
          errorDetails.push(`References: ${JSON.stringify(cause.references)}`);
        }
      }
    }
    const fullError = errorDetails.length > 0 ? errorDetails.join(' | ') : JSON.stringify(data);
    console.error(`[ML API] ${method} ${path} failed:`, response.status, JSON.stringify(data));
    throw new Error(`ML API error ${response.status}: ${fullError}`);
  }

  return data;
}

/**
 * Get ML user info
 */
export async function getMlUserInfo(accessToken: string) {
  const data = await mlApiCall(accessToken, "GET", "/users/me");
  return {
    id: data.id as number,
    nickname: data.nickname as string,
    email: data.email as string,
    siteId: data.site_id as string,
    permalink: data.permalink as string,
  };
}

// ============ CATEGORY PREDICTION ============

/**
 * Predict the best ML category for a product using domain_discovery
 */
export async function predictCategory(query: string) {
  // domain_discovery is a public endpoint, no auth needed
  const url = `${ML_API_BASE}/sites/${ML_SITE_ID}/domain_discovery/search?q=${encodeURIComponent(query)}`;
  console.log(`[ML predictCategory] Calling domain_discovery for: "${query}"`);
  console.log(`[ML predictCategory] URL: ${url}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[ML predictCategory] domain_discovery failed: ${response.status}`, errorBody);
    return [];
  }

  const data = await response.json();
  console.log(`[ML predictCategory] domain_discovery raw response:`, JSON.stringify(data).substring(0, 500));
  
  // Returns array of domain matches with categories
  const results = (data || []).map((item: any) => ({
    domainId: item.domain_id,
    domainName: item.domain_name,
    categoryId: item.category_id,
    categoryName: item.category_name,
    attributes: item.attributes || [],
  }));
  
  console.log(`[ML predictCategory] Parsed ${results.length} predictions:`, results.map((r: any) => `${r.categoryId} (${r.categoryName})`).join(', '));
  return results;
}

/**
 * Get category details and path
 */
export async function getCategoryInfo(categoryId: string) {
  // Validate category ID format (should be MLB followed by digits)
  if (!categoryId || !categoryId.match(/^MLB\d+$/)) {
    console.error(`[ML getCategoryInfo] Invalid category ID format: "${categoryId}"`);
    throw new Error(`Invalid ML category ID format: "${categoryId}". Expected format: MLB followed by digits (e.g., MLB39567)`);
  }
  
  const url = `${ML_API_BASE}/categories/${categoryId}`;
  console.log(`[ML getCategoryInfo] Fetching: ${url}`);
  const response = await fetch(url);
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[ML getCategoryInfo] Failed for ${categoryId}: ${response.status}`, errorBody);
    throw new Error(`Failed to get category info for ${categoryId} (HTTP ${response.status})`);
  }

  const data = await response.json();
  const pathFromRoot = (data.path_from_root || []).map((p: any) => p.name).join(" > ");
  
  return {
    id: data.id,
    name: data.name,
    pathFromRoot,
    childrenCategories: data.children_categories || [],
    settings: data.settings || {},
  };
}

/**
 * Get required and optional attributes for a category
 */
export async function getCategoryAttributes(categoryId: string) {
  // Validate category ID format
  if (!categoryId || !categoryId.match(/^MLB\d+$/)) {
    console.error(`[ML getCategoryAttributes] Invalid category ID format: "${categoryId}"`);
    throw new Error(`Invalid ML category ID format: "${categoryId}". Expected format: MLB followed by digits (e.g., MLB39567)`);
  }
  
  const url = `${ML_API_BASE}/categories/${categoryId}/attributes`;
  console.log(`[ML getCategoryAttributes] Fetching attributes for: ${categoryId}`);
  const response = await fetch(url);
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[ML getCategoryAttributes] Failed for ${categoryId}: ${response.status}`, errorBody);
    throw new Error(`Failed to get attributes for category ${categoryId} (HTTP ${response.status})`);
  }

  const data = await response.json();
  
  return (data || []).map((attr: any) => ({
    id: attr.id,
    name: attr.name,
    type: attr.value_type,
    tags: attr.tags || {},
    values: (attr.values || []).map((v: any) => ({ id: v.id, name: v.name })),
    required: attr.tags?.required === true || attr.tags?.catalog_required === true,
    allowCustomValue: !attr.tags?.fixed,
    tooltip: attr.tooltip,
    hint: attr.hint,
    defaultValue: attr.default_value,
  }));
}

// ============ ITEM CREATION ============

/**
 * Create a new item listing on Mercado Livre
 */
export async function createItem(
  accountId: number,
  itemData: {
    title: string;
    familyName?: string;
    categoryId: string;
    price: number;
    currencyId?: string;
    availableQuantity: number;
    buyingMode?: string;
    condition?: string;
    listingTypeId?: string;
    description?: string;
    pictures?: { source: string }[];
    attributes?: { id: string; value_name?: string; value_id?: string }[];
    saleTerms?: { id: string; value_name?: string; value_id?: string }[];
  }
) {
  const accessToken = await getValidToken(accountId);

  const body: any = {
    title: itemData.title,
    category_id: itemData.categoryId,
    price: itemData.price,
    currency_id: itemData.currencyId || "BRL",
    available_quantity: itemData.availableQuantity,
    buying_mode: itemData.buyingMode || "buy_it_now",
    condition: itemData.condition || "new",
    listing_type_id: itemData.listingTypeId || "gold_special",
  };

  // family_name is required for sellers with "user_product_seller" tag
  // It's a generic product description used to group User Products into families
  if (itemData.familyName) {
    body.family_name = itemData.familyName;
  } else {
    // Always send family_name as it's now required for most sellers
    body.family_name = itemData.title;
  }

  if (itemData.pictures && itemData.pictures.length > 0) {
    body.pictures = itemData.pictures;
  }

  if (itemData.attributes && itemData.attributes.length > 0) {
    body.attributes = itemData.attributes;
  }

  if (itemData.saleTerms && itemData.saleTerms.length > 0) {
    body.sale_terms = itemData.saleTerms;
  }

  console.log(`[ML createItem] Sending POST /items with body:`, JSON.stringify(body).substring(0, 500));
  const result = await mlApiCall(accessToken, "POST", "/items", body);
  console.log(`[ML createItem] Response:`, JSON.stringify(result).substring(0, 300));

  // Set description separately (ML requires it as a separate call)
  if (itemData.description && result.id) {
    try {
      await mlApiCall(accessToken, "POST", `/items/${result.id}/description`, {
        plain_text: itemData.description,
      });
    } catch (err) {
      console.error("[ML] Failed to set item description:", err);
    }
  }

  return {
    id: result.id,
    title: result.title,
    permalink: result.permalink,
    status: result.status,
    price: result.price,
    categoryId: result.category_id,
  };
}

/**
 * Update an existing item
 */
export async function updateItem(
  accountId: number,
  itemId: string,
  updates: Record<string, unknown>
) {
  const accessToken = await getValidToken(accountId);
  return mlApiCall(accessToken, "PUT", `/items/${itemId}`, updates);
}

/**
 * Get item details
 */
export async function getItem(accountId: number, itemId: string) {
  const accessToken = await getValidToken(accountId);
  return mlApiCall(accessToken, "GET", `/items/${itemId}`);
}

/**
 * Get all items for a seller
 */
export async function getSellerItems(accountId: number, status?: string) {
  const accessToken = await getValidToken(accountId);
  const [account] = await getDb()
    .select()
    .from(mlAccounts)
    .where(eq(mlAccounts.id, accountId))
    .limit(1);

  if (!account) throw new Error("Account not found");

  let path = `/users/${account.mlUserId}/items/search`;
  if (status) path += `?status=${status}`;

  return mlApiCall(accessToken, "GET", path);
}

// ============ AI-POWERED ATTRIBUTE FILLING ============

/**
 * Use AI to fill in required attributes for a product
 */
export async function fillAttributesWithAI(
  product: {
    name: string;
    description?: string;
    ean?: string;
    sku?: string;
    brand?: string;
    features?: Record<string, string>;
  },
  requiredAttributes: {
    id: string;
    name: string;
    type: string;
    values: { id: string; name: string }[];
    required: boolean;
    allowCustomValue: boolean;
  }[]
) {
  // Build a prompt for the AI
  const attrDescriptions = requiredAttributes
    .filter((a) => a.required)
    .map((a) => {
      let desc = `- ${a.name} (id: ${a.id}, type: ${a.type})`;
      if (a.values.length > 0) {
        const valuesList = a.values.slice(0, 20).map((v) => `"${v.name}" (${v.id})`).join(", ");
        desc += ` [Valores possíveis: ${valuesList}]`;
        if (a.values.length > 20) desc += ` ... e mais ${a.values.length - 20} valores`;
      }
      return desc;
    })
    .join("\n");

  const productFeatures = product.features
    ? Object.entries(product.features)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "Nenhuma";

  const prompt = `Você é um especialista em e-commerce e Mercado Livre. Analise o produto abaixo e preencha os atributos obrigatórios para listagem no Mercado Livre.

PRODUTO:
Nome: ${product.name}
Descrição: ${product.description || "N/A"}
EAN: ${product.ean || "N/A"}
SKU: ${product.sku || "N/A"}
Marca: ${product.brand || "N/A"}
Características: 
${productFeatures}

ATRIBUTOS OBRIGATÓRIOS A PREENCHER:
${attrDescriptions}

REGRAS:
1. Se o atributo tem valores possíveis listados, DEVE escolher um deles (use o value_id correspondente)
2. Se o atributo permite valor customizado, pode criar um valor baseado no produto
3. Para BRAND (marca), use a marca do produto ou "Genérica" se não souber
4. Para GTIN (EAN), use o EAN do produto se disponível
5. Seja preciso e realista nos valores

Responda APENAS com um JSON array de objetos com os campos: id, value_name, value_id (se aplicável)`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "Você é um assistente especializado em e-commerce brasileiro. Responda apenas com JSON válido." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ml_attributes",
          strict: true,
          schema: {
            type: "object",
            properties: {
              attributes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string", description: "Attribute ID from ML" },
                    value_name: { type: "string", description: "Value name/text" },
                    value_id: { type: ["string", "null"], description: "Value ID if from predefined list" },
                  },
                  required: ["id", "value_name"],
                  additionalProperties: false,
                },
              },
            },
            required: ["attributes"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return [];
    if (typeof content !== "string") return [];

    const parsed = JSON.parse(content);
    return parsed.attributes || [];
  } catch (error) {
    console.error("[ML AI] Failed to fill attributes:", error);
    return [];
  }
}

// ============ LISTING MANAGEMENT (DB) ============

/**
 * Save a listing record in our database
 */
export async function saveListing(
  userId: number,
  data: {
    mlAccountId: number;
    mlItemId?: string;
    productId: string;
    productName?: string;
    title?: string;
    categoryId?: string;
    categoryName?: string;
    price?: string;
    status?: "draft" | "active" | "paused" | "closed" | "error";
    listingType?: string;
    permalink?: string;
    attributes?: unknown;
    errorMessage?: string;
    mlResponse?: unknown;
  }
) {
  const db = getDb();
  const [result] = await db.insert(mlListings).values({
    userId,
    mlAccountId: data.mlAccountId,
    mlItemId: data.mlItemId || null,
    productId: data.productId,
    productName: data.productName || null,
    title: data.title || null,
    categoryId: data.categoryId || null,
    categoryName: data.categoryName || null,
    price: data.price || null,
    status: data.status || "draft",
    listingType: data.listingType || "gold_special",
    permalink: data.permalink || null,
    attributes: data.attributes || null,
    errorMessage: data.errorMessage || null,
    mlResponse: data.mlResponse || null,
  });
  return result.insertId;
}

/**
 * Get listings for a user
 */
export async function getListings(userId: number, mlAccountId?: number) {
  const db = getDb();
  const conditions = [eq(mlListings.userId, userId)];
  if (mlAccountId) conditions.push(eq(mlListings.mlAccountId, mlAccountId));

  return db
    .select()
    .from(mlListings)
    .where(and(...conditions))
    .orderBy(desc(mlListings.createdAt))
    .limit(100);
}

/**
 * Full flow: predict category, get attributes, fill with AI, create item
 */
export async function publishProduct(
  userId: number,
  accountId: number,
  product: {
    productId: string;
    name: string;
    description?: string;
    price: number;
    stock: number;
    ean?: string;
    sku?: string;
    brand?: string;
    images?: string[];
    features?: Record<string, string>;
    categoryId?: string; // If already known
  }
) {
  try {
    console.log(`[ML publishProduct] Starting for product: "${product.name}" (ID: ${product.productId})`);
    console.log(`[ML publishProduct] Input categoryId: ${product.categoryId || 'NOT PROVIDED (will use findBestCategory)'}`);
    
    // 1. Determine category - use local DB + domain_discovery
    let categoryId = product.categoryId;
    let categoryName = "";

    // Validate provided categoryId against local DB
    if (categoryId) {
      if (!categoryId.match(/^MLB\d+$/)) {
        console.warn(`[ML publishProduct] Provided categoryId "${categoryId}" has invalid format, ignoring`);
        categoryId = undefined;
      } else {
        // Check if it exists in our local DB
        const localCat = await getLocalCategoryInfo(categoryId);
        if (localCat) {
          categoryName = localCat.name;
          console.log(`[ML publishProduct] Provided categoryId validated in local DB: ${categoryId} = ${categoryName}`);
        } else {
          // Try to validate via ML API directly
          try {
            const catInfo = await getCategoryInfo(categoryId);
            categoryName = catInfo.name;
            console.log(`[ML publishProduct] Provided categoryId validated via API: ${categoryId} = ${categoryName}`);
          } catch (e) {
            console.warn(`[ML publishProduct] Provided categoryId ${categoryId} is invalid, will use findBestCategory`);
            categoryId = undefined;
          }
        }
      }
    }

    // If no valid categoryId, use findBestCategory (domain_discovery + local DB)
    if (!categoryId) {
      console.log(`[ML publishProduct] Finding best category for: "${product.name}"`);
      const bestCategory = await findBestCategory(product.name);
      if (bestCategory) {
        categoryId = bestCategory.categoryId;
        categoryName = bestCategory.categoryName;
        console.log(`[ML publishProduct] Best category found: ${categoryId} = ${categoryName} (source: ${bestCategory.source})`);
      } else {
        throw new Error(`Não foi possível determinar a categoria do produto "${product.name}" no Mercado Livre. Sincronize as categorias primeiro.`);
      }
    }

    console.log(`[ML publishProduct] Using category: ${categoryId} = ${categoryName}`);

    // 2. Get required attributes for the category
    const allAttributes = await getCategoryAttributes(categoryId!);
    const requiredAttrs = allAttributes.filter((a: any) => a.required);

    // 3. Fill attributes with AI
    let filledAttributes: any[] = [];
    if (requiredAttrs.length > 0) {
      filledAttributes = await fillAttributesWithAI(
        {
          name: product.name,
          description: product.description,
          ean: product.ean,
          sku: product.sku,
          brand: product.brand,
          features: product.features,
        },
        requiredAttrs
      );
    }

    // Ensure all required attributes are present with fallback values
    for (const reqAttr of requiredAttrs) {
      const existing = filledAttributes.find((a: any) => a.id === reqAttr.id);
      if (!existing) {
        console.warn(`[ML publishProduct] Required attribute ${reqAttr.id} (${reqAttr.name}) missing from AI response, adding fallback`);
        let fallbackValue = "";
        
        // Smart fallbacks for common required attributes
        if (reqAttr.id === "BRAND") {
          fallbackValue = product.brand || "Genérica";
        } else if (reqAttr.id === "MODEL") {
          // Extract model from product name (first 40 chars)
          fallbackValue = product.name.substring(0, 40);
        } else if (reqAttr.id === "GTIN") {
          fallbackValue = product.ean || "";
        } else if (reqAttr.values && reqAttr.values.length > 0) {
          // Use first available value as fallback
          filledAttributes.push({ id: reqAttr.id, value_name: reqAttr.values[0].name, value_id: reqAttr.values[0].id });
          continue;
        } else {
          fallbackValue = "N/A";
        }
        
        if (fallbackValue) {
          filledAttributes.push({ id: reqAttr.id, value_name: fallbackValue });
        }
      } else if (!existing.value_name && !existing.value_id) {
        // Attribute exists but has no value
        console.warn(`[ML publishProduct] Required attribute ${reqAttr.id} has empty value, fixing`);
        if (reqAttr.id === "BRAND") existing.value_name = product.brand || "Genérica";
        else if (reqAttr.id === "MODEL") existing.value_name = product.name.substring(0, 40);
      }
    }

    // Add GTIN/EAN if available and not already filled
    if (product.ean && !filledAttributes.find((a: any) => a.id === "GTIN")) {
      filledAttributes.push({ id: "GTIN", value_name: product.ean });
    }

    // Add SELLER_SKU if available
    if (product.sku && !filledAttributes.find((a: any) => a.id === "SELLER_SKU")) {
      filledAttributes.push({ id: "SELLER_SKU", value_name: product.sku });
    }

    // Log all attributes being sent for debugging
    console.log(`[ML publishProduct] Required attrs for category: ${requiredAttrs.map((a: any) => a.id).join(', ')}`);
    console.log(`[ML publishProduct] Filled attributes: ${filledAttributes.map((a: any) => `${a.id}=${a.value_name || a.value_id}`).join(', ')}`);
    
    // Validate: ensure no attribute has both value_name and value_id as empty/null
    filledAttributes = filledAttributes.filter((a: any) => a.value_name || a.value_id);

    // 4. Prepare pictures
    const pictures = (product.images || []).map((url) => ({ source: url }));

    // 5. Create item on ML
    console.log(`[ML publishProduct] Creating item with categoryId=${categoryId}, title="${product.name.substring(0, 60)}", price=${product.price}, stock=${product.stock}`);
    console.log(`[ML publishProduct] Attributes to send:`, JSON.stringify(filledAttributes).substring(0, 300));
    const mlItem = await createItem(accountId, {
      title: product.name.substring(0, 60), // ML title limit is 60 chars
      categoryId: categoryId!,
      price: product.price,
      availableQuantity: product.stock,
      description: product.description,
      pictures,
      attributes: filledAttributes,
    });

    // 6. Save listing in our DB
    const listingId = await saveListing(userId, {
      mlAccountId: accountId,
      mlItemId: mlItem.id,
      productId: product.productId,
      productName: product.name,
      title: mlItem.title,
      categoryId: categoryId!,
      categoryName,
      price: String(product.price),
      status: mlItem.status === "active" ? "active" : "draft",
      permalink: mlItem.permalink,
      attributes: filledAttributes,
      mlResponse: mlItem,
    });

    return {
      success: true,
      listingId,
      mlItemId: mlItem.id,
      permalink: mlItem.permalink,
      status: mlItem.status,
      categoryId,
      categoryName,
      filledAttributes,
    };
  } catch (error: any) {
    // Save error in DB
    await saveListing(userId, {
      mlAccountId: accountId,
      productId: product.productId,
      productName: product.name,
      status: "error",
      errorMessage: error.message,
    });

    return {
      success: false,
      error: error.message,
      productId: product.productId,
    };
  }
}
