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

/** Get product list with optional tag filter - paginated */
export async function getInventoryProductsList(
  token: string,
  inventoryId: number,
  options: {
    filterTagId?: number;
    filterCategoryId?: number;
    page?: number;
  } = {}
) {
  const params: Record<string, unknown> = {
    inventory_id: inventoryId,
  };

  if (options.filterTagId) {
    params.filter_tag_id = options.filterTagId;
  }
  if (options.filterCategoryId) {
    params.filter_category_id = options.filterCategoryId;
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

/** Get all products with a specific tag (handles pagination) */
export async function getAllProductsByTag(
  token: string,
  inventoryId: number,
  tagId: number,
  maxPages: number = 100
): Promise<Record<string, any>> {
  let allProducts: Record<string, any> = {};
  let page = 1;

  while (page <= maxPages) {
    const result = await getInventoryProductsList(token, inventoryId, {
      filterTagId: tagId,
      page,
    });

    if (Object.keys(result.products).length === 0) break;

    allProducts = { ...allProducts, ...result.products };
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
};
