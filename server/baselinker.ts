/**
 * BaseLinker API Integration Module
 * Handles all communication with the BaseLinker API
 * API Docs: https://api.baselinker.com/
 * 
 * FULL PRODUCT INDEX SYSTEM:
 * The BaseLinker API has limited filtering. To provide BaseLinker-like
 * filtering (by tag, price, stock, weight, manufacturer, etc.), we build
 * a complete in-memory product index by scanning all products in background.
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

export async function getInventoryExtraFields(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryExtraFields", { inventory_id: inventoryId });
  return data.extra_fields || [];
}

// ==========================================
// FULL PRODUCT INDEX SYSTEM
// ==========================================

/** Indexed product - lightweight version for filtering */
export type IndexedProduct = {
  id: number;
  name: string;
  ean: string;
  sku: string;
  tags: string[];
  categoryId: number;
  manufacturerId: number;
  weight: number;
  height: number;
  width: number;
  length: number;
  prices: Record<string, number>;
  stock: Record<string, number>;
  mainPrice: number;
  totalStock: number;
  images: Record<string, string>;
  description: string;
};

type ProductIndex = {
  products: Map<number, IndexedProduct>;
  tagToProducts: Map<string, Set<number>>;
  categoryToProducts: Map<number, Set<number>>;
  manufacturerToProducts: Map<number, Set<number>>;
  allTags: Set<string>;
  allCategoryIds: Set<number>;
  allManufacturerIds: Set<number>;
  totalScanned: number;
  totalPages: number;
  isComplete: boolean;
  lastUpdated: number;
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

// In-memory cache per inventory
const productIndexCache = new Map<string, ProductIndex>();
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
    productsIndexed: 0,
    isScanning: false,
    isComplete: false,
    uniqueTags: 0,
  };
}

/** Start scanning all products to build the full product index */
export async function startTagIndexScan(
  token: string,
  inventoryId: number,
  onProgress?: (progress: ScanProgress) => void
): Promise<void> {
  const key = getCacheKey(token, inventoryId);

  const existing = scanProgressCache.get(key);
  if (existing?.isScanning) return;

  const cachedIndex = productIndexCache.get(key);
  if (cachedIndex?.isComplete && (Date.now() - cachedIndex.lastUpdated) < 10 * 60 * 1000) return;

  const index: ProductIndex = {
    products: new Map(),
    tagToProducts: new Map(),
    categoryToProducts: new Map(),
    manufacturerToProducts: new Map(),
    allTags: new Set(),
    allCategoryIds: new Set(),
    allManufacturerIds: new Set(),
    totalScanned: 0,
    totalPages: 0,
    isComplete: false,
    lastUpdated: Date.now(),
  };

  const progress: ScanProgress = {
    currentPage: 0,
    totalEstimatedPages: 0,
    productsScanned: 0,
    productsIndexed: 0,
    isScanning: true,
    isComplete: false,
    uniqueTags: 0,
  };

  scanProgressCache.set(key, progress);
  activeScanAbort.set(key, false);

  try {
    let page = 1;
    let hasMore = true;

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
        const detailedData = await getInventoryProductsData(token, inventoryId, batch);

        for (const [id, product] of Object.entries(detailedData) as [string, any][]) {
          const productId = Number(id);

          // Calculate main price (first price found)
          const priceValues = Object.values(product.prices || {}) as number[];
          const mainPrice = priceValues.length > 0 ? priceValues[0] : 0;

          // Calculate total stock
          const stockValues = Object.values(product.stock || {}) as number[];
          const totalStock = stockValues.reduce((sum: number, v: number) => sum + (v || 0), 0);

          const indexed: IndexedProduct = {
            id: productId,
            name: product.text_fields?.name || "",
            ean: product.ean || "",
            sku: product.sku || "",
            tags: product.tags || [],
            categoryId: product.category_id || 0,
            manufacturerId: product.manufacturer_id || 0,
            weight: product.weight || 0,
            height: product.height || 0,
            width: product.width || 0,
            length: product.length || 0,
            prices: product.prices || {},
            stock: product.stock || {},
            mainPrice,
            totalStock,
            images: product.images || {},
            description: product.text_fields?.description || "",
          };

          index.products.set(productId, indexed);

          // Index tags
          for (const tag of indexed.tags) {
            index.allTags.add(tag);
            if (!index.tagToProducts.has(tag)) {
              index.tagToProducts.set(tag, new Set());
            }
            index.tagToProducts.get(tag)!.add(productId);
          }

          // Index category
          if (indexed.categoryId) {
            index.allCategoryIds.add(indexed.categoryId);
            if (!index.categoryToProducts.has(indexed.categoryId)) {
              index.categoryToProducts.set(indexed.categoryId, new Set());
            }
            index.categoryToProducts.get(indexed.categoryId)!.add(productId);
          }

          // Index manufacturer
          if (indexed.manufacturerId) {
            index.allManufacturerIds.add(indexed.manufacturerId);
            if (!index.manufacturerToProducts.has(indexed.manufacturerId)) {
              index.manufacturerToProducts.set(indexed.manufacturerId, new Set());
            }
            index.manufacturerToProducts.get(indexed.manufacturerId)!.add(productId);
          }
        }

        index.totalScanned += batch.length;
        progress.productsScanned = index.totalScanned;
        progress.productsIndexed = index.products.size;
        progress.uniqueTags = index.allTags.size;
      }

      progress.currentPage = page;
      if (productIds.length >= 1000) {
        progress.totalEstimatedPages = Math.max(progress.totalEstimatedPages, page + 1);
      }

      // Save partial index for immediate use
      productIndexCache.set(key, { ...index, isComplete: false });
      scanProgressCache.set(key, { ...progress });
      onProgress?.({ ...progress });

      hasMore = productIds.length >= 1000;
      page++;
    }

    index.totalPages = page - 1;
    index.isComplete = !activeScanAbort.get(key);
    index.lastUpdated = Date.now();

    progress.isComplete = index.isComplete;
    progress.isScanning = false;
    progress.totalEstimatedPages = index.totalPages;

    productIndexCache.set(key, index);
    scanProgressCache.set(key, progress);
    onProgress?.(progress);

    console.log(`[ProductIndex] Scan complete: ${index.totalScanned} products indexed, ${index.allTags.size} unique tags`);
  } catch (error) {
    progress.isScanning = false;
    scanProgressCache.set(key, progress);
    console.error("[ProductIndex] Scan error:", error);
    throw error;
  }
}

export function stopTagIndexScan(token: string, inventoryId: number) {
  const key = getCacheKey(token, inventoryId);
  activeScanAbort.set(key, true);
}

/**
 * Filter products from the index using multiple criteria.
 * All filters are AND-combined.
 */
export function filterProductsFromIndex(
  token: string,
  inventoryId: number,
  filters: ProductFilters,
  page: number = 1,
  pageSize: number = 50
): {
  products: IndexedProduct[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  indexComplete: boolean;
  scanProgress: ScanProgress;
} {
  const key = getCacheKey(token, inventoryId);
  const index = productIndexCache.get(key);
  const scanProgress = getTagScanProgress(token, inventoryId);

  if (!index || index.products.size === 0) {
    return { products: [], total: 0, page: 1, totalPages: 0, hasMore: false, indexComplete: false, scanProgress };
  }

  // Start with all product IDs or narrow by tag/category/manufacturer first
  let candidateArr: number[] | null = null;

  // Tag filter (single tag - backward compat)
  if (filters.tagName) {
    const tagSet = index.tagToProducts.get(filters.tagName);
    candidateArr = tagSet ? Array.from(tagSet) : [];
  }

  // Multiple tags filter (AND - product must have ALL tags)
  if (filters.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      const tagSet = index.tagToProducts.get(tag);
      if (!tagSet) {
        candidateArr = [];
        break;
      }
      if (candidateArr === null) {
        candidateArr = Array.from(tagSet);
      } else {
        // Intersection
        candidateArr = candidateArr.filter(id => tagSet.has(id));
      }
    }
  }

  // Category filter
  if (filters.categoryId) {
    const catSet = index.categoryToProducts.get(filters.categoryId);
    if (!catSet) {
      candidateArr = [];
    } else if (candidateArr === null) {
      candidateArr = Array.from(catSet);
    } else {
      candidateArr = candidateArr.filter(id => catSet.has(id));
    }
  }

  // Manufacturer filter
  if (filters.manufacturerId) {
    const manSet = index.manufacturerToProducts.get(filters.manufacturerId);
    if (!manSet) {
      candidateArr = [];
    } else if (candidateArr === null) {
      candidateArr = Array.from(manSet);
    } else {
      candidateArr = candidateArr.filter(id => manSet.has(id));
    }
  }

  // If no index-based filters, start with all products
  if (candidateArr === null) {
    candidateArr = Array.from(index.products.keys());
  }

  // Apply remaining filters by iterating candidates
  const results: IndexedProduct[] = [];
  for (const id of candidateArr) {
    const product = index.products.get(id);
    if (!product) continue;

    // Name search (case insensitive)
    if (filters.searchName) {
      const search = filters.searchName.toLowerCase();
      if (!product.name.toLowerCase().includes(search)) continue;
    }

    // EAN search
    if (filters.searchEan) {
      if (!product.ean.includes(filters.searchEan)) continue;
    }

    // SKU search
    if (filters.searchSku) {
      if (!product.sku.toLowerCase().includes(filters.searchSku.toLowerCase())) continue;
    }

    // Price range
    if (filters.priceMin !== undefined && product.mainPrice < filters.priceMin) continue;
    if (filters.priceMax !== undefined && product.mainPrice > filters.priceMax) continue;

    // Stock range
    if (filters.stockMin !== undefined && product.totalStock < filters.stockMin) continue;
    if (filters.stockMax !== undefined && product.totalStock > filters.stockMax) continue;

    // Weight range
    if (filters.weightMin !== undefined && product.weight < filters.weightMin) continue;
    if (filters.weightMax !== undefined && product.weight > filters.weightMax) continue;

    results.push(product);
  }

  // Sort by ID descending (newest first)
  results.sort((a, b) => b.id - a.id);

  const total = results.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const pageProducts = results.slice(start, start + pageSize);

  return {
    products: pageProducts,
    total,
    page,
    totalPages,
    hasMore: page < totalPages,
    indexComplete: index.isComplete,
    scanProgress,
  };
}

/** Get index statistics */
export function getIndexStats(token: string, inventoryId: number) {
  const key = getCacheKey(token, inventoryId);
  const index = productIndexCache.get(key);
  if (!index) return null;

  const tagStats = Array.from(index.tagToProducts.entries()).map(([tag, ids]) => ({
    tag,
    count: ids.size,
  })).sort((a, b) => b.count - a.count);

  return {
    totalProducts: index.products.size,
    uniqueTags: index.allTags.size,
    uniqueCategories: index.allCategoryIds.size,
    uniqueManufacturers: index.allManufacturerIds.size,
    isComplete: index.isComplete,
    lastUpdated: index.lastUpdated,
    tagStats,
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
  const result = filterProductsFromIndex(token, inventoryId, { tagName }, page, pageSize);
  // Convert IndexedProduct[] to Record format for backward compat
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
    indexComplete: result.indexComplete,
    scanProgress: result.scanProgress,
  };
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
