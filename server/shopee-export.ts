/**
 * Shopee Mass Upload Spreadsheet Generator
 * 
 * Generates an Excel file in the exact format required by Shopee's
 * mass upload tool, pre-filled with product data from BaseLinker.
 * 
 * Template structure (Modelo sheet):
 * - Row 1: Internal keys (ps_category|0|0, ps_product_name|1|0, etc.)
 * - Row 2: Metadata
 * - Row 3: Column headers (Portuguese)
 * - Row 4: Required/Optional indicators
 * - Row 5: Instructions/descriptions
 * - Row 6: Empty separator
 * - Row 7+: Product data
 */

import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { storagePut } from "./storage";

// Column mapping: column index -> field name
const COLUMNS = {
  CATEGORY: 1,           // Categoria
  PRODUCT_NAME: 2,       // Nome do Produto
  DESCRIPTION: 3,        // Descrição do Produto
  SKU_PARENT: 4,         // SKU Principal
  VARIATION_INTEGRATION: 5, // SKU Pai (variation integration no)
  VARIATION_TYPE_1: 6,   // Nome da variação 1
  VARIATION_1: 7,        // Variação 1
  VARIATION_IMAGE_1: 8,  // Imagem da variação 1
  VARIATION_TYPE_2: 9,   // Nome da variação 2
  VARIATION_2: 10,       // Variação 2
  PRICE: 11,             // Preço
  STOCK: 12,             // Estoque
  SKU_REF: 13,           // SKU Ref
  SIZE_CHART_TEMPLATE: 14, // Template da Tabela de Medidas
  SIZE_CHART_IMAGE: 15,  // Imagem de Tamanhos
  GTIN: 16,              // GTIN (EAN)
  COMPATIBILITY_IDS: 17, // IDs de compatibilidade
  COVER_IMAGE: 18,       // Imagem de capa
  IMAGE_1: 19,           // Imagem do produto 1
  IMAGE_2: 20,           // Imagem do produto 2
  IMAGE_3: 21,           // Imagem do produto 3
  IMAGE_4: 22,           // Imagem do produto 4
  IMAGE_5: 23,           // Imagem do produto 5
  IMAGE_6: 24,           // Imagem do produto 6
  IMAGE_7: 25,           // Imagem do produto 7
  IMAGE_8: 26,           // Imagem do produto 8
  WEIGHT: 27,            // Peso (kg)
  LENGTH: 28,            // Comprimento (cm)
  WIDTH: 29,             // Largura (cm)
  HEIGHT: 30,            // Altura (cm)
  DIRECT_DELIVERY: 31,   // Entrega Direta
  BUYER_PICKUP: 32,      // Retirada pelo Comprador
  SHOPEE_XPRESS: 33,     // Shopee Xpress
  SHIPPING_TIME: 34,     // Prazo de Postagem para Encomenda
  NCM: 35,               // NCM
} as const;

export interface ProductForShopee {
  id: number;
  name: string;
  description: string;
  sku: string;
  ean: string;
  price: number;
  stock: number;
  weight: number; // in kg
  imageUrl: string;
  images?: string[]; // additional images
  category?: string;
  brand?: string;
  length?: number;
  width?: number;
  height?: number;
}

export interface ShopeeExportOptions {
  /** Category ID to use for all products (Shopee category) */
  categoryId?: string;
  /** Whether to create kit variations (Kit 2, Kit 3, Kit 4) */
  createKitVariations?: boolean;
  /** Kit quantities to create (default: [2, 3, 4]) */
  kitQuantities?: number[];
  /** Discount percentage per kit level (e.g., Kit 2 = 5% off, Kit 3 = 10% off) */
  kitDiscountPercent?: number[];
  /** Default shipping channels */
  enableDirectDelivery?: boolean;
  enableBuyerPickup?: boolean;
  enableShopeeXpress?: boolean;
  /** Default NCM code */
  defaultNcm?: string;
}

/**
 * Generate a Shopee mass upload spreadsheet from product data.
 * Uses the original Shopee template as base and fills in product data.
 */
export async function generateShopeeSpreadsheet(
  products: ProductForShopee[],
  options: ShopeeExportOptions = {}
): Promise<{ buffer: Buffer; filename: string }> {
  const {
    categoryId,
    createKitVariations = false,
    kitQuantities = [2, 3, 4],
    kitDiscountPercent = [5, 10, 15],
    enableDirectDelivery = false,
    enableBuyerPickup = false,
    enableShopeeXpress = true,
    defaultNcm,
  } = options;

  // Try to load the template file
  const templatePath = path.join(process.cwd(), "shopee_template.xlsx");
  const altTemplatePath = "/home/ubuntu/webdev-static-assets/shopee_template.xlsx";
  
  let workbook: ExcelJS.Workbook;
  let useTemplate = false;

  workbook = new ExcelJS.Workbook();
  
  // Try to load from template
  const templateFile = fs.existsSync(templatePath) ? templatePath : 
                       fs.existsSync(altTemplatePath) ? altTemplatePath : null;
  
  if (templateFile) {
    try {
      await workbook.xlsx.readFile(templateFile);
      useTemplate = true;
      console.log("[ShopeeExport] Loaded template from:", templateFile);
    } catch (e) {
      console.warn("[ShopeeExport] Failed to load template, creating from scratch:", e);
      useTemplate = false;
    }
  }

  let ws: ExcelJS.Worksheet;

  if (useTemplate) {
    // Use the "Modelo" sheet from the template
    ws = workbook.getWorksheet("Modelo") || workbook.worksheets[1];
    if (!ws) {
      throw new Error("Template sheet 'Modelo' not found");
    }
  } else {
    // Create from scratch with proper headers
    ws = workbook.addWorksheet("Modelo");
    createHeaders(ws);
  }

  // Fill product data starting at row 7
  let currentRow = 7;

  for (const product of products) {
    if (createKitVariations) {
      // Create parent row + variation rows
      const parentSku = product.sku || `PROD-${product.id}`;
      
      // Row for unit (1 un)
      fillProductRow(ws, currentRow, product, {
        categoryId,
        sku: parentSku,
        parentSku: parentSku,
        variationType1: "Quantidade",
        variation1: "1 Unidade",
        enableDirectDelivery,
        enableBuyerPickup,
        enableShopeeXpress,
        defaultNcm,
      });
      currentRow++;

      // Rows for kit variations
      for (let i = 0; i < kitQuantities.length; i++) {
        const qty = kitQuantities[i];
        const discount = kitDiscountPercent[i] || 0;
        const kitPrice = Math.round(product.price * qty * (1 - discount / 100) * 100) / 100;
        const kitStock = Math.floor(product.stock / qty);
        const kitSku = `${parentSku}VIRT-KIT${qty}`;

        fillProductRow(ws, currentRow, {
          ...product,
          price: kitPrice,
          stock: kitStock,
          weight: product.weight * qty,
        }, {
          categoryId,
          sku: kitSku,
          parentSku: parentSku,
          variationType1: "Quantidade",
          variation1: `Kit ${qty} Unidades`,
          enableDirectDelivery,
          enableBuyerPickup,
          enableShopeeXpress,
          defaultNcm,
          skipImages: true, // Images come from parent
        });
        currentRow++;
      }
    } else {
      // Simple product without variations
      fillProductRow(ws, currentRow, product, {
        categoryId,
        sku: product.sku || `PROD-${product.id}`,
        enableDirectDelivery,
        enableBuyerPickup,
        enableShopeeXpress,
        defaultNcm,
      });
      currentRow++;
    }
  }

  // Generate buffer
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `Shopee_mass_upload_${timestamp}_${products.length}produtos.xlsx`;

  return { buffer, filename };
}

/**
 * Generate spreadsheet and upload to S3, returning a download URL
 */
export async function generateAndUploadShopeeSpreadsheet(
  products: ProductForShopee[],
  options: ShopeeExportOptions = {}
): Promise<{ url: string; filename: string; productCount: number; rowCount: number }> {
  const { buffer, filename } = await generateShopeeSpreadsheet(products, options);
  
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const fileKey = `shopee-exports/${filename.replace('.xlsx', '')}-${randomSuffix}.xlsx`;
  
  const { url } = await storagePut(
    fileKey,
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  const rowCount = options.createKitVariations 
    ? products.length * (1 + (options.kitQuantities?.length || 3))
    : products.length;

  return { url, filename, productCount: products.length, rowCount };
}

// ============ HELPERS ============

interface FillOptions {
  categoryId?: string;
  sku?: string;
  parentSku?: string;
  variationType1?: string;
  variation1?: string;
  variationType2?: string;
  variation2?: string;
  enableDirectDelivery?: boolean;
  enableBuyerPickup?: boolean;
  enableShopeeXpress?: boolean;
  defaultNcm?: string;
  skipImages?: boolean;
}

function fillProductRow(
  ws: ExcelJS.Worksheet,
  rowNum: number,
  product: ProductForShopee,
  opts: FillOptions
) {
  const row = ws.getRow(rowNum);

  // Category
  if (opts.categoryId) {
    row.getCell(COLUMNS.CATEGORY).value = opts.categoryId;
  }

  // Product name (max 120 chars for Shopee)
  const productName = product.name.substring(0, 120);
  row.getCell(COLUMNS.PRODUCT_NAME).value = productName;

  // Description (max 3000 chars)
  const description = (product.description || "")
    .replace(/<[^>]*>/g, "") // Strip HTML tags
    .substring(0, 3000);
  row.getCell(COLUMNS.DESCRIPTION).value = description;

  // SKU
  if (opts.sku) {
    row.getCell(COLUMNS.SKU_PARENT).value = opts.sku;
  }

  // Parent SKU (for variations)
  if (opts.parentSku) {
    row.getCell(COLUMNS.VARIATION_INTEGRATION).value = opts.parentSku;
  }

  // Variation type 1
  if (opts.variationType1) {
    row.getCell(COLUMNS.VARIATION_TYPE_1).value = opts.variationType1;
  }

  // Variation 1 value
  if (opts.variation1) {
    row.getCell(COLUMNS.VARIATION_1).value = opts.variation1;
  }

  // Price
  row.getCell(COLUMNS.PRICE).value = product.price;

  // Stock
  row.getCell(COLUMNS.STOCK).value = product.stock;

  // SKU Ref
  if (opts.sku) {
    row.getCell(COLUMNS.SKU_REF).value = opts.sku;
  }

  // GTIN/EAN
  if (product.ean) {
    row.getCell(COLUMNS.GTIN).value = product.ean;
  }

  // Images (only for parent/non-variation rows)
  if (!opts.skipImages) {
    if (product.imageUrl) {
      row.getCell(COLUMNS.COVER_IMAGE).value = product.imageUrl;
    }
    
    const allImages = product.images || [];
    // Fill up to 8 additional image slots
    for (let i = 0; i < Math.min(allImages.length, 8); i++) {
      row.getCell(COLUMNS.IMAGE_1 + i).value = allImages[i];
    }
  }

  // Weight (in kg, Shopee accepts decimal)
  if (product.weight > 0) {
    row.getCell(COLUMNS.WEIGHT).value = product.weight;
  }

  // Dimensions
  if (product.length) {
    row.getCell(COLUMNS.LENGTH).value = product.length;
  }
  if (product.width) {
    row.getCell(COLUMNS.WIDTH).value = product.width;
  }
  if (product.height) {
    row.getCell(COLUMNS.HEIGHT).value = product.height;
  }

  // Shipping channels
  row.getCell(COLUMNS.DIRECT_DELIVERY).value = opts.enableDirectDelivery ? "Ativar" : "Off";
  row.getCell(COLUMNS.BUYER_PICKUP).value = opts.enableBuyerPickup ? "Ativar" : "Off";
  row.getCell(COLUMNS.SHOPEE_XPRESS).value = opts.enableShopeeXpress ? "Ativar" : "Off";

  // NCM
  if (opts.defaultNcm) {
    row.getCell(COLUMNS.NCM).value = opts.defaultNcm;
  }

  row.commit();
}

function createHeaders(ws: ExcelJS.Worksheet) {
  // Row 1: Internal keys
  const internalKeys = [
    "ps_category|0|0", "ps_product_name|1|0", "ps_product_description|1|0",
    "ps_sku_parent_short|0|0", "et_title_variation_integration_no|0|0",
    "et_title_variation_1|0|0", "et_title_option_for_variation_1|0|0",
    "et_title_image_per_variation|0|3", "et_title_variation_2|0|0",
    "et_title_option_for_variation_2|0|0", "ps_price|1|1", "ps_stock|0|1",
    "ps_sku_short|0|0", "ps_new_size_chart|0|1", "et_title_size_chart|0|3",
    "ps_gtin_code|0|0", "sl_tool_mass_upload_compatibility_title|0|0",
    "ps_item_cover_image|0|3", "ps_item_image_1|0|3", "ps_item_image_2|0|3",
    "ps_item_image_3|0|3", "ps_item_image_4|0|3", "ps_item_image_5|0|3",
    "ps_item_image_6|0|3", "ps_item_image_7|0|3", "ps_item_image_8|0|3",
    "ps_weight|1|1", "ps_length|0|1", "ps_width|0|1", "ps_height|0|1",
    "channel_id.90022|0|0", "channel_id.90024|0|0", "channel_id.91003|0|0",
    "ps_product_pre_order_dts|0|1", "ps_invoice_ncm|0|0",
  ];
  const row1 = ws.getRow(1);
  internalKeys.forEach((key, i) => { row1.getCell(i + 1).value = key; });
  row1.commit();

  // Row 2: Metadata
  const row2 = ws.getRow(2);
  row2.getCell(1).value = "basic";
  row2.commit();

  // Row 3: Headers
  const headers = [
    "Categoria", "Nome do Produto", "Descrição do Produto", "SKU Principal",
    "SKU Pai", "Nome da variação 1", "Variação 1", "Imagem da variação 1",
    "Nome da variação 2", "Variação 2", "Preço", "Estoque", "SKU Ref",
    "Template da Tabela de Medidas", "Imagem de Tamanhos", "GTIN (EAN)",
    "IDs de compatibilidade", "Imagem de capa", "Imagem do produto 1",
    "Imagem do produto 2", "Imagem do produto 3", "Imagem do produto 4",
    "Imagem do produto 5", "Imagem do produto 6", "Imagem do produto 7",
    "Imagem do produto 8", "Peso", "Comprimento", "Largura", "Altura",
    "Entrega Direta", "Retirada pelo Comprador", "Shopee Xpress",
    "Prazo de Postagem para Encomenda", "NCM",
  ];
  const row3 = ws.getRow(3);
  headers.forEach((h, i) => { row3.getCell(i + 1).value = h; });
  row3.commit();

  // Row 4: Required/Optional
  const required = [
    "Opcional", "Obrigatório", "Obrigatório", "Opcional",
    "Condicional obrigatório", "Condicional obrigatório", "Condicional obrigatório",
    "Condicional obrigatório", "Condicional obrigatório", "Condicional obrigatório",
    "Obrigatório", "Condicional obrigatório", "Opcional",
    "Condicional obrigatório", "Condicional obrigatório", "Opcional",
    "Opcional", "Opcional", "Opcional", "Opcional", "Opcional", "Opcional",
    "Opcional", "Opcional", "Opcional", "Opcional",
    "Obrigatório", "Condicional obrigatório", "Condicional obrigatório",
    "Condicional obrigatório", "Condicional obrigatório", "Condicional obrigatório",
    "Condicional obrigatório", "Opcional", "Condicional obrigatório",
  ];
  const row4 = ws.getRow(4);
  required.forEach((r, i) => { row4.getCell(i + 1).value = r; });
  row4.commit();
}

/**
 * Convert BaseLinker cached product to Shopee export format
 */
export function convertCachedProductToShopee(product: {
  id: number;
  name: string;
  description?: string;
  sku?: string;
  ean?: string;
  mainPrice?: number;
  totalStock?: number;
  weight?: number;
  imageUrl?: string;
  images?: string[];
  category?: string;
  brand?: string;
}): ProductForShopee {
  return {
    id: product.id,
    name: product.name || "",
    description: product.description || "",
    sku: product.sku || "",
    ean: product.ean || "",
    price: product.mainPrice || 0,
    stock: product.totalStock || 0,
    weight: product.weight || 0,
    imageUrl: product.imageUrl || "",
    images: product.images || [],
    category: product.category,
    brand: product.brand,
  };
}
