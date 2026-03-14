/**
 * BaseLinker API Integration Module
 * Handles all communication with the BaseLinker API
 * API Docs: https://api.baselinker.com/
 */

const BASELINKER_API_URL = "https://api.baselinker.com/connector.php";
const RATE_LIMIT_DELAY = 650; // ~100 requests per minute

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
 * Get product list - paginated
 * NOTE: BaseLinker API getInventoryProductsList does NOT support filter_tag_id.
 * Available filters: filter_id, filter_category_id, filter_ean, filter_sku, filter_name,
 * filter_price_from, filter_price_to, filter_stock_from, filter_stock_to, filter_sort
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

  if (options.filterCategoryId) {
    params.filter_category_id = options.filterCategoryId;
  }
  if (options.filterName) {
    params.filter_name = options.filterName;
  }
  if (options.page) {
    params.page = options.page;
  }

  const data = await rateLimitedRequest(token, "getInventoryProductsList", params);
  return {
    products: data.products || {},
    total: Object.keys(data.products || {}).length,
  };
}

/** Get detailed product data for specific product IDs */
export async function getInventoryProductsData(token: string, inventoryId: number, productIds: number[]) {
  const data = await rateLimitedRequest(token, "getInventoryProductsData", {
    inventory_id: inventoryId,
    products: productIds,
  });
  return data.products || {};
}

/**
 * Get products filtered by tag name.
 * Since BaseLinker API doesn't support tag filtering in getInventoryProductsList,
 * we need to:
 * 1. Get all product IDs from the list
 * 2. Get detailed data in batches (which includes tags)
 * 3. Filter by tag name server-side
 */
export async function getProductsByTag(
  token: string,
  inventoryId: number,
  tagName: string,
  page: number = 1
): Promise<{ products: Record<string, any>; total: number; hasMore: boolean }> {
  // Step 1: Get product IDs from the list (1000 per page)
  const listResult = await getInventoryProductsList(token, inventoryId, { page });
  const productIds = Object.keys(listResult.products).map(Number);

  if (productIds.length === 0) {
    return { products: {}, total: 0, hasMore: false };
  }

  // Step 2: Get detailed data in batches of 100 (API limit)
  const BATCH_SIZE = 100;
  const filteredProducts: Record<string, any> = {};

  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    const batch = productIds.slice(i, i + BATCH_SIZE);
    const detailedData = await getInventoryProductsData(token, inventoryId, batch);

    // Step 3: Filter by tag name
    for (const [id, product] of Object.entries(detailedData) as [string, any][]) {
      const productTags: string[] = product.tags || [];
      if (productTags.some((t: string) => t.toLowerCase() === tagName.toLowerCase())) {
        // Merge basic list data with the tag match info
        filteredProducts[id] = {
          ...listResult.products[id],
          id: Number(id),
          tags: productTags,
          name: product.text_fields?.name || product.text_fields?.["name"] || listResult.products[id]?.name || "",
          description: product.text_fields?.description || "",
          features: product.features || {},
        };
      }
    }
  }

  return {
    products: filteredProducts,
    total: Object.keys(filteredProducts).length,
    hasMore: productIds.length >= 1000, // BaseLinker returns 1000 per page
  };
}

/**
 * Get ALL products with a specific tag across all pages.
 * Iterates through all pages until no more products are found.
 */
export async function getAllProductsByTag(
  token: string,
  inventoryId: number,
  tagName: string,
  maxPages: number = 100
): Promise<Record<string, any>> {
  let allProducts: Record<string, any> = {};
  let page = 1;

  while (page <= maxPages) {
    const result = await getProductsByTag(token, inventoryId, tagName, page);

    if (Object.keys(result.products).length === 0 && !result.hasMore) break;

    allProducts = { ...allProducts, ...result.products };

    if (!result.hasMore) break;
    page++;
  }

  return allProducts;
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

/** Get available text field keys for integration overrides */
export async function getInventoryAvailableTextFieldKeys(token: string, inventoryId: number) {
  const data = await rateLimitedRequest(token, "getInventoryAvailableTextFieldKeys", {
    inventory_id: inventoryId,
  });
  return data.text_field_keys || [];
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
