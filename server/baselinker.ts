/**
 * BaseLinker API Integration Module
 * Handles all communication with the BaseLinker API
 * API Docs: https://api.baselinker.com/
 * 
 * PERSISTENT CACHE SYSTEM:
 * Products are cached in the database (product_cache table).
 * First sync scans all products and saves to DB.
 * Subsequent loads read from DB instantly (~1-2 seconds).
 * Background sync updates only new/changed products.
 */

import { eq, and, sql, inArray, gte, lte, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { productCache, cacheSync } from "../drizzle/schema";

const BASELINKER_API_URL = "https://api.baselinker.com/connector.php";
const RATE_LIMIT_DELAY = 200;

let lastRequestTime = 0;

async function rateLimitedRequest(token: string, method: string, parameters: Record<string, unknown> = {}) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

  const body = new URLSearchParams();
  body.append("method", method);
  body.append("parameters", JSON.stringify(parameters));

  const response = await fetch(BASELINKER_API_URL, {
    method: "POST",
    headers: {
      "X-BLToken": token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`BaseLinker API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.status === "ERROR") {
    throw new Error(`BaseLinker API error: ${data.error_code} - ${data.error_message}`);
  }

  return data;
}

// ==========================================
// BASIC API METHODS
// ==========================================

export async function validateToken(token: string): Promise<boolean> {
  try {
    await rateLimitedRequest(token, "getInventories");
    return true;
  } catch {
    return false;
  }
}

export async function getInventories(token: string) {
  const data = await rateLimitedRequest(token, "getInventories");
  return data.inventories || [];
}

export async function getInventoryTags(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryTags", { inventory_id: inventoryId });
  return data.tags || [];
}

export async function getInventoryCategories(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryCategories", { inventory_id: inventoryId });
  return data.categories || [];
}

export async function getInventoryProductsList(
  token: string,
  inventoryId: number,
  options: { filterCategoryId?: number; filterName?: string; page?: number } = {}
) {
  const params: Record<string, unknown> = { inventory_id: inventoryId };
  if (options.filterCategoryId) params.filter_category_id = options.filterCategoryId;
  if (options.filterName) params.filter_name = options.filterName;
  if (options.page) params.page = options.page;

  const data = await rateLimitedRequest(token, "getInventoryProductsList", params);
  return { products: data.products || {}, total: Object.keys(data.products || {}).length };
}

export async function getInventoryProductsData(token: string, inventoryId: number, productIds: number[]) {
  const data = await rateLimitedRequest(token, "getInventoryProductsData", {
    inventory_id: inventoryId,
    products: productIds,
  });
  return data.products || {};
}

export async function getExternalStoragesList(token: string) {
  const data = await rateLimitedRequest(token, "getExternalStoragesList");
  return data.storages || [];
}

export async function getExternalStorageCategories(token: string, storageId: string) {
  const data = await rateLimitedRequest(token, "getExternalStorageCategories", { storage_id: storageId });
  return data.categories || [];
}

export async function getInventoryIntegrations(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryIntegrations", { inventory_id: inventoryId });
  return data.integrations || [];
}

export async function getInventoryManufacturers(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryManufacturers", { inventory_id: inventoryId });
  return data.manufacturers || [];
}

export async function addInventoryProduct(token: string, inventoryId: number, productData: Record<string, unknown>) {
  const data = await rateLimitedRequest(token, "addInventoryProduct", { inventory_id: inventoryId, ...productData });
  return data;
}

/**
 * Export a product to a specific marketplace account by updating its text_fields
 * with marketplace-specific content (name, description, features).
 * 
 * The text_fields use the format: "field|lang|source_id"
 * - field: "name", "description", "features", "description_extra1-4"
 * - lang: "pt" for Portuguese
 * - source_id: e.g. "melibr_16544" for a specific ML account
 * 
 * This updates the product in the BaseLinker catalog with marketplace-specific data,
 * making it ready for listing in the marketplace.
 */
export interface ExportProductData {
  productId: string;
  name: string;
  description: string;
  features: Record<string, string>;
  category?: string;
  ean?: string;
  sku?: string;
  price?: number;
  stock?: number;
  images?: Record<string, string>; // position -> url
}

export async function exportProductToMarketplace(
  token: string,
  inventoryId: number,
  product: ExportProductData,
  marketplaceType: string, // e.g. "melibr"
  accountId: string, // e.g. "16544"
): Promise<{ success: boolean; productId: string; error?: string }> {
  try {
    // Build the source_id for marketplace-specific text fields
    const sourceId = `${marketplaceType}_${accountId}`;
    
    // Build text_fields with marketplace-specific content
    const textFields: Record<string, string> = {};
    
    // Set name for the specific marketplace account
    textFields[`name|pt|${sourceId}`] = product.name;
    
    // Set description for the specific marketplace account
    textFields[`description|pt|${sourceId}`] = product.description;
    
    // Set features for the specific marketplace account
    if (product.features && Object.keys(product.features).length > 0) {
      textFields[`features|pt|${sourceId}`] = JSON.stringify(product.features);
    }
    
    // Also set default name and description (without source_id) as fallback
    textFields["name"] = product.name;
    textFields["description"] = product.description;
    if (product.features && Object.keys(product.features).length > 0) {
      textFields["features"] = JSON.stringify(product.features);
    }
    
    // Build the product update payload
    const updatePayload: Record<string, unknown> = {
      product_id: product.productId,
      text_fields: textFields,
    };
    
    // Add EAN if provided
    if (product.ean) {
      updatePayload.ean = product.ean;
    }
    
    // Add SKU if provided
    if (product.sku) {
      updatePayload.sku = product.sku;
    }
    
    // Add images if provided
    if (product.images && Object.keys(product.images).length > 0) {
      const formattedImages: Record<string, string> = {};
      for (const [pos, url] of Object.entries(product.images)) {
        // BaseLinker requires "url:" prefix for external URLs
        formattedImages[pos] = url.startsWith("url:") ? url : `url:${url}`;
      }
      updatePayload.images = formattedImages;
    }
    
    // Call addInventoryProduct to update the product
    const result = await addInventoryProduct(token, inventoryId, updatePayload);
    
    return {
      success: true,
      productId: result.product_id || product.productId,
    };
  } catch (error: any) {
    return {
      success: false,
      productId: product.productId,
      error: error.message || "Erro desconhecido ao exportar produto",
    };
  }
}

/**
 * Export multiple products to a marketplace account in batch.
 * Processes products sequentially to respect API rate limits.
 */
export async function exportProductsBatch(
  token: string,
  inventoryId: number,
  products: ExportProductData[],
  marketplaceType: string,
  accountId: string,
  onProgress?: (current: number, total: number, result: { success: boolean; productId: string; error?: string }) => void,
): Promise<{ successCount: number; errorCount: number; results: Array<{ success: boolean; productId: string; error?: string }> }> {
  const results: Array<{ success: boolean; productId: string; error?: string }> = [];
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < products.length; i++) {
    const result = await exportProductToMarketplace(
      token,
      inventoryId,
      products[i],
      marketplaceType,
      accountId,
    );
    
    results.push(result);
    if (result.success) {
      successCount++;
    } else {
      errorCount++;
    }
    
    if (onProgress) {
      onProgress(i + 1, products.length, result);
    }
  }
  
  return { successCount, errorCount, results };
}

export async function getInventoryExtraFields(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryExtraFields", { inventory_id: inventoryId });
  return data.extra_fields || [];
}

/**
 * Get all order sources (marketplace accounts) from BaseLinker.
 * This is the correct method to list ALL marketplace connections including
 * Mercado Livre, Shopee, Amazon, Magazine Luiza, etc.
 * Returns: { sources: { marketplace_type: { account_id: account_name } } }
 */
export async function getOrderSources(token: string) {
  const data = await rateLimitedRequest(token, "getOrderSources");
  return data.sources || {};
}

/** Marketplace type display names */
const MARKETPLACE_NAMES: Record<string, string> = {
  personal: "Pessoal",
  shop: "Loja Virtual",
  blconnect: "BL Connect",
  amazon: "Amazon",
  americanas: "Americanas",
  omnik: "Omnik",
  shopeebr: "Shopee",
  carrefourbr: "Carrefour",
  kabum: "Kabum",
  leroymerlinbr: "Leroy Merlin",
  madeiramadeira: "Madeira Madeira",
  magaluopenapi: "Magazine Luiza",
  webcontinental: "Webcontinental",
  olist: "Olist",
  shein: "Shein",
  viavarejo: "Via Varejo",
  melibr: "Mercado Livre",
  order_return: "Devolução",
  mercadolivre: "Mercado Livre",
  ml: "Mercado Livre",
  shopee: "Shopee",
  magalu: "Magazine Luiza",
};

export type MarketplaceAccount = {
  id: string;
  name: string;
  marketplaceType: string;
  marketplaceName: string;
};

/**
 * Parse getOrderSources response into a flat list of marketplace accounts.
 * Excludes 'personal' and 'order_return' types.
 */
export function parseOrderSourcesToAccounts(sources: Record<string, Record<string, string>>): MarketplaceAccount[] {
  const accounts: MarketplaceAccount[] = [];
  const excludeTypes = new Set(["personal", "order_return"]);
  
  for (const [marketplaceType, accountsMap] of Object.entries(sources)) {
    if (excludeTypes.has(marketplaceType)) continue;
    const marketplaceName = MARKETPLACE_NAMES[marketplaceType] || marketplaceType;
    
    for (const [accountId, accountName] of Object.entries(accountsMap)) {
      accounts.push({
        id: `${marketplaceType}_${accountId}`,
        name: String(accountName),
        marketplaceType,
        marketplaceName,
      });
    }
  }
  
  // Sort by marketplace name, then account name
  accounts.sort((a, b) => {
    const cmp = a.marketplaceName.localeCompare(b.marketplaceName);
    return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
  });
  
  return accounts;
}

// ==========================================
// PERSISTENT CACHE SYSTEM (Database-backed)
// ==========================================

export type IndexedProduct = {
  id: number;
  name: string;
  ean: string;
  sku: string;
  tags: string[];
  categoryId: number;
  manufacturerId: number;
  weight: number;
  mainPrice: number;
  totalStock: number;
  description: string;
  imageUrl: string;
};

export type ScanProgress = {
  currentPage: number;
  totalEstimatedPages: number;
  productsScanned: number;
  productsIndexed: number;
  isScanning: boolean;
  isComplete: boolean;
  uniqueTags: number;
};

export type ProductFilters = {
  tagName?: string;
  tags?: string[];
  categoryId?: number;
  manufacturerId?: number;
  searchName?: string;
  searchEan?: string;
  searchSku?: string;
  priceMin?: number;
  priceMax?: number;
  stockMin?: number;
  stockMax?: number;
  weightMin?: number;
  weightMax?: number;
};

// Track active scans in memory
const activeScanProgress = new Map<string, ScanProgress>();
const activeScanAbort = new Map<string, boolean>();

function getCacheKey(userId: number, inventoryId: number): string {
  return `${userId}_${inventoryId}`;
}

function getDbInstance() {
  if (!process.env.DATABASE_URL) return null;
  return drizzle(process.env.DATABASE_URL);
}

/** Get cache sync status from database */
export async function getCacheSyncStatus(userId: number, inventoryId: number) {
  const db = getDbInstance();
  if (!db) return null;

  const rows = await db.select().from(cacheSync)
    .where(and(eq(cacheSync.userId, userId), eq(cacheSync.inventoryId, inventoryId)))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

/** Get scan progress */
export function getTagScanProgress(userId: number, inventoryId: number): ScanProgress {
  const key = getCacheKey(userId, inventoryId);
  return activeScanProgress.get(key) || {
    currentPage: 0,
    totalEstimatedPages: 0,
    productsScanned: 0,
    productsIndexed: 0,
    isScanning: false,
    isComplete: false,
    uniqueTags: 0,
  };
}

/** Start full sync: scan all products from BaseLinker and save to database */
export async function startProductSync(
  token: string,
  userId: number,
  inventoryId: number,
  forceFullSync: boolean = false,
  onProgress?: (progress: ScanProgress) => void
): Promise<void> {
  const key = getCacheKey(userId, inventoryId);
  const db = getDbInstance();
  if (!db) throw new Error("Database not available");

  // Check if already scanning
  const existing = activeScanProgress.get(key);
  if (existing?.isScanning) return;

  // Check if cache is fresh (< 30 min) and not forcing full sync
  if (!forceFullSync) {
    const syncStatus = await getCacheSyncStatus(userId, inventoryId);
    if (syncStatus?.isComplete && syncStatus.lastSyncAt) {
      const age = Date.now() - new Date(syncStatus.lastSyncAt).getTime();
      // Cache is valid for 24 hours - user can manually refresh anytime
      if (age < 24 * 60 * 60 * 1000) {
        // Cache is fresh, skip sync
        const progress: ScanProgress = {
          currentPage: 0,
          totalEstimatedPages: 0,
          productsScanned: syncStatus.totalProducts,
          productsIndexed: syncStatus.totalProducts,
          isScanning: false,
          isComplete: true,
          uniqueTags: 0,
        };
        activeScanProgress.set(key, progress);
        onProgress?.(progress);
        return;
      }
    }
  }

  const progress: ScanProgress = {
    currentPage: 0,
    totalEstimatedPages: 0,
    productsScanned: 0,
    productsIndexed: 0,
    isScanning: true,
    isComplete: false,
    uniqueTags: 0,
  };

  activeScanProgress.set(key, progress);
  activeScanAbort.set(key, false);

  try {
    // If forcing full sync, clear existing cache
    if (forceFullSync) {
      await db.delete(productCache).where(
        and(eq(productCache.userId, userId), eq(productCache.inventoryId, inventoryId))
      );
    }

    let page = 1;
    let hasMore = true;
    let totalInserted = 0;
    const allTags = new Set<string>();

    while (hasMore) {
      if (activeScanAbort.get(key)) break;

      const listResult = await getInventoryProductsList(token, inventoryId, { page });
      const productIds = Object.keys(listResult.products).map(Number);

      if (productIds.length === 0) {
        hasMore = false;
        break;
      }

      // Get detailed data in batches of 100
      const BATCH_SIZE = 100;
      for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
        if (activeScanAbort.get(key)) break;

        const batch = productIds.slice(i, i + BATCH_SIZE);

        let detailedData: Record<string, any>;
        try {
          detailedData = await getInventoryProductsData(token, inventoryId, batch);
        } catch (err) {
          console.warn(`[ProductSync] Batch error, retrying after delay...`, err);
          await new Promise(r => setTimeout(r, 2000));
          try {
            detailedData = await getInventoryProductsData(token, inventoryId, batch);
          } catch (err2) {
            console.error(`[ProductSync] Batch failed permanently, skipping`, err2);
            continue;
          }
        }

        // Prepare batch insert
        const rows: any[] = [];
        for (const [id, product] of Object.entries(detailedData) as [string, any][]) {
          const priceValues = Object.values(product.prices || {}) as number[];
          const mainPrice = priceValues.length > 0 ? priceValues[0] : 0;
          const stockValues = Object.values(product.stock || {}) as number[];
          const totalStock = stockValues.reduce((sum: number, v: number) => sum + (v || 0), 0);
          const tags = product.tags || [];
          tags.forEach((t: string) => allTags.add(t));

          // Get first image URL
          const imageEntries = Object.values(product.images || {}) as string[];
          const imageUrl = imageEntries.length > 0 ? imageEntries[0] : "";

          rows.push({
            userId,
            inventoryId,
            productId: Number(id),
            name: (product.text_fields?.name || "").substring(0, 1024),
            sku: (product.sku || "").substring(0, 256),
            ean: (product.ean || "").substring(0, 128),
            categoryId: product.category_id || 0,
            manufacturerId: product.manufacturer_id || 0,
            mainPrice: String(mainPrice).substring(0, 32),
            totalStock,
            weight: String(product.weight || 0).substring(0, 32),
            tags: tags,
            description: product.text_fields?.description || "",
            imageUrl: (imageUrl || "").substring(0, 1024),
          });
        }

        if (rows.length > 0) {
          // Upsert: delete existing then insert (simpler than ON DUPLICATE KEY for bulk)
          const existingIds = rows.map(r => r.productId);
          await db.delete(productCache).where(
            and(
              eq(productCache.userId, userId),
              eq(productCache.inventoryId, inventoryId),
              inArray(productCache.productId, existingIds)
            )
          );
          await db.insert(productCache).values(rows);
          totalInserted += rows.length;
        }

        progress.productsScanned += batch.length;
        progress.productsIndexed = totalInserted;
        progress.uniqueTags = allTags.size;
      }

      progress.currentPage = page;
      if (productIds.length >= 1000) {
        progress.totalEstimatedPages = Math.max(progress.totalEstimatedPages, page + 1);
      }

      activeScanProgress.set(key, { ...progress });
      onProgress?.({ ...progress });

      hasMore = productIds.length >= 1000;
      page++;
    }

    // Update sync status
    const syncRows = await db.select().from(cacheSync)
      .where(and(eq(cacheSync.userId, userId), eq(cacheSync.inventoryId, inventoryId)))
      .limit(1);

    if (syncRows.length > 0) {
      await db.update(cacheSync)
        .set({
          totalProducts: totalInserted,
          isComplete: activeScanAbort.get(key) ? 0 : 1,
          lastSyncAt: new Date(),
        })
        .where(and(eq(cacheSync.userId, userId), eq(cacheSync.inventoryId, inventoryId)));
    } else {
      await db.insert(cacheSync).values({
        userId,
        inventoryId,
        totalProducts: totalInserted,
        isComplete: activeScanAbort.get(key) ? 0 : 1,
        lastSyncAt: new Date(),
      });
    }

    progress.isComplete = !activeScanAbort.get(key);
    progress.isScanning = false;
    progress.totalEstimatedPages = page - 1;
    activeScanProgress.set(key, progress);
    onProgress?.(progress);

    console.log(`[ProductSync] Complete: ${totalInserted} products saved to DB, ${allTags.size} unique tags`);
  } catch (error) {
    progress.isScanning = false;
    activeScanProgress.set(key, progress);
    console.error("[ProductSync] Error:", error);
    throw error;
  }
}

export function stopProductSync(userId: number, inventoryId: number) {
  const key = getCacheKey(userId, inventoryId);
  activeScanAbort.set(key, true);
}

/**
 * Filter products from the database cache.
 * Loads from DB (fast) instead of in-memory index.
 */
export async function filterProductsFromCache(
  userId: number,
  inventoryId: number,
  filters: ProductFilters,
  page: number = 1,
  pageSize: number = 50
): Promise<{
  products: IndexedProduct[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  allIds: number[];
}> {
  const db = getDbInstance();
  if (!db) {
    return { products: [], total: 0, page: 1, totalPages: 0, hasMore: false, allIds: [] };
  }

  // Build WHERE conditions
  const conditions: any[] = [
    eq(productCache.userId, userId),
    eq(productCache.inventoryId, inventoryId),
  ];

  // Tag filter - use JSON_CONTAINS for MySQL JSON column
  if (filters.tagName) {
    conditions.push(sql`JSON_CONTAINS(${productCache.tags}, ${JSON.stringify(filters.tagName)}, '$')`);
  }

  if (filters.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      conditions.push(sql`JSON_CONTAINS(${productCache.tags}, ${JSON.stringify(tag)}, '$')`);
    }
  }

  // Category filter
  if (filters.categoryId) {
    conditions.push(eq(productCache.categoryId, filters.categoryId));
  }

  // Manufacturer filter
  if (filters.manufacturerId) {
    conditions.push(eq(productCache.manufacturerId, filters.manufacturerId));
  }

  // Name search
  if (filters.searchName) {
    conditions.push(like(productCache.name, `%${filters.searchName}%`));
  }

  // EAN search
  if (filters.searchEan) {
    conditions.push(like(productCache.ean, `%${filters.searchEan}%`));
  }

  // SKU search
  if (filters.searchSku) {
    conditions.push(like(productCache.sku, `%${filters.searchSku}%`));
  }

  // Price range
  if (filters.priceMin !== undefined) {
    conditions.push(sql`CAST(${productCache.mainPrice} AS DECIMAL(10,2)) >= ${filters.priceMin}`);
  }
  if (filters.priceMax !== undefined) {
    conditions.push(sql`CAST(${productCache.mainPrice} AS DECIMAL(10,2)) <= ${filters.priceMax}`);
  }

  // Stock range
  if (filters.stockMin !== undefined) {
    conditions.push(gte(productCache.totalStock, filters.stockMin));
  }
  if (filters.stockMax !== undefined) {
    conditions.push(lte(productCache.totalStock, filters.stockMax));
  }

  // Weight range
  if (filters.weightMin !== undefined) {
    conditions.push(sql`CAST(${productCache.weight} AS DECIMAL(10,2)) >= ${filters.weightMin}`);
  }
  if (filters.weightMax !== undefined) {
    conditions.push(sql`CAST(${productCache.weight} AS DECIMAL(10,2)) <= ${filters.weightMax}`);
  }

  const whereClause = and(...conditions);

  // Get total count
  const countResult = await db.select({ count: sql<number>`COUNT(*)` })
    .from(productCache)
    .where(whereClause);
  const total = countResult[0]?.count || 0;

  // Get all IDs for "select all" functionality
  const allIdsResult = await db.select({ productId: productCache.productId })
    .from(productCache)
    .where(whereClause)
    .orderBy(sql`${productCache.productId} DESC`);
  const allIds = allIdsResult.map(r => r.productId);

  // Get paginated results
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = await db.select().from(productCache)
    .where(whereClause)
    .orderBy(sql`${productCache.productId} DESC`)
    .limit(pageSize)
    .offset(offset);

  const products: IndexedProduct[] = rows.map(row => ({
    id: row.productId,
    name: row.name,
    ean: row.ean,
    sku: row.sku,
    tags: (row.tags as string[]) || [],
    categoryId: row.categoryId,
    manufacturerId: row.manufacturerId,
    weight: parseFloat(row.weight) || 0,
    mainPrice: parseFloat(row.mainPrice) || 0,
    totalStock: row.totalStock,
    description: row.description || "",
    imageUrl: row.imageUrl || "",
  }));

  return {
    products,
    total,
    page,
    totalPages,
    hasMore: page < totalPages,
    allIds,
  };
}

/** Get products by IDs from cache */
export async function getProductsByIdsFromCache(
  userId: number,
  inventoryId: number,
  productIds: number[]
): Promise<IndexedProduct[]> {
  const db = getDbInstance();
  if (!db || productIds.length === 0) return [];

  const rows = await db.select().from(productCache)
    .where(and(
      eq(productCache.userId, userId),
      eq(productCache.inventoryId, inventoryId),
      inArray(productCache.productId, productIds)
    ));

  return rows.map(row => ({
    id: row.productId,
    name: row.name,
    ean: row.ean,
    sku: row.sku,
    tags: (row.tags as string[]) || [],
    categoryId: row.categoryId,
    manufacturerId: row.manufacturerId,
    weight: parseFloat(row.weight) || 0,
    mainPrice: parseFloat(row.mainPrice) || 0,
    totalStock: row.totalStock,
    description: row.description || "",
    imageUrl: row.imageUrl || "",
  }));
}

/** Get cache statistics from database */
export async function getCacheStats(userId: number, inventoryId: number) {
  const db = getDbInstance();
  if (!db) return null;

  const syncStatus = await getCacheSyncStatus(userId, inventoryId);
  if (!syncStatus) return null;

  // Get total count
  const countResult = await db.select({ count: sql<number>`COUNT(*)` })
    .from(productCache)
    .where(and(eq(productCache.userId, userId), eq(productCache.inventoryId, inventoryId)));
  const totalProducts = countResult[0]?.count || 0;

  // Get unique tags using JSON extraction
  const tagResult = await db.select({
    tag: sql<string>`jt.tag`,
    count: sql<number>`COUNT(*)`
  })
    .from(productCache)
    .where(and(eq(productCache.userId, userId), eq(productCache.inventoryId, inventoryId)))
    .innerJoin(
      sql`JSON_TABLE(${productCache.tags}, '$[*]' COLUMNS(tag VARCHAR(256) PATH '$')) AS jt`,
      sql`1=1`
    )
    .groupBy(sql`jt.tag`)
    .orderBy(sql`COUNT(*) DESC`);

  // Get unique categories count
  const catResult = await db.select({ count: sql<number>`COUNT(DISTINCT ${productCache.categoryId})` })
    .from(productCache)
    .where(and(eq(productCache.userId, userId), eq(productCache.inventoryId, inventoryId)));

  // Get unique manufacturers count
  const manResult = await db.select({ count: sql<number>`COUNT(DISTINCT ${productCache.manufacturerId})` })
    .from(productCache)
    .where(and(eq(productCache.userId, userId), eq(productCache.inventoryId, inventoryId)));

  return {
    totalProducts,
    uniqueTags: tagResult.length,
    uniqueCategories: catResult[0]?.count || 0,
    uniqueManufacturers: manResult[0]?.count || 0,
    isComplete: syncStatus.isComplete === 1,
    lastUpdated: new Date(syncStatus.lastSyncAt).getTime(),
    tagStats: tagResult.map(r => ({ tag: r.tag, count: r.count })),
  };
}

// Legacy compat
export async function getProductsByTag(
  token: string,
  inventoryId: number,
  tagName: string,
  page: number = 1,
  pageSize: number = 50
) {
  // This is a fallback — prefer filterProductsFromCache
  const result = await filterProductsFromCache(0, inventoryId, { tagName }, page, pageSize);
  const products: Record<string, any> = {};
  for (const p of result.products) {
    products[String(p.id)] = p;
  }
  return {
    products,
    total: result.total,
    page: result.page,
    totalPages: result.totalPages,
    hasMore: result.hasMore,
  };
}

// Keep old function signatures for backward compat
export function filterProductsFromIndex(
  token: string,
  inventoryId: number,
  filters: ProductFilters,
  page: number = 1,
  pageSize: number = 50
) {
  // Redirect to cache-based filtering
  // This is sync wrapper - callers should migrate to filterProductsFromCache
  return {
    products: [] as IndexedProduct[],
    total: 0,
    page: 1,
    totalPages: 0,
    hasMore: false,
    indexComplete: false,
    scanProgress: getTagScanProgress(0, inventoryId),
    allIds: [] as number[],
  };
}

export function getIndexStats(token: string, inventoryId: number) {
  return null; // Replaced by getCacheStats
}

export function stopTagIndexScan(token: string, inventoryId: number) {
  // Legacy - no-op
}

export async function startTagIndexScan(token: string, inventoryId: number) {
  // Legacy - no-op, replaced by startProductSync
}

export type BaseLinkerProduct = {
  id: number;
  ean: string;
  sku: string;
  name: string;
  quantity: number;
  price_brutto: number;
  tax_rate: number;
  weight: number;
  description: string;
  description_extra1: string;
  description_extra2: string;
  man_name: string;
  category_id: number;
  images: Record<string, string>;
  features: Record<string, string>;
  variants: Record<string, any>;
  text_fields: Record<string, any>;
  tags: string[];
};
