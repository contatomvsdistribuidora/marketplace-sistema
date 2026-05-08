import { db as sharedDb } from "./db";
import { eq, and } from "drizzle-orm";
import {
  multiProductListings, multiProductListingItems,
  productCache, shopeeProducts,
} from "../drizzle/schema";

export class PreviewPublishError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "PreviewPublishError";
  }
}

type ResolvedItem = {
  source: "baselinker" | "shopee";
  sourceId: number;
  name: string;
  sku: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  customPrice: number | null;
  customSku: string | null;
};

type WizardState = {
  version?: number;
  selectedType?: string;
  optionLabels?: string[];
  optionDetailsMatrix?: any[][];
  perRowBaseQty?: Record<string, number>;
  pricingMode?: string;
  pricing?: any;
  pricingPerProduct?: Record<string, any>;
  attributeValues?: Record<string, any>;
  priceOverrides?: Record<string, any>;
  categoryId?: number | null;
  categoryBreadcrumb?: any[];
  brandValue?: { brandId?: number; brandName?: string } | null;
  productNameOverrides?: Record<string, string>;
  computedCells?: Array<{
    productIdx: number;
    optIdx: number;
    cellKey: string;
    productSourceId: number | string;
    productSource?: string;
    optionLabel: string;
    pricing: {
      price: number;
      qty: number;
      weight: number;
      length: number;
      width: number;
      height: number;
      profitPct: number;
      marginContribution: number;
      [k: string]: any;
    };
  }>;
};

const VARIATION_TYPE_LABELS: Record<string, string> = {
  quantidade: "Quantidade",
  tamanho: "Tamanho",
  material: "Material",
  cor: "Cor",
  personalizado: "Variacao",
};

function deriveVariationName(selectedType: string | undefined | null, fallback: string = "Variacao"): string {
  if (!selectedType) return fallback;
  return VARIATION_TYPE_LABELS[selectedType] ?? fallback;
}

function safeParseWizardState(raw: string | null | undefined): WizardState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.version === 1) {
      return parsed as WizardState;
    }
    return {};
  } catch {
    return {};
  }
}

export async function previewMultiProductPublish(listingId: number, userId: number) {
  // 1. Carrega listing
  const [listing] = await sharedDb
    .select()
    .from(multiProductListings)
    .where(eq(multiProductListings.id, listingId))
    .limit(1);

  if (!listing) {
    throw new PreviewPublishError("NOT_FOUND", `Listing ${listingId} nao encontrado`);
  }
  if (listing.userId !== userId) {
    throw new PreviewPublishError("FORBIDDEN", "Nao autorizado");
  }

  // 2. Items
  const items = await sharedDb
    .select()
    .from(multiProductListingItems)
    .where(eq(multiProductListingItems.listingId, listingId));

  if (items.length < 1) {
    throw new PreviewPublishError("NO_ITEMS", "Sem items");
  }

  // 3. Resolve items (BL ou Shopee)
  const resolved: ResolvedItem[] = [];
  for (const it of items) {
    if (it.source === "baselinker") {
      const [p] = await sharedDb
        .select()
        .from(productCache)
        .where(eq(productCache.productId, it.sourceId as any))
        .limit(1);
      if (p) {
        resolved.push({
          source: "baselinker",
          sourceId: it.sourceId,
          name: p.name ?? `Produto ${it.sourceId}`,
          sku: it.customSku ?? p.sku ?? "",
          price: it.customPrice ? Number(it.customPrice) : Number(p.mainPrice ?? 0),
          stock: Number(p.totalStock ?? 0),
          imageUrl: (p as any).imageUrl ?? null,
          customPrice: it.customPrice ? Number(it.customPrice) : null,
          customSku: it.customSku ?? null,
        });
      }
    } else if (it.source === "shopee") {
      const [p] = await sharedDb
        .select()
        .from(shopeeProducts)
        .where(eq(shopeeProducts.itemId, it.sourceId))
        .limit(1);
      if (p) {
        resolved.push({
          source: "shopee",
          sourceId: it.sourceId,
          name: (p as any).itemName ?? `Item ${it.sourceId}`,
          sku: it.customSku ?? (p as any).itemSku ?? "",
          price: it.customPrice ? Number(it.customPrice) : Number((p as any).price ?? 0),
          stock: Number((p as any).stock ?? 0),
          imageUrl: (p as any).imageUrl ?? null,
          customPrice: it.customPrice ? Number(it.customPrice) : null,
          customSku: it.customSku ?? null,
        });
      }
    }
  }

  // 4. Carrega principal (so se for Shopee)
  let principal: any = null;
  if (listing.mainProductSource === "shopee" && listing.mainProductSourceId) {
    const [p] = await sharedDb
      .select()
      .from(shopeeProducts)
      .where(eq(shopeeProducts.itemId, listing.mainProductSourceId))
      .limit(1);
    principal = p ?? null;
  }

  // 5. Hidrata wizardStateJson
  const ws = safeParseWizardState(listing.wizardStateJson as string | null);

  // 6. Monta payload Shopee SIMULADO
  const categoryId = ws.categoryId ?? principal?.categoryId ?? null;
  const brand = ws.brandValue?.brandId
    ? { brand_id: ws.brandValue.brandId, original_brand_name: ws.brandValue.brandName ?? "" }
    : { brand_id: 0, original_brand_name: "No Brand" };

  // ===== Variacoes Shopee (CORRETO) =====
  // Var 1 = PRODUTOS, Var 2 = OPCOES (optionLabels)
  const tierVariations: any[] = [];

  const variation1Name = "Modelo";
  const variation1Options = resolved.map((r, idx) => {
    const productLabel = ws.productNameOverrides?.[String(idx)] ?? r.name ?? `Produto ${idx + 1}`;
    return { option: String(productLabel).slice(0, 20) };
  });
  if (variation1Options.length > 0) {
    tierVariations.push({ name: variation1Name.slice(0, 20), option_list: variation1Options });
  }

  const variation2Name = deriveVariationName(ws.selectedType);
  const variation2Options = (ws.optionLabels ?? [])
    .filter((l: string) => l && l.trim())
    .map((label: string) => ({ option: String(label).slice(0, 20) }));
  if (variation2Options.length > 0) {
    tierVariations.push({ name: variation2Name.slice(0, 20), option_list: variation2Options });
  }

  // ===== Models (combinacoes) =====
  // Cartesiano: produtos x opcoes. tier_index: [productIdx, optIdx]
  const models: any[] = [];
  const productCount = variation1Options.length || 1;
  const optionCount = variation2Options.length || 1;
  const hasVar2 = variation2Options.length > 0;

  const computedByCellKey = new Map<string, any>();
  if (Array.isArray(ws.computedCells)) {
    ws.computedCells.forEach((cell: any) => {
      computedByCellKey.set(cell.cellKey, cell);
    });
  }

  for (let productIdx = 0; productIdx < productCount; productIdx++) {
    const productForRow = resolved[productIdx];
    const overridePriceForProduct = (ws.priceOverrides as any)?.[productIdx];

    for (let optIdx = 0; optIdx < optionCount; optIdx++) {
      const cellKey = `${productIdx}-${optIdx}`;
      const computed = computedByCellKey.get(cellKey);
      const cellOpt = ws.optionDetailsMatrix?.[productIdx]?.[optIdx];

      let price: number;
      if (cellOpt?.price && Number(cellOpt.price) > 0) {
        price = Number(cellOpt.price);
      } else if (overridePriceForProduct != null && overridePriceForProduct > 0) {
        price = Number(overridePriceForProduct);
      } else if (computed?.pricing?.price && computed.pricing.price > 0) {
        price = Number(computed.pricing.price);
      } else {
        price = Number(productForRow?.price ?? 0);
      }

      const stock = cellOpt?.stock != null && cellOpt.stock !== ""
        ? Number(cellOpt.stock)
        : Number(productForRow?.stock ?? 0);

      const sku = cellOpt?.sku
        ? String(cellOpt.sku)
        : `${listing.id}-P${productIdx + 1}${hasVar2 ? `-V${optIdx + 1}` : ""}`;

      models.push({
        tier_index: hasVar2 ? [productIdx, optIdx] : [productIdx],
        original_price: price,
        seller_stock: [{ stock }],
        model_sku: sku,
        _from: computed ? "computed" : (overridePriceForProduct ? "override" : (cellOpt?.price ? "cellOpt" : "product")),
        _profitPct: computed?.pricing?.profitPct,
        _margin: computed?.pricing?.marginContribution,
      });
    }
  }

  const addItemPayload = {
    item_name: (listing.title ?? "").slice(0, 120),
    description: (listing.description ?? "").slice(0, 5000),
    original_price: resolved[0]?.price ?? 0,
    seller_stock: [{ stock: 0 }],
    weight: principal?.weight ? Number(principal.weight) : undefined,
    category_id: categoryId,
    image: { image_id_list: ["<<sera_uploadado>>"] },
    item_status: "NORMAL",
    condition: "NEW",
    dimension: principal?.dimensionLength ? {
      package_length: Math.round(Number(principal.dimensionLength)),
      package_width: Math.round(Number(principal.dimensionWidth ?? 0)),
      package_height: Math.round(Number(principal.dimensionHeight ?? 0)),
    } : undefined,
    brand,
    item_sku: resolved[0]?.sku ?? undefined,
    attribute_list: ws.attributeValues ? Object.entries(ws.attributeValues).map(([attrId, val]: [string, any]) => ({
      attribute_id: Number(attrId),
      attribute_value_list: Array.isArray(val) ? val : [val],
    })) : undefined,
  };

  const initTierPayload = tierVariations.length > 0 ? {
    item_id: "<<sera_definido_apos_add_item>>",
    tier_variation: tierVariations,
    model: models,
  } : null;

  // Diagnostico de validacao
  const issues: Array<{ severity: "error" | "warning"; field: string; message: string }> = [];
  if (!listing.title || listing.title.length < 10) issues.push({ severity: "error", field: "title", message: "Titulo precisa ter ao menos 10 caracteres" });
  if (!listing.description || listing.description.length < 30) issues.push({ severity: "error", field: "description", message: "Descricao precisa ter ao menos 30 caracteres" });
  if (!listing.thumbUrl) issues.push({ severity: "error", field: "thumbUrl", message: "Thumb (capa) nao definida" });
  if (!categoryId) issues.push({ severity: "error", field: "categoryId", message: "Categoria Shopee nao definida" });
  if (!ws.brandValue?.brandId) issues.push({ severity: "warning", field: "brand", message: "Marca nao escolhida - sera publicado como 'No Brand'" });
  if (resolved.length < 2) issues.push({ severity: "warning", field: "items", message: "Anuncio combinado faz mais sentido com 2+ produtos" });
  if (!ws.optionDetailsMatrix || ws.optionDetailsMatrix.length === 0) issues.push({ severity: "error", field: "variations", message: "Matriz de variacoes vazia" });
  if (!listing.videoUrl && !listing.videoBankId) issues.push({ severity: "warning", field: "video", message: "Sem video - anuncios com video tem mais conversao" });

  // Valida precos minimos da Shopee (>= R$ 1,00)
  const zeroPriceModels = models.filter((m: any) => !m.original_price || Number(m.original_price) <= 0);
  if (zeroPriceModels.length > 0) {
    issues.push({
      severity: "error",
      field: "price",
      message: `${zeroPriceModels.length} célula(s) com preço ZERO ou nao preenchido. Va no Step 2 e preencha os preços faltantes.`,
    });
  }
  const lowPriceModels = models.filter((m: any) => Number(m.original_price) > 0 && Number(m.original_price) < 1);
  if (lowPriceModels.length > 0) {
    issues.push({
      severity: "error",
      field: "price",
      message: `${lowPriceModels.length} modelo(s) com preço abaixo de R$ 1,00 (limite minimo Shopee). Verifique calculos no Step 2.`,
    });
  }

  // Valida estoque (Shopee aceita 0 mas eh boa pratica avisar se TUDO esta zerado)
  const zeroStockCount = models.filter((m: any) => {
    const stock = m.seller_stock?.[0]?.stock ?? 0;
    return stock <= 0;
  }).length;
  if (zeroStockCount > 0 && zeroStockCount === models.length) {
    issues.push({
      severity: "error",
      field: "stock",
      message: `Todas as ${zeroStockCount} células estao com estoque ZERO. Anuncio nao podera vender. Preencha estoque no Step 2.`,
    });
  } else if (zeroStockCount > 0) {
    issues.push({
      severity: "warning",
      field: "stock",
      message: `${zeroStockCount} célula(s) com estoque ZERO - nao poderao vender ate ter estoque.`,
    });
  }

  // Valida price_ratio Shopee: max preco / min preco <= 4
  const validPrices = models
    .map((m: any) => Number(m.original_price))
    .filter((p: number) => p > 0);
  if (validPrices.length >= 2) {
    const minP = Math.min(...validPrices);
    const maxP = Math.max(...validPrices);
    const ratio = maxP / minP;
    if (ratio > 4) {
      issues.push({
        severity: "error",
        field: "price",
        message: `Razao de precos ${ratio.toFixed(1)}x excede limite Shopee de 4x (mais caro R$ ${maxP.toFixed(2)} / mais barato R$ ${minP.toFixed(2)}). Ajuste precos no Step 2 ou separe em multiplos anuncios.`,
      });
    }
  }

  return {
    listingId,
    listingStatus: listing.status,
    mode: listing.mode,
    accountId: listing.shopeeAccountId,
    resolved,
    principalShopeeProduct: principal ? {
      itemId: principal.itemId,
      name: principal.name,
      categoryId: principal.categoryId,
      weight: principal.weight,
    } : null,
    wizardState: {
      categoryId: ws.categoryId,
      categoryBreadcrumb: ws.categoryBreadcrumb,
      brand: ws.brandValue,
      attributeCount: ws.attributeValues ? Object.keys(ws.attributeValues).length : 0,
      selectedType: ws.selectedType,
      variation1: { name: variation1Name, options: variation1Options.length, label: "Modelo (produto)" },
      variation2: variation2Options.length > 0 ? { name: variation2Name, options: variation2Options.length } : null,
      totalCells: productCount * optionCount,
      hasPriceOverrides: !!ws.priceOverrides && Object.keys(ws.priceOverrides as any).length > 0,
      pricingMode: ws.pricingMode,
      computedCellsCount: Array.isArray(ws.computedCells) ? ws.computedCells.length : 0,
    },
    media: {
      thumbUrl: listing.thumbUrl,
      videoUrl: listing.videoUrl,
      videoBankId: listing.videoBankId,
      productImagesCount: resolved.filter(r => r.imageUrl).length,
    },
    payloadPreview: {
      addItem: addItemPayload,
      initTierVariation: initTierPayload,
    },
    issues,
    canPublish: issues.filter(i => i.severity === "error").length === 0,
  };
}
