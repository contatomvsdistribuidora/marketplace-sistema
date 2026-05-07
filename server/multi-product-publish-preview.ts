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

  // ===== Variacoes Shopee =====
  // Variacao 1: nome vem de selectedType (ex "Quantidade"), opcoes vem de optionLabels (ex "20", "30", "40")
  const tierVariations: any[] = [];
  const variation1Name = deriveVariationName(ws.selectedType);
  const variation1Options = (ws.optionLabels ?? []).filter(l => l && l.trim()).map((label: string) => ({
    option: label.toString().slice(0, 20),
  }));
  if (variation1Options.length > 0) {
    tierVariations.push({ name: variation1Name.slice(0, 20), option_list: variation1Options });
  }

  // Variacao 2: vem das colunas do schema, nao do optionLabels[1]
  const variation2Type = (listing as any).variation2Type as string | null;
  const variation2OptionsRaw = (listing as any).variation2OptionsJson as any[] | null;
  const variation2Name = variation2Type ? deriveVariationName(variation2Type) : null;
  const variation2Options = Array.isArray(variation2OptionsRaw)
    ? variation2OptionsRaw.filter((o: any) => o?.label).map((o: any) => ({ option: String(o.label).slice(0, 20) }))
    : [];
  if (variation2Name && variation2Options.length > 0) {
    tierVariations.push({ name: variation2Name.slice(0, 20), option_list: variation2Options });
  }

  // ===== Models (combinacoes) =====
  // priceOverrides eh Record<number, number> (preco direto, NAO objeto)
  // Por enquanto: tira preco/estoque do produto principal por linha (i)
  // O calculo completo (computePricing) sera plugado no proximo bloco
  const models: any[] = [];
  const dim1Count = variation1Options.length || 1;
  const dim2Count = variation2Options.length || 1;
  for (let i = 0; i < dim1Count; i++) {
    for (let j = 0; j < dim2Count; j++) {
      // priceOverrides[i] = preco direto, se setado pelo usuario
      const overridePrice = (ws.priceOverrides as any)?.[i];
      const productForRow = resolved[i] ?? resolved[0];
      const cellOpt1 = ws.optionDetailsMatrix?.[i]?.[j];

      const price = overridePrice != null && overridePrice > 0
        ? Number(overridePrice)
        : (cellOpt1?.price ? Number(cellOpt1.price) : Number(productForRow?.price ?? 0));

      const stock = cellOpt1?.stock
        ? Number(cellOpt1.stock)
        : Number(productForRow?.stock ?? 0);

      const sku = cellOpt1?.sku
        ? String(cellOpt1.sku)
        : `${listing.id}-V${i + 1}${variation2Name ? `-${j + 1}` : ""}`;

      models.push({
        tier_index: variation2Name ? [i, j] : [i],
        original_price: price,
        seller_stock: [{ stock }],
        model_sku: sku,
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
      variation1: { name: variation1Name, options: variation1Options.length },
      variation2: variation2Name ? { name: variation2Name, options: variation2Options.length } : null,
      totalCells: dim1Count * dim2Count,
      hasPriceOverrides: !!ws.priceOverrides && Object.keys(ws.priceOverrides as any).length > 0,
      pricingMode: ws.pricingMode,
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
