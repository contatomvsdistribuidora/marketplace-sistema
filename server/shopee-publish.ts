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
    attributeValueList: Array<{ valueId: number; originalValueName?: string }>;
  }>;
  brand?: { brandId: number; originalBrandName?: string };
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
    normal_stock: input.stock,
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
      package_length: input.dimension.packageLength,
      package_width: input.dimension.packageWidth,
      package_height: input.dimension.packageHeight,
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
  const body = {
    item_id: itemId,
    tier_variation: [
      {
        name: variation.name,
        option_list: variation.options.map((opt) => ({ option: opt })),
      },
    ],
    model: variation.models.map((m) => ({
      tier_index: m.tierIndex,
      normal_stock: m.stock,
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
    attributeValueList: Array<{ valueId: number; originalValueName?: string }>;
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
  }>;
  baseSku?: string;
  logisticIds?: number[];
  attributes?: Array<{
    attributeId: number;
    attributeValueList: Array<{ valueId: number; originalValueName?: string }>;
  }>;
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
 * Publish a product created via the ShopeeCriador wizard.
 * Handles image upload, product creation, and tier variation setup with
 * correct labels, prices, stocks, and SKUs derived from the wizard input.
 */
export async function publishProductFromWizard(
  accessToken: string,
  shopId: number,
  input: WizardPublishInput,
  onProgress?: (step: string) => void
): Promise<{ itemId: number; itemUrl: string; imagesUploaded: number }> {
  // Step 1: Upload images
  if (onProgress) onProgress("Enviando imagens...");
  const imageIds = await uploadImages(accessToken, shopId, input.imageUrls);
  if (imageIds.length === 0) {
    throw new Error("Falha ao enviar imagens para a Shopee. Verifique se as URLs estão acessíveis.");
  }

  const firstVar = input.variations[0];
  const baseSku = input.baseSku ?? "";

  // Step 2: Create product using first variation's physical attributes as base
  if (onProgress) onProgress("Criando produto...");
  const { itemId } = await createProduct(accessToken, shopId, {
    itemName: input.title.substring(0, 120),
    description: input.description.substring(0, 5000),
    categoryId: input.categoryId,
    price: firstVar.price,
    stock: input.variations.length === 1 ? firstVar.stock : 0,
    weight: firstVar.weight,
    imageIds,
    sku: baseSku || undefined,
    condition: "NEW",
    dimension: firstVar.length && firstVar.width && firstVar.height
      ? { packageLength: firstVar.length, packageWidth: firstVar.width, packageHeight: firstVar.height }
      : undefined,
    logisticIds: input.logisticIds,
    attributes: input.attributes,
  });

  // Step 3: Add tier variations when there are multiple options
  if (input.variations.length > 1) {
    if (onProgress) onProgress(`Adicionando ${input.variations.length} variações...`);
    await initTierVariation(accessToken, shopId, itemId, {
      name: input.variationTypeName,
      options: input.variations.map((v) => v.label),
      models: input.variations.map((v, i) => ({
        tierIndex: [i],
        price: v.price,
        stock: v.stock,
        sku: baseSku ? `${baseSku}-${i + 1}` : undefined,
      })),
    });
  }

  const itemUrl = `https://shopee.com.br/product/${shopId}/${itemId}`;
  return { itemId, itemUrl, imagesUploaded: imageIds.length };
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
