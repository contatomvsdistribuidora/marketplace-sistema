/**
 * BaseLinker API Integration Module
 * Handles all communication with the BaseLinker API
 * API Docs: https://api.baselinker.com/
 * 
 * IMPORTANT: The BaseLinker API getInventoryProductsList does NOT support
 * filtering by tag. Tags are only available in getInventoryProductsData.
 * 
 * Strategy for tag filtering with 124k+ products:
 * 1. Scan all products in background (getInventoryProductsList pages)
 * 2. Get detailed data in batches of 100 (getInventoryProductsData)
 * 3. Build an in-memory index of productId -> tags
 * 4. Filter from the index when user selects a tag
 * 5. Cache the index to avoid re-scanning
 */

const BASELINKER_API_URL = "https://api.baselinker.com/connector.php";
const RATE_LIMIT_DELAY = 200; // ~300 requests per minute (safe margin)

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

/** Validate the token by fetching inventories */
export async function validateToken(token: string): Promise<boolean> {
  try {
    await rateLimitedRequest(token, "getInventories");
    return true;
  } catch {
    return false;
  }
}

/** Get all inventories (catalogs) */
export async function getInventories(token: string) {
  const data = await rateLimitedRequest(token, "getInventories");
  return data.inventories || [];
}

/** Get tags for a specific inventory */
export async function getInventoryTags(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryTags", { inventory_id: inventoryId });
  return data.tags || [];
}

/** Get categories for a specific inventory */
export async function getInventoryCategories(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryCategories", { inventory_id: inventoryId });
  return data.categories || [];
}

/**
 * Get product list - paginated (basic data only, no tags)
 */
export async function getInventoryProductsList(
  token: string,
  inventoryId: number,
  options: {
    filterCategoryId?: number;
    filterName?: string;
    page?: number;
  } = {}
) {
  const params: Record<string, unknown> = {
    inventory_id: inventoryId,
  };

  if (options.filterCategoryId) params.filter_category_id = options.filterCategoryId;
  if (options.filterName) params.filter_name = options.filterName;
  if (options.page) params.page = options.page;

  const data = await rateLimitedRequest(token, "getInventoryProductsList", params);
  return {
    products: data.products || {},
    total: Object.keys(data.products || {}).length,
  };
}

/** Get detailed product data for specific product IDs (max 100 at a time) */
export async function getInventoryProductsData(token: string, inventoryId: number, productIds: number[]) {
  const data = await rateLimitedRequest(token, "getInventoryProductsData", {
    inventory_id: inventoryId,
    products: productIds,
  });
  return data.products || {};
}

// ==========================================
// TAG INDEX SYSTEM
// ==========================================

type TagIndex = {
  tagToProducts: Map<string, Set<number>>; // tag name -> set of product IDs
  productToTags: Map<number, string[]>;     // product ID -> list of tags
  totalScanned: number;
  totalPages: number;
  isComplete: boolean;
  lastUpdated: number;
};

type ScanProgress = {
  currentPage: number;
  totalEstimatedPages: number;
  productsScanned: number;
  productsWithTag: number;
  isScanning: boolean;
  isComplete: boolean;
};

// In-memory cache per inventory
const tagIndexCache = new Map<string, TagIndex>();
const scanProgressCache = new Map<string, ScanProgress>();
const activeScanAbort = new Map<string, boolean>();

function getCacheKey(token: string, inventoryId: number): string {
  return `${token.substring(0, 10)}_${inventoryId}`;
}

/** Get scan progress for an inventory */
export function getTagScanProgress(token: string, inventoryId: number): ScanProgress {
  const key = getCacheKey(token, inventoryId);
  return scanProgressCache.get(key) || {
    currentPage: 0,
    totalEstimatedPages: 0,
    productsScanned: 0,
    productsWithTag: 0,
    isScanning: false,
    isComplete: false,
  };
}

/**
 * Start scanning all products to build the tag index.
 * This runs in the background and updates progress.
 */
export async function startTagIndexScan(
  token: string,
  inventoryId: number,
  onProgress?: (progress: ScanProgress) => void
): Promise<void> {
  const key = getCacheKey(token, inventoryId);

  // Check if already scanning
  const existing = scanProgressCache.get(key);
  if (existing?.isScanning) {
    return; // Already scanning
  }

  // Check if we have a recent complete index (less than 10 min old)
  const cachedIndex = tagIndexCache.get(key);
  if (cachedIndex?.isComplete && (Date.now() - cachedIndex.lastUpdated) < 10 * 60 * 1000) {
    return; // Cache is fresh
  }

  // Initialize
  const index: TagIndex = {
    tagToProducts: new Map(),
    productToTags: new Map(),
    totalScanned: 0,
    totalPages: 0,
    isComplete: false,
    lastUpdated: Date.now(),
  };

  const progress: ScanProgress = {
    currentPage: 0,
    totalEstimatedPages: 0,
    productsScanned: 0,
    productsWithTag: 0,
    isScanning: true,
    isComplete: false,
  };

  scanProgressCache.set(key, progress);
  activeScanAbort.set(key, false);

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      // Check for abort
      if (activeScanAbort.get(key)) {
        break;
      }

      // Get product list page
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
        const detailedData = await getInventoryProductsData(token, inventoryId, batch);

        for (const [id, product] of Object.entries(detailedData) as [string, any][]) {
          const productId = Number(id);
          const tags: string[] = product.tags || [];

          if (tags.length > 0) {
            index.productToTags.set(productId, tags);
            for (const tag of tags) {
              if (!index.tagToProducts.has(tag)) {
                index.tagToProducts.set(tag, new Set());
              }
              index.tagToProducts.get(tag)!.add(productId);
            }
            progress.productsWithTag++;
          }
        }

        index.totalScanned += batch.length;
        progress.productsScanned = index.totalScanned;
      }

      progress.currentPage = page;
      // Estimate total pages based on 1000 products per page
      if (productIds.length >= 1000) {
        progress.totalEstimatedPages = Math.max(progress.totalEstimatedPages, page + 1);
      }

      onProgress?.(progress);

      hasMore = productIds.length >= 1000;
      page++;
    }

    index.totalPages = page - 1;
    index.isComplete = !activeScanAbort.get(key);
    index.lastUpdated = Date.now();

    progress.isComplete = index.isComplete;
    progress.isScanning = false;
    progress.totalEstimatedPages = index.totalPages;

    tagIndexCache.set(key, index);
    scanProgressCache.set(key, progress);
    onProgress?.(progress);

    console.log(`[TagIndex] Scan complete: ${index.totalScanned} products, ${index.tagToProducts.size} unique tags, ${progress.productsWithTag} products with tags`);
    const entries = Array.from(index.tagToProducts.entries());
    for (const [tag, products] of entries) {
      console.log(`  Tag "${tag}": ${products.size} products`);
    }
  } catch (error) {
    progress.isScanning = false;
    scanProgressCache.set(key, progress);
    console.error("[TagIndex] Scan error:", error);
    throw error;
  }
}

/** Stop an active scan */
export function stopTagIndexScan(token: string, inventoryId: number) {
  const key = getCacheKey(token, inventoryId);
  activeScanAbort.set(key, true);
}

/**
 * Get products by tag from the index.
 * If index is not ready, returns partial results from what's scanned so far.
 */
export function getProductsByTagFromIndex(
  token: string,
  inventoryId: number,
  tagName: string,
  page: number = 1,
  pageSize: number = 50
): { productIds: number[]; total: number; page: number; totalPages: number; indexComplete: boolean } {
  const key = getCacheKey(token, inventoryId);
  const index = tagIndexCache.get(key);

  if (!index) {
    return { productIds: [], total: 0, page: 1, totalPages: 0, indexComplete: false };
  }

  const matchingIds = index.tagToProducts.get(tagName);
  if (!matchingIds || matchingIds.size === 0) {
    return { productIds: [], total: 0, page: 1, totalPages: 0, indexComplete: index.isComplete };
  }

  const allIds = Array.from(matchingIds).sort((a, b) => a - b);
  const total = allIds.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const pageIds = allIds.slice(start, start + pageSize);

  return {
    productIds: pageIds,
    total,
    page,
    totalPages,
    indexComplete: index.isComplete,
  };
}

/**
 * Get products by tag - full flow.
 * Returns product data for a specific tag, paginated.
 */
export async function getProductsByTag(
  token: string,
  inventoryId: number,
  tagName: string,
  page: number = 1,
  pageSize: number = 50
): Promise<{
  products: Record<string, any>;
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  indexComplete: boolean;
  scanProgress: ScanProgress;
}> {
  // Get product IDs from index
  const indexResult = getProductsByTagFromIndex(token, inventoryId, tagName, page, pageSize);
  const scanProgress = getTagScanProgress(token, inventoryId);

  if (indexResult.productIds.length === 0) {
    return {
      products: {},
      total: indexResult.total,
      page,
      totalPages: indexResult.totalPages,
      hasMore: false,
      indexComplete: indexResult.indexComplete,
      scanProgress,
    };
  }

  // Get basic product data for the page
  const listResult = await getInventoryProductsData(token, inventoryId, indexResult.productIds);

  // Format the products
  const products: Record<string, any> = {};
  for (const [id, product] of Object.entries(listResult) as [string, any][]) {
    products[id] = {
      id: Number(id),
      name: product.text_fields?.name || "",
      ean: product.ean || "",
      sku: product.sku || "",
      tags: product.tags || [],
      prices: product.prices || {},
      stock: product.stock || {},
      description: product.text_fields?.description || "",
      features: product.features || {},
      weight: product.weight,
      images: product.images || {},
    };
  }

  return {
    products,
    total: indexResult.total,
    page,
    totalPages: indexResult.totalPages,
    hasMore: page < indexResult.totalPages,
    indexComplete: indexResult.indexComplete,
    scanProgress,
  };
}

/** Get external storages (connected marketplaces/shops) */
export async function getExternalStoragesList(token: string) {
  const data = await rateLimitedRequest(token, "getExternalStoragesList");
  return data.storages || [];
}

/** Get categories from an external storage (marketplace) */
export async function getExternalStorageCategories(token: string, storageId: string) {
  const data = await rateLimitedRequest(token, "getExternalStorageCategories", {
    storage_id: storageId,
  });
  return data.categories || [];
}

/** Get integrations for an inventory */
export async function getInventoryIntegrations(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryIntegrations", {
    inventory_id: inventoryId,
  });
  return data.integrations || [];
}

/** Get manufacturers for an inventory */
export async function getInventoryManufacturers(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryManufacturers", {
    inventory_id: inventoryId,
  });
  return data.manufacturers || [];
}

/** Add/update a product in inventory */
export async function addInventoryProduct(token: string, inventoryId: number, productData: Record<string, unknown>) {
  const data = await rateLimitedRequest(token, "addInventoryProduct", {
    inventory_id: inventoryId,
    ...productData,
  });
  return data;
}

/** Get extra fields for an inventory */
export async function getInventoryExtraFields(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryExtraFields", {
    inventory_id: inventoryId,
  });
  return data.extra_fields || [];
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
