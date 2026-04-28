/**
 * Shopee Product Publishing Module
 * Handles direct product creation on Shopee via API:
 * - Image upload to Shopee media space
 * - Category listing and attribute fetching
 * - Product creation with variations (kits)
 * - Logistics channel configuration
 */

import crypto from "crypto";
import { ENV } from "./_core/env";
import { getItemBaseInfo, getModelList } from "./shopee";

const SHOPEE_API_BASE = "https://partner.shopeemobile.com";

// ============ SIGNATURE & REQUEST HELPERS ============

function generateSign(
  path: string,
  timestamp: number,
  accessToken?: string,
  shopId?: number
): string {
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  let baseString = `${partnerId}${path}${timestamp}`;
  if (accessToken) baseString += accessToken;
  if (shopId !== undefined) baseString += shopId;
  return crypto
    .createHmac("sha256", ENV.shopeePartnerKey)
    .update(baseString)
    .digest("hex");
}

function buildUrl(
  path: string,
  params: Record<string, string | number> = {},
  accessToken?: string,
  shopId?: number
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const sign = generateSign(path, timestamp, accessToken, shopId);

  const urlParams = new URLSearchParams({
    partner_id: partnerId.toString(),
    timestamp: timestamp.toString(),
    sign,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, v.toString()])
    ),
  });

  if (accessToken) urlParams.set("access_token", accessToken);
  if (shopId !== undefined) urlParams.set("shop_id", shopId.toString());

  return `${SHOPEE_API_BASE}${path}?${urlParams.toString()}`;
}

async function shopeeGet(
  path: string,
  params: Record<string, string | number>,
  accessToken: string,
  shopId: number
) {
  const url = buildUrl(path, params, accessToken, shopId);
  const res = await fetch(url);
  const data = await res.json();
  if (data.error && data.error !== "") {
    throw new Error(`Shopee API [${path}]: ${data.error} - ${data.message || ""}`);
  }
  return data.response;
}

async function shopeePost(
  path: string,
  body: Record<string, any>,
  accessToken: string,
  shopId: number
) {
  const url = buildUrl(path, {}, accessToken, shopId);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error && data.error !== "") {
    console.error(`[Shopee Publish] POST ${path} error:`, JSON.stringify(data));
    throw new Error(`Shopee API [${path}]: ${data.error} - ${data.message || JSON.stringify(data)}`);
  }
  return data.response;
}

// ============ CATEGORIES ============

export interface ShopeeCategory {
  category_id: number;
  parent_category_id: number;
  original_category_name: string;
  display_category_name: string;
  has_children: boolean;
}

/**
 * Get Shopee category tree. Pass parent_category_id=0 for root categories.
 */
export async function getCategories(
  accessToken: string,
  shopId: number,
  language: string = "pt-BR"
): Promise<ShopeeCategory[]> {
  const res = await shopeeGet(
    "/api/v2/product/get_category",
    { language },
    accessToken,
    shopId
  );
  return res?.category_list || [];
}

/**
 * Get attributes required/optional for a specific category.
 * Returns [] when the API is suspended or permission is denied for this shop.
 */
export async function getCategoryAttributes(
  accessToken: string,
  shopId: number,
  categoryId: number,
  language: string = "pt-BR"
): Promise<any[]> {
  if (!categoryId) return [];
  try {
    const res = await shopeeGet(
      "/api/v2/product/get_attributes",
      { category_id: categoryId, language },
      accessToken,
      shopId
    );
    return res?.attribute_list || [];
  } catch (e: any) {
    // api_suspended / no_permission / permission_denied → not a fatal error for the caller
    const isPermissionError =
      e.message?.includes("api_suspended") ||
      e.message?.includes("no_permission") ||
      e.message?.includes("permission_denied") ||
      e.message?.includes("Permission denied");
    if (isPermissionError) {
      console.warn(
        `[Shopee] getCategoryAttributes(${categoryId}): API não disponível para este parceiro — ${e.message}`
      );
    } else {
      console.error(`[Shopee] getCategoryAttributes(${categoryId}): ${e.message}`);
    }
    return [];
  }
}

/**
 * Search categories by keyword (used in the wizard's category search).
 */
export async function searchCategory(
  accessToken: string,
  shopId: number,
  keyword: string,
  language: string = "pt-BR"
): Promise<ShopeeCategory[]> {
  const res = await shopeeGet(
    "/api/v2/product/search_category",
    { keyword, language },
    accessToken,
    shopId
  );
  return res?.category_list || [];
}

// ============ CACHED CATEGORY SEARCH (tree + breadcrumbs + fuzzy) ============

export interface CategoryWithBreadcrumb {
  category_id: number;
  display_category_name: string;
  breadcrumb: string;
  has_children: boolean;
}

/**
 * Builds a breadcrumb ("Indústria > Embalagens > Descartáveis") for each
 * category in the tree by walking parent_category_id links. Only leaf-ish
 * entries (has_children=false) are typically useful for publishing, but we
 * keep everything and let the caller filter.
 */
export function buildCategoryIndex(tree: ShopeeCategory[]): CategoryWithBreadcrumb[] {
  const byId = new Map<number, ShopeeCategory>();
  for (const c of tree) byId.set(c.category_id, c);

  const breadcrumbCache = new Map<number, string>();
  const breadcrumbOf = (id: number): string => {
    const cached = breadcrumbCache.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node) return "";
    const parentId = node.parent_category_id;
    const parentCrumb = parentId && parentId !== 0 ? breadcrumbOf(parentId) : "";
    const crumb = parentCrumb
      ? `${parentCrumb} > ${node.display_category_name}`
      : node.display_category_name;
    breadcrumbCache.set(id, crumb);
    return crumb;
  };

  return tree.map((c) => ({
    category_id: c.category_id,
    display_category_name: c.display_category_name,
    breadcrumb: breadcrumbOf(c.category_id),
    has_children: c.has_children,
  }));
}

/**
 * Simple fuzzy matcher: splits query into tokens, requires every token to
 * appear (case-insensitive, accent-insensitive) somewhere in the breadcrumb.
 * Good enough for 20k-ish Shopee categories without pulling in Fuse.js.
 */
function normalizeForSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function fuzzyMatchCategories(
  index: CategoryWithBreadcrumb[],
  query: string,
  limit = 20,
): CategoryWithBreadcrumb[] {
  const tokens = normalizeForSearch(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: Array<{ entry: CategoryWithBreadcrumb; score: number }> = [];
  for (const entry of index) {
    const hay = normalizeForSearch(entry.breadcrumb);
    if (!tokens.every((t) => hay.includes(t))) continue;
    // Score: prefer leaves + shorter breadcrumb (more specific) + name match
    const nameHay = normalizeForSearch(entry.display_category_name);
    const nameHits = tokens.filter((t) => nameHay.includes(t)).length;
    const score =
      (entry.has_children ? 0 : 10) +
      nameHits * 5 -
      entry.breadcrumb.length * 0.01;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

// ============ BRAND LIST (per category) ============

export interface ShopeeBrand {
  brand_id: number;
  original_brand_name: string;
  display_brand_name?: string;
}

/**
 * Fetch the full brand list for a category. Shopee paginates this
 * endpoint (page_size max 30), so we loop until is_end or we hit a
 * cap — 300 pages (~9k brands) is plenty for any real category.
 */
export async function getBrandList(
  accessToken: string,
  shopId: number,
  categoryId: number,
  language: string = "pt-BR",
): Promise<ShopeeBrand[]> {
  const all: ShopeeBrand[] = [];
  let offset = 0;
  const pageSize = 30;
  for (let i = 0; i < 300; i++) {
    const res = await shopeeGet(
      "/api/v2/product/get_brand_list",
      {
        category_id: categoryId,
        status: 1, // 1 = approved brands only
        offset,
        page_size: pageSize,
        language,
      },
      accessToken,
      shopId,
    );
    const page: ShopeeBrand[] = res?.brand_list ?? [];
    all.push(...page);
    if (res?.is_end || page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export function fuzzyMatchBrands(
  brands: ShopeeBrand[],
  query: string,
  limit = 20,
): ShopeeBrand[] {
  const tokens = normalizeForSearch(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return brands.slice(0, limit);

  const scored: Array<{ entry: ShopeeBrand; score: number }> = [];
  for (const b of brands) {
    const displayHay = normalizeForSearch(b.display_brand_name ?? b.original_brand_name);
    const originalHay = normalizeForSearch(b.original_brand_name);
    const allHay = `${displayHay} ${originalHay}`;
    if (!tokens.every((t) => allHay.includes(t))) continue;
    // Prefer exact-prefix matches in the primary display name
    const prefixHit = displayHay.startsWith(tokens.join(" ")) ? 5 : 0;
    scored.push({ entry: b, score: prefixHit - displayHay.length * 0.01 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

// ============ LOGISTICS ============

/**
 * Get available logistics channels for the shop.
 */
export async function getLogisticsChannels(
  accessToken: string,
  shopId: number
) {
  const res = await shopeeGet(
    "/api/v2/logistics/get_channel_list",
    {},
    accessToken,
    shopId
  );
  return res?.logistics_channel_list || [];
}

// ============ IMAGE UPLOAD ============

/**
 * Upload an image to Shopee by downloading from URL first, then uploading as multipart.
 * Returns the image_id from Shopee's media space.
 */
export async function uploadImageFromUrl(
  accessToken: string,
  shopId: number,
  imageUrl: string,
  scene: "normal" | "desc" = "normal"
): Promise<string> {
  // Download image
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to download image: ${imageUrl}`);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

  // Determine content type
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";

  // Build signed URL for upload
  const path = "/api/v2/media_space/upload_image";
  const timestamp = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const sign = generateSign(path, timestamp, accessToken, shopId);

  const url = `${SHOPEE_API_BASE}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}&access_token=${accessToken}&shop_id=${shopId}`;

  // Create multipart form data
  const boundary = `----FormBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  // Add image file part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="image"; filename="product.${ext}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  ));
  parts.push(imgBuffer);
  parts.push(Buffer.from("\r\n"));

  // Add scene part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="scene"\r\n\r\n` +
    `${scene}\r\n`
  ));

  // End boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length.toString(),
    },
    body,
  });

  const data = await res.json();
  if (data.error && data.error !== "") {
    console.error("[Shopee] Image upload error:", JSON.stringify(data));
    throw new Error(`Image upload failed: ${data.error} - ${data.message || ""}`);
  }

  const imageInfo = data.response?.image_info;
  if (!imageInfo?.image_id) {
    throw new Error("Image upload returned no image_id");
  }

  return imageInfo.image_id;
}

/**
 * Upload multiple images and return their IDs.
 * Handles rate limiting (max ~10 req/s).
 */
export async function uploadImages(
  accessToken: string,
  shopId: number,
  imageUrls: string[],
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  const imageIds: string[] = [];
  const maxImages = Math.min(imageUrls.length, 9); // Shopee max 9 images per product

  for (let i = 0; i < maxImages; i++) {
    try {
      const imageId = await uploadImageFromUrl(accessToken, shopId, imageUrls[i]);
      imageIds.push(imageId);
      if (onProgress) onProgress(i + 1, maxImages);
    } catch (e) {
      console.warn(`[Shopee] Failed to upload image ${i + 1}:`, e);
      // Continue with remaining images
    }
    // Rate limit: wait 300ms between uploads
    if (i < maxImages - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return imageIds;
}

// ============ PRODUCT CREATION ============

export interface CreateProductInput {
  itemName: string;
  description: string;
  categoryId: number;
  price: number;
  stock: number;
  weight: number; // in kg
  imageIds: string[];
  sku?: string;
  condition?: "NEW" | "USED";
  dimension?: {
    packageLength: number;
    packageWidth: number;
    packageHeight: number;
  };
  logisticIds?: number[];
  attributes?: Array<{
    attributeId: number;
    attributeValueList: Array<{ valueId: number; originalValueName?: string; valueUnit?: string }>;
  }>;
  brand?: { brandId: number; originalBrandName?: string };
  /** GTIN/EAN code at the item level. Shopee does NOT support per-model
   *  GTIN in init_tier_variation, so the wizard only exposes this when the
   *  product has a single variation. 8/12/13/14 digits. */
  gtinCode?: string;
}

/**
 * Create a product on Shopee.
 * Returns the item_id of the created product.
 */
export async function createProduct(
  accessToken: string,
  shopId: number,
  input: CreateProductInput
): Promise<{ itemId: number }> {
  console.log('[SHOPEE DEBUG] Iniciando createProduct', { itemName: input.itemName, categoryId: input.categoryId, sku: input.sku });
  console.log('[SHOPEE DEBUG] brand payload:', JSON.stringify(input.brand));

  const body: Record<string, any> = {
    item_name: input.itemName.substring(0, 120), // Shopee max 120 chars
    description: input.description.substring(0, 5000), // Shopee max 5000 chars
    original_price: input.price,
    seller_stock: [{ stock: input.stock }],
    weight: input.weight,
    category_id: input.categoryId,
    image: {
      image_id_list: input.imageIds,
    },
    item_status: "NORMAL",
    condition: input.condition || "NEW",
  };

  // Dimensions
  if (input.dimension) {
    body.dimension = {
      package_length: Math.round(input.dimension.packageLength),
      package_width: Math.round(input.dimension.packageWidth),
      package_height: Math.round(input.dimension.packageHeight),
    };
  }

  // Logistics
  if (input.logisticIds && input.logisticIds.length > 0) {
    body.logistic_info = input.logisticIds.map((id) => ({
      logistic_id: id,
      enabled: true,
    }));
  }

  // Attributes
  if (input.attributes && input.attributes.length > 0) {
    body.attribute_list = input.attributes.map((a) => ({
      attribute_id: a.attributeId,
      attribute_value_list: a.attributeValueList.map((v) => ({
        value_id: v.valueId,
        ...(v.originalValueName ? { original_value_name: v.originalValueName } : {}),
        ...(v.valueUnit ? { value_unit: v.valueUnit } : {}),
      })),
    }));
  }

  // Brand — always required by Shopee; brand_id must be a number (0 = no registered brand)
  body.brand = {
    brand_id: Number(input.brand?.brandId ?? 0),
    original_brand_name: input.brand?.originalBrandName || "No Brand",
  };

  // SKU
  if (input.sku) {
    body.item_sku = input.sku;
  }

  // Item-level GTIN (EAN/UPC). Per-model GTIN is not supported by Shopee's
  // init_tier_variation, so this only makes sense for single-variation
  // products — the wizard enforces that constraint on the client side.
  if (input.gtinCode) {
    body.gtin_code = input.gtinCode;
  }

  console.log('[SHOPEE DEBUG] payload completo:', JSON.stringify(body, null, 2));
  const res = await shopeePost(
    "/api/v2/product/add_item",
    body,
    accessToken,
    shopId
  );
  console.log('[SHOPEE DEBUG] resposta da API:', JSON.stringify(res));

  return { itemId: res.item_id };
}

// ============ VARIATIONS (TIER VARIATION) ============

export interface KitVariation {
  name: string; // e.g., "Quantidade"
  options: string[]; // e.g., ["1 Unidade", "Kit 2", "Kit 3"]
  /**
   * Imagem por opção (paralelo a `options`). Se presente, len === options.length.
   * Cada string é um image_id retornado por uploadImageFromUrl. Shopee aceita
   * `image: { image_id }` dentro de cada `option_list[i]` no init_tier_variation.
   */
  optionImageIds?: string[];
  models: Array<{
    tierIndex: number[];
    price: number;
    stock: number;
    sku?: string;
  }>;
}

/**
 * Initialize tier variations for a product (e.g., Kit 1, Kit 2, Kit 3).
 * Must be called after product creation.
 */
export async function initTierVariation(
  accessToken: string,
  shopId: number,
  itemId: number,
  variation: KitVariation
): Promise<void> {
  if (
    variation.optionImageIds &&
    variation.optionImageIds.length !== variation.options.length
  ) {
    throw new Error(
      `optionImageIds length (${variation.optionImageIds.length}) mismatch with options (${variation.options.length})`
    );
  }

  const body = {
    item_id: itemId,
    tier_variation: [
      {
        name: variation.name,
        option_list: variation.options.map((opt, i) => {
          const entry: Record<string, any> = { option: opt };
          if (variation.optionImageIds && variation.optionImageIds[i]) {
            entry.image = { image_id: variation.optionImageIds[i] };
          }
          return entry;
        }),
      },
    ],
    model: variation.models.map((m) => ({
      tier_index: m.tierIndex,
      seller_stock: [{ stock: m.stock }],
      original_price: m.price,
      ...(m.sku ? { model_sku: m.sku } : {}),
    })),
  };

  await shopeePost(
    "/api/v2/product/init_tier_variation",
    body,
    accessToken,
    shopId
  );
}

// ============ UPDATE ITEM ============

export interface UpdateProductInput {
  itemId: number;
  itemName: string;
  description: string;
  weight: number;
  imageIds: string[];
  dimension?: {
    packageLength: number;
    packageWidth: number;
    packageHeight: number;
  };
  attributes?: Array<{
    attributeId: number;
    attributeValueList: Array<{ valueId: number; originalValueName?: string; valueUnit?: string }>;
  }>;
  /** Only set when the item has no variations (simple product). */
  price?: number;
  /** Only set when the item has no variations (simple product). */
  stock?: number;
  /** Omit to preserve Shopee-side configuration. */
  brand?: { brandId: number; originalBrandName?: string };
  /** Omit to preserve Shopee-side configuration. */
  logisticIds?: number[];
}

/**
 * Update an existing Shopee product via update_item.
 * Top-level fields only — for variation-level price/stock use
 * updateModelPrice / updateModelStock separately.
 */
export async function updateProduct(
  accessToken: string,
  shopId: number,
  input: UpdateProductInput
): Promise<void> {
  const body: Record<string, any> = {
    item_id: input.itemId,
    item_name: input.itemName.substring(0, 120),
    description: input.description.substring(0, 5000),
    weight: input.weight,
    image: { image_id_list: input.imageIds },
  };

  if (input.dimension) {
    body.dimension = {
      package_length: Math.round(input.dimension.packageLength),
      package_width: Math.round(input.dimension.packageWidth),
      package_height: Math.round(input.dimension.packageHeight),
    };
  }

  if (input.attributes && input.attributes.length > 0) {
    body.attribute_list = input.attributes.map((a) => ({
      attribute_id: a.attributeId,
      attribute_value_list: a.attributeValueList.map((v) => ({
        value_id: v.valueId,
        ...(v.originalValueName ? { original_value_name: v.originalValueName } : {}),
        ...(v.valueUnit ? { value_unit: v.valueUnit } : {}),
      })),
    }));
  }

  if (input.price !== undefined) {
    body.original_price = input.price;
  }
  if (input.stock !== undefined) {
    body.seller_stock = [{ stock: input.stock }];
  }
  if (input.brand) {
    body.brand = {
      brand_id: Number(input.brand.brandId ?? 0),
      original_brand_name: input.brand.originalBrandName || "No Brand",
    };
  }
  if (input.logisticIds && input.logisticIds.length > 0) {
    body.logistic_info = input.logisticIds.map((id) => ({ logistic_id: id, enabled: true }));
  }

  await shopeePost("/api/v2/product/update_item", body, accessToken, shopId);
}

/**
 * Update price per model (variation). Used when the item has variations.
 */
export async function updateModelPrice(
  accessToken: string,
  shopId: number,
  itemId: number,
  priceList: Array<{ modelId: number; price: number }>
): Promise<void> {
  await shopeePost(
    "/api/v2/product/update_price",
    {
      item_id: itemId,
      price_list: priceList.map((p) => ({ model_id: p.modelId, original_price: p.price })),
    },
    accessToken,
    shopId
  );
}

/**
 * Update stock per model (variation). Used when the item has variations.
 */
export async function updateModelStock(
  accessToken: string,
  shopId: number,
  itemId: number,
  stockList: Array<{ modelId: number; stock: number }>
): Promise<void> {
  await shopeePost(
    "/api/v2/product/update_stock",
    {
      item_id: itemId,
      stock_list: stockList.map((s) => ({
        model_id: s.modelId,
        seller_stock: [{ stock: s.stock }],
      })),
    },
    accessToken,
    shopId
  );
}

// ============ PROMOTE (simple → variated) ============

export interface PromoteInput {
  itemId: number;
  variationTypeName: string;
  variations: Array<{
    label: string;
    price: number;
    stock: number;
    sku?: string;
    /** Imagem opcional pra esta variação (image_id já uploaded). Vai pra
     *  option_list[i].image.image_id no payload init_tier_variation. */
    imageId?: string;
  }>;
}

/**
 * Promote a SIMPLE product to a VARIATED product by calling init_tier_variation.
 *
 * ⚠️ Irreversible on Shopee's side. Caller MUST confirm `has_model=false` before
 * invoking this. Races (product becomes variated between check and call) are
 * caught by Shopee itself and surfaced as PROMOTE_FAILED.
 *
 * ⚠️ The simple product's original price/stock is NOT migrated to the new models.
 * Models use the prices/stocks given in `variations`. Caller should warn user.
 */
export async function promoteSimpleToVariated(
  accessToken: string,
  shopId: number,
  input: PromoteInput
): Promise<{ modelsCreated: number }> {
  // init_tier_variation (not add_tier_variation): Shopee's API for setting
  // up the FIRST tier_variation on an item. add_tier_variation only works on
  // items that already have tier_variation — it returns error_not_found on
  // simple products. Validated against a live UNLIST product 2026-04-24.
  console.log(`[Shopee Promote] → item ${input.itemId}: creating ${input.variations.length} models via init_tier_variation`);
  console.warn(`[Shopee Promote] WARNING item ${input.itemId}: original simple-product price/stock is NOT migrated — new models use wizard values only`);

  // Defense in depth: re-check has_model right before calling init_tier_variation.
  // The wizard's pre-flight checkExistingVariation already gates the UI, but a
  // race (or a stale upstream check) could still slip through; calling the
  // endpoint when has_model=true returns a confusing "tier-variation not change"
  // error. Surface a clearer code instead.
  try {
    const [preItem] = await getItemBaseInfo(accessToken, shopId, [input.itemId]);
    const remoteHasModel = !!preItem?.has_model;
    const remoteTierCount = Array.isArray(preItem?.tier_variation)
      ? (preItem.tier_variation[0]?.option_list?.length ?? 0)
      : 0;
    if (remoteHasModel || remoteTierCount > 0) {
      console.warn(`[Shopee Promote] BLOCKED item ${input.itemId}: already has variation (has_model=${remoteHasModel}, options=${remoteTierCount}), skipping init_tier_variation`);
      throw new PublishValidationError({
        code: "PRECONDITION_FAILED",
        userMessage: "Produto já tem variação na Shopee. Use o modo edição (não disponível ainda).",
      });
    }
  } catch (e: any) {
    if (e instanceof PublishValidationError) throw e;
    // get_item_base_info itself failing isn't fatal — we proceed and let
    // init_tier_variation surface whatever error Shopee returns.
    console.warn(`[Shopee Promote] item ${input.itemId}: pre-check failed, proceeding anyway — ${e.message}`);
  }

  const body = {
    item_id: input.itemId,
    tier_variation: [
      {
        name: input.variationTypeName,
        option_list: input.variations.map((v) => {
          const entry: Record<string, any> = { option: v.label };
          if (v.imageId) entry.image = { image_id: v.imageId };
          return entry;
        }),
      },
    ],
    model: input.variations.map((v, i) => ({
      tier_index: [i],
      original_price: v.price,
      seller_stock: [{ stock: v.stock }],
      ...(v.sku ? { model_sku: v.sku } : {}),
    })),
  };

  // Diagnostic dump: Shopee's "The level of tier-variation not change" error
  // is thin — having the exact payload makes future incident triage trivial.
  console.log(`[Shopee Promote DEBUG] item ${input.itemId} payload:`, JSON.stringify(body, null, 2));

  try {
    await shopeePost("/api/v2/product/init_tier_variation", body, accessToken, shopId);
  } catch (e: any) {
    console.error(`[Shopee Promote] ✗ item ${input.itemId}: init_tier_variation failed — ${e.message}`);
    throw new PublishValidationError({
      code: "PROMOTE_FAILED",
      userMessage: `Falha ao promover produto para variações: ${e.message}`,
    });
  }

  console.log(`[Shopee Promote] ✓ item ${input.itemId}: ${input.variations.length} models created (irreversible)`);
  return { modelsCreated: input.variations.length };
}

// ============ BATCH PUBLISH ============

export interface ProductToPublish {
  name: string;
  description: string;
  sku: string;
  ean: string;
  price: number;
  stock: number;
  weight: number;
  imageUrls: string[];
  categoryId: number;
  brand?: string;
  length?: number;
  width?: number;
  height?: number;
  // Kit variations
  createKits?: boolean;
  kitQuantities?: number[];
  kitDiscounts?: number[];
  kitBaseOptionName?: string; // label for the base (qty=1) option; defaults to "1 Unidade"
  // Logistics
  logisticIds?: number[];
  // Attributes
  attributes?: Array<{
    attributeId: number;
    attributeValueList: Array<{ valueId: number; originalValueName?: string; valueUnit?: string }>;
  }>;
}

export interface WizardPublishInput {
  title: string;
  description: string;
  categoryId: number;
  imageUrls: string[];
  variationTypeName: string;
  variations: Array<{
    label: string;
    price: number;
    stock: number;
    weight: number;
    length?: number;
    width?: number;
    height?: number;
    /** Per-model SKU (Shopee `model_sku`). Overrides the auto-suffixed baseSku. */
    sku?: string;
    /** Shopee only stores GTIN at item level (`gtin_code`). When the product
     *  has exactly one variation we use this as the item-level gtin_code;
     *  otherwise it's ignored (wizard hides the field in that case). */
    ean?: string;
  }>;
  baseSku?: string;
  logisticIds?: number[];
  attributes?: Array<{
    attributeId: number;
    attributeValueList: Array<{ valueId: number; originalValueName?: string; valueUnit?: string }>;
  }>;
  /** When present, publishProductFromWizard performs an UPDATE on this item
   *  instead of creating a new listing. */
  sourceItemId?: number;
  /** Caller's explicit choice for the simple→variated ambiguous case.
   *  - "create"  : ignore sourceItemId, create a new listing
   *  - "promote" : mutate the existing simple product to have variations
   *  - undefined : ask the caller to pick — backend throws NEEDS_USER_DECISION */
  overrideMode?: "create" | "promote";
  /** When creating a brand-new listing (especially via overrideMode="create"),
   *  the user-facing name shown on Shopee. Overrides `title`. 1..120 chars
   *  (validated against NAME_INVALID). Used to avoid duplicate listings when
   *  "upgrading" a simple product to a new variated one. */
  newItemName?: string;
  /** Brand to apply on the Shopee listing. Only consumed in the CREATE path
   *  — update/promote preserves the shop-side brand configuration. brandId=0
   *  is the Shopee sentinel for "No Brand" / free-text fallback. */
  brand?: { brandId: number; brandName: string };
}

export type PublishFromWizardError =
  | { code: "CATEGORY_CHANGED"; userMessage: string }
  | { code: "VARIATION_COUNT_CHANGED"; userMessage: string }
  | { code: "VARIATION_LABEL_MISSING"; userMessage: string }
  | { code: "PROMOTE_FAILED"; userMessage: string }
  | { code: "NEEDS_USER_DECISION"; userMessage: string; availableModes: Array<"create" | "promote"> }
  | { code: "NAME_INVALID"; userMessage: string }
  | { code: "PRECONDITION_FAILED"; userMessage: string };

export class PublishValidationError extends Error {
  code: PublishFromWizardError["code"];
  userMessage: string;
  availableModes?: Array<"create" | "promote">;
  constructor(err: PublishFromWizardError) {
    super(err.userMessage);
    this.name = "PublishValidationError";
    this.code = err.code;
    this.userMessage = err.userMessage;
    if (err.code === "NEEDS_USER_DECISION") {
      this.availableModes = err.availableModes;
    }
  }
}

export interface PublishResult {
  productName: string;
  sku: string;
  success: boolean;
  itemId?: number;
  error?: string;
  imagesUploaded?: number;
  hasVariations?: boolean;
}

/**
 * Publish a single product to Shopee (upload images + create product + add variations).
 */
export async function publishProduct(
  accessToken: string,
  shopId: number,
  product: ProductToPublish,
  onProgress?: (step: string) => void
): Promise<PublishResult> {
  try {
    // Step 1: Upload images
    if (onProgress) onProgress("Enviando imagens...");
    const imageIds = await uploadImages(accessToken, shopId, product.imageUrls);
    if (imageIds.length === 0) {
      return {
        productName: product.name,
        sku: product.sku,
        success: false,
        error: "Nenhuma imagem pôde ser enviada",
      };
    }

    // Step 2: Create product
    if (onProgress) onProgress("Criando produto...");
    const { itemId } = await createProduct(accessToken, shopId, {
      itemName: product.name,
      description: product.description,
      categoryId: product.categoryId,
      price: product.price,
      stock: product.stock,
      weight: product.weight,
      imageIds,
      sku: product.sku,
      condition: "NEW",
      dimension: product.length && product.width && product.height
        ? {
            packageLength: product.length,
            packageWidth: product.width,
            packageHeight: product.height,
          }
        : undefined,
      logisticIds: product.logisticIds,
      attributes: product.attributes,
      brand: product.brand ? { brandId: 0, originalBrandName: product.brand } : undefined,
    });

    // Step 3: Add kit variations if requested
    let hasVariations = false;
    if (product.createKits && product.kitQuantities && product.kitQuantities.length > 0) {
      if (onProgress) onProgress("Criando variações de kit...");
      try {
        const baseOptionName = product.kitBaseOptionName ?? "1 Unidade";
        const options: string[] = [baseOptionName];
        const models: KitVariation["models"] = [
          { tierIndex: [0], price: product.price, stock: product.stock, sku: `${product.sku}-1UN` },
        ];

        for (let i = 0; i < product.kitQuantities.length; i++) {
          const qty = product.kitQuantities[i];
          const discount = product.kitDiscounts?.[i] || 0;
          const kitPrice = Math.round(product.price * qty * (1 - discount / 100) * 100) / 100;
          const kitStock = Math.floor(product.stock / qty);

          options.push(`Kit ${qty} Unidades`);
          models.push({
            tierIndex: [i + 1],
            price: kitPrice,
            stock: kitStock,
            sku: `${product.sku}-KIT${qty}`,
          });
        }

        await initTierVariation(accessToken, shopId, itemId, {
          name: "Quantidade",
          options,
          models,
        });
        hasVariations = true;
      } catch (e: any) {
        console.warn(`[Shopee Publish] Failed to add variations for item ${itemId}:`, e.message);
      }
    }

    return {
      productName: product.name,
      sku: product.sku,
      success: true,
      itemId,
      imagesUploaded: imageIds.length,
      hasVariations,
    };
  } catch (e: any) {
    return {
      productName: product.name,
      sku: product.sku,
      success: false,
      error: e.message || "Erro desconhecido",
    };
  }
}

/**
 * Publish a product via the ShopeeCriador wizard.
 * Branches on `input.sourceItemId`:
 *   - undefined → CREATE (add_item + optional init_tier_variation)
 *   - number    → UPDATE (validate, update_item [+ update_price / update_stock per model])
 * Updates preserve category, logistic_info, brand, and item_status — v1 only
 * touches simple fields (title, description, price, stock, dimensions, weight,
 * images, attributes). Structural changes to variations are rejected.
 */
export async function publishProductFromWizard(
  accessToken: string,
  shopId: number,
  input: WizardPublishInput,
  onProgress?: (step: string) => void
): Promise<{ itemId: number; itemUrl: string; imagesUploaded: number; mode: "create" | "update" | "promote" }> {
  const firstVar = input.variations[0];
  const baseSku = input.baseSku ?? "";

  // overrideMode="create" bypasses UPDATE entirely — caller has decided to
  // abandon the existing item_id and create a fresh listing.
  if (input.sourceItemId && input.overrideMode !== "create") {
    // ─────────────────────────── UPDATE PATH ───────────────────────────
    if (onProgress) onProgress("Lendo estado atual na Shopee...");
    const [itemInfo] = await getItemBaseInfo(accessToken, shopId, [input.sourceItemId]);
    if (!itemInfo) {
      throw new Error(`Produto ${input.sourceItemId} não foi encontrado na Shopee.`);
    }

    // Q3 — category change is blocked
    if (Number(itemInfo.category_id) !== Number(input.categoryId)) {
      throw new PublishValidationError({
        code: "CATEGORY_CHANGED",
        userMessage:
          "Mudança de categoria não é suportada no update. Para mudar a categoria, recrie o produto na Shopee.",
      });
    }

    const remoteHasModel: boolean = !!itemInfo.has_model;
    const remoteTierOptions: string[] = remoteHasModel
      ? ((itemInfo.tier_variation?.[0]?.option_list ?? []).map((o: any) => o.option) as string[])
      : [];
    // "Effectively simple" covers two shapes:
    //  - has_model=false (no variation structure at all), and
    //  - has_model=true but tier_variation empty/missing (observed on some
    //    Shopee listings — we must not treat these as variated, otherwise the
    //    count check below fires VARIATION_COUNT_CHANGED with "Shopee: 0",
    //    hiding the real ambiguous case from the user.
    const remoteIsEffectivelySimple = !remoteHasModel || remoteTierOptions.length === 0;

    const needsPromotion = remoteIsEffectivelySimple && input.variations.length > 1;

    // Ambiguous case FIRST — before count/label divergence checks. Otherwise
    // users hitting "simple on Shopee + multiple locally" get a confusing
    // VARIATION_COUNT_CHANGED instead of the decision modal that's meant for
    // exactly this scenario.
    if (needsPromotion && !input.overrideMode) {
      throw new PublishValidationError({
        code: "NEEDS_USER_DECISION",
        userMessage:
          "O produto na Shopee é simples (sem variações) e localmente você montou " +
          `${input.variations.length} variações. Escolha: criar um novo anúncio ` +
          "na Shopee (mantém o antigo) ou adicionar as variações ao produto " +
          "existente (irreversível).",
        availableModes: ["create", "promote"],
      });
    }

    // Q1 — variation structure changes on ALREADY-variated products are blocked.
    // Only gate on real variated state (not has_model flag alone) — otherwise
    // the edge case above (has_model=true, tier empty) would falsely trip here.
    if (!remoteIsEffectivelySimple) {
      if (input.variations.length !== remoteTierOptions.length) {
        throw new PublishValidationError({
          code: "VARIATION_COUNT_CHANGED",
          userMessage: `Quantidade de variações diferente da Shopee (local: ${input.variations.length}, Shopee: ${remoteTierOptions.length}). Remova o produto na Shopee e publique como novo.`,
        });
      }
      for (const v of input.variations) {
        if (!remoteTierOptions.includes(v.label)) {
          throw new PublishValidationError({
            code: "VARIATION_LABEL_MISSING",
            userMessage: `A variação "${v.label}" não existe no produto atual na Shopee. Para alterar a estrutura, remova e publique como novo.`,
          });
        }
      }
    }

    // Q4 — image reuse when URLs unchanged
    const remoteUrls: string[] = (itemInfo.image?.image_url_list ?? []) as string[];
    const remoteIds: string[] = (itemInfo.image?.image_id_list ?? []) as string[];
    const sameImages =
      input.imageUrls.length === remoteUrls.length &&
      input.imageUrls.every((u, i) => u === remoteUrls[i]);

    let imageIds: string[];
    let imagesUploaded = 0;
    if (sameImages && remoteIds.length === input.imageUrls.length) {
      imageIds = remoteIds;
    } else {
      if (onProgress) onProgress("Enviando imagens...");
      imageIds = await uploadImages(accessToken, shopId, input.imageUrls);
      imagesUploaded = imageIds.length;
      if (imageIds.length === 0) {
        throw new Error("Falha ao enviar imagens para a Shopee. Verifique se as URLs estão acessíveis.");
      }
    }

    // Promote simple → variated BEFORE update_item (so update_item sees has_model=true)
    if (needsPromotion) {
      if (onProgress) onProgress(`Promovendo para variações (${input.variations.length})...`);
      await promoteSimpleToVariated(accessToken, shopId, {
        itemId: input.sourceItemId,
        variationTypeName: input.variationTypeName,
        variations: input.variations.map((v, i) => ({
          label: v.label,
          price: v.price,
          stock: v.stock,
          sku: baseSku ? `${baseSku}-${i + 1}` : undefined,
        })),
      });
    }

    // update_item (top-level fields)
    if (onProgress) onProgress("Atualizando produto...");
    const updateInput: UpdateProductInput = {
      itemId: input.sourceItemId,
      itemName: input.title,
      description: input.description,
      weight: firstVar.weight,
      imageIds,
      dimension: firstVar.length && firstVar.width && firstVar.height
        ? { packageLength: firstVar.length, packageWidth: firstVar.width, packageHeight: firstVar.height }
        : undefined,
      attributes: input.attributes,
    };
    // Q5 — logistic_info omitted unless explicitly provided.
    //       brand kept out entirely (wizard doesn't expose it).
    // price/stock at item level only valid when the product is simple (pre and post).
    const isNowVariated = !remoteIsEffectivelySimple || needsPromotion;
    if (!isNowVariated) {
      updateInput.price = firstVar.price;
      updateInput.stock = firstVar.stock;
    }
    await updateProduct(accessToken, shopId, updateInput);

    // Per-model updates for PRE-EXISTING variated products only.
    // (When `needsPromotion`, prices/stocks were already set inside add_tier_variation.)
    if (!remoteIsEffectivelySimple) {
      if (onProgress) onProgress("Atualizando preço/estoque das variações...");
      const models = await getModelList(accessToken, shopId, input.sourceItemId);
      // Match local variation → remote model via tier_index → option label
      const labelFor = (tierIndex: number[]): string => remoteTierOptions[tierIndex[0]] ?? "";
      const modelByLabel = new Map<string, number>();
      for (const m of models) {
        const lbl = labelFor(m.tier_index);
        if (lbl) modelByLabel.set(lbl, m.model_id);
      }

      const priceList: Array<{ modelId: number; price: number }> = [];
      const stockList: Array<{ modelId: number; stock: number }> = [];
      for (const v of input.variations) {
        const modelId = modelByLabel.get(v.label);
        if (modelId == null) {
          throw new PublishValidationError({
            code: "VARIATION_LABEL_MISSING",
            userMessage: `A variação "${v.label}" não foi encontrada entre os models da Shopee. Remova e publique como novo.`,
          });
        }
        priceList.push({ modelId, price: v.price });
        stockList.push({ modelId, stock: v.stock });
      }
      await updateModelPrice(accessToken, shopId, input.sourceItemId, priceList);
      await updateModelStock(accessToken, shopId, input.sourceItemId, stockList);
    }

    const itemUrl = `https://shopee.com.br/product/${shopId}/${input.sourceItemId}`;
    return {
      itemId: input.sourceItemId,
      itemUrl,
      imagesUploaded,
      mode: needsPromotion ? "promote" : "update",
    };
  }

  // ─────────────────────────── CREATE PATH ───────────────────────────
  // newItemName: caller-provided override for the product title (used when
  // upgrading a simple listing to a new variated one — the user picks a name
  // that differs from the old listing to avoid duplicate detection).
  if (input.newItemName !== undefined) {
    const len = input.newItemName.length;
    if (len < 1 || len > 120) {
      throw new PublishValidationError({
        code: "NAME_INVALID",
        userMessage: `Nome do produto deve ter entre 1 e 120 caracteres (atual: ${len}).`,
      });
    }
  }
  const effectiveItemName = input.newItemName ?? input.title;

  // SKU suffix: when the caller is abandoning an existing item_id (overrideMode=
  // "create" with a sourceItemId), append a short base36 timestamp to keep the
  // local SKU unique vs. the old listing's SKU. Transparent to the user.
  const effectiveBaseSku =
    input.sourceItemId && input.overrideMode === "create" && baseSku
      ? `${baseSku}-V${Date.now().toString(36).slice(-4).toUpperCase()}`
      : baseSku;

  // Validate any EAN (GTIN) codes provided per variation. 8/12/13/14 digits
  // are the only sanctioned lengths (GTIN-8, UPC-A, EAN-13, GTIN-14).
  // Shopee's API will reject malformed codes anyway, but we surface a
  // friendlier error to the user here.
  for (const v of input.variations) {
    if (v.ean && !/^\d+$/.test(v.ean)) {
      throw new Error(`EAN "${v.ean}" contém caracteres não numéricos.`);
    }
    if (v.ean && ![8, 12, 13, 14].includes(v.ean.length)) {
      throw new Error(`EAN "${v.ean}" deve ter 8, 12, 13 ou 14 dígitos (tem ${v.ean.length}).`);
    }
  }
  // Only single-variation products can carry a GTIN in the Shopee model.
  const singleVariationGtin =
    input.variations.length === 1 && input.variations[0].ean
      ? input.variations[0].ean
      : undefined;

  if (onProgress) onProgress("Enviando imagens...");
  const imageIds = await uploadImages(accessToken, shopId, input.imageUrls);
  if (imageIds.length === 0) {
    throw new Error("Falha ao enviar imagens para a Shopee. Verifique se as URLs estão acessíveis.");
  }

  if (onProgress) onProgress("Criando produto...");
  const { itemId } = await createProduct(accessToken, shopId, {
    itemName: effectiveItemName.substring(0, 120),
    description: input.description.substring(0, 5000),
    categoryId: input.categoryId,
    price: firstVar.price,
    stock: input.variations.length === 1 ? firstVar.stock : 0,
    weight: firstVar.weight,
    imageIds,
    sku: effectiveBaseSku || undefined,
    condition: "NEW",
    dimension: firstVar.length && firstVar.width && firstVar.height
      ? { packageLength: firstVar.length, packageWidth: firstVar.width, packageHeight: firstVar.height }
      : undefined,
    logisticIds: input.logisticIds,
    attributes: input.attributes,
    brand: input.brand
      ? { brandId: input.brand.brandId, originalBrandName: input.brand.brandName }
      : undefined,
    gtinCode: singleVariationGtin,
  });

  if (input.variations.length > 1) {
    if (onProgress) onProgress(`Adicionando ${input.variations.length} variações...`);
    await initTierVariation(accessToken, shopId, itemId, {
      name: input.variationTypeName,
      options: input.variations.map((v) => v.label),
      models: input.variations.map((v, i) => ({
        tierIndex: [i],
        price: v.price,
        stock: v.stock,
        // Per-model SKU: caller-provided takes precedence over the auto-suffix
        // (which is derived from the item-level baseSku + index).
        sku: v.sku || (effectiveBaseSku ? `${effectiveBaseSku}-${i + 1}` : undefined),
      })),
    });
  }

  const itemUrl = `https://shopee.com.br/product/${shopId}/${itemId}`;
  return { itemId, itemUrl, imagesUploaded: imageIds.length, mode: "create" };
}

/**
 * Publish multiple products to Shopee in batch.
 * Processes sequentially to respect rate limits.
 */
export async function batchPublish(
  accessToken: string,
  shopId: number,
  products: ProductToPublish[],
  onProgress?: (current: number, total: number, result: PublishResult) => void
): Promise<PublishResult[]> {
  const results: PublishResult[] = [];

  for (let i = 0; i < products.length; i++) {
    const result = await publishProduct(accessToken, shopId, products[i]);
    results.push(result);
    if (onProgress) onProgress(i + 1, products.length, result);

    // Rate limit: wait 1s between products
    if (i < products.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return results;
}
