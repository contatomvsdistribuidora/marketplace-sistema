/**
 * Publicação de anúncios multi-produto na Shopee.
 *
 * Reusa toda a infra de upload/createProduct/initTierVariation de
 * shopee-publish.ts. Este módulo só orquestra o caso multi-produto:
 * carrega listing+items, valida estado, resolve dados do principal,
 * faz uploads (thumb + 1 por item), monta payload tier_variation com
 * imagem por opção, e marca o listing como `published` no DB.
 *
 * Fase H1.1 — sem suporte a vídeo (só imagens).
 */

import { db as sharedDb } from "./db";
import { eq } from "drizzle-orm";
import {
  multiProductListings,
  multiProductListingItems,
  productCache,
  shopeeProducts,
} from "../drizzle/schema";
import * as shopeePublish from "./shopee-publish";
import { getValidToken } from "./shopee";

export class PublishMultiProductError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "PublishMultiProductError";
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
};

/**
 * Converte attributes do formato snake_case (como vem do sync da Shopee em
 * shopeeProducts.attributes) para o formato camelCase esperado pela função
 * createProduct de shopee-publish.ts. Tolerante a entradas malformadas — itens
 * inválidos são pulados sem erro.
 */
function convertAttributesToCreateInput(
  raw: unknown,
): shopeePublish.CreateProductInput["attributes"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<shopeePublish.CreateProductInput["attributes"]> = [];
  for (const a of raw as any[]) {
    const attrId = Number(a?.attribute_id);
    const list = a?.attribute_value_list;
    if (!attrId || !Array.isArray(list)) continue;
    out.push({
      attributeId: attrId,
      attributeValueList: list.map((v: any) => ({
        valueId: Number(v?.value_id ?? 0),
        ...(v?.original_value_name ? { originalValueName: String(v.original_value_name) } : {}),
        ...(v?.value_unit ? { valueUnit: String(v.value_unit) } : {}),
      })),
    });
  }
  return out.length > 0 ? out : undefined;
}

export async function publishMultiProductListing(
  listingId: number,
  userId: number,
  onProgress?: (step: string) => void,
): Promise<{
  itemId: number;
  itemUrl: string;
  imagesUploaded: number;
  modelsCreated: number;
  mode: "create" | "promote";
}> {
  // ============ 1. Carrega + valida estado
  const [listing] = await sharedDb
    .select()
    .from(multiProductListings)
    .where(eq(multiProductListings.id, listingId))
    .limit(1);

  if (!listing || listing.userId !== userId) {
    throw new PublishMultiProductError("NOT_FOUND", "Anúncio combinado não encontrado.");
  }

  if (listing.status === "published") {
    throw new PublishMultiProductError("ALREADY_PUBLISHED", "Este anúncio já foi publicado.");
  }
  if (listing.status === "publishing") {
    throw new PublishMultiProductError("ALREADY_PUBLISHING", "Publicação em andamento. Aguarde.");
  }

  // ============ 2. Principal precisa ser Shopee
  if (listing.mainProductSource !== "shopee") {
    throw new PublishMultiProductError(
      "PRINCIPAL_NOT_SHOPEE",
      "Para publicar, marque um produto Shopee como ⭐ principal no Step A.",
    );
  }

  // ============ 3. Valida campos do listing
  if (!listing.title || listing.title.trim().length < 10) {
    throw new PublishMultiProductError(
      "TITLE_INVALID",
      "Título precisa ter pelo menos 10 caracteres. Edite no Step B.",
    );
  }
  if (!listing.description || listing.description.trim().length < 30) {
    throw new PublishMultiProductError(
      "DESCRIPTION_INVALID",
      "Descrição precisa ter pelo menos 30 caracteres. Edite no Step B.",
    );
  }
  if (!listing.thumbUrl) {
    throw new PublishMultiProductError(
      "THUMB_MISSING",
      "Thumb não gerada. Gere no Step C antes de publicar.",
    );
  }

  // ============ 4. Items
  const items = await sharedDb
    .select()
    .from(multiProductListingItems)
    .where(eq(multiProductListingItems.listingId, listingId))
    .orderBy(multiProductListingItems.position);

  if (items.length === 0) {
    throw new PublishMultiProductError("NO_ITEMS", "Adicione produtos no Step A.");
  }
  if (items.length > 50) {
    throw new PublishMultiProductError(
      "TOO_MANY_ITEMS",
      `Shopee aceita até 50 variações. Listing tem ${items.length}.`,
    );
  }

  // ============ 5. Lock: status=publishing
  await sharedDb
    .update(multiProductListings)
    .set({ status: "publishing", lastError: null })
    .where(eq(multiProductListings.id, listingId));

  try {
    // ============ 6. Resolve items (nome, preço, estoque, imagem)
    onProgress?.("Resolvendo produtos");
    const resolved: ResolvedItem[] = [];
    for (const item of items) {
      if (item.source === "baselinker") {
        const [p] = await sharedDb
          .select()
          .from(productCache)
          .where(eq(productCache.productId, Number(item.sourceId)))
          .limit(1);
        if (p) {
          resolved.push({
            source: "baselinker",
            sourceId: Number(item.sourceId),
            name: p.name ?? "",
            sku: item.customSku ?? p.sku ?? "",
            price: Number(item.customPrice ?? p.mainPrice ?? 0),
            stock: Number(p.totalStock ?? 0),
            imageUrl: p.imageUrl ?? null,
          });
        }
      } else {
        const [p] = await sharedDb
          .select()
          .from(shopeeProducts)
          .where(eq(shopeeProducts.itemId, Number(item.sourceId)))
          .limit(1);
        if (p) {
          resolved.push({
            source: "shopee",
            sourceId: Number(item.sourceId),
            name: p.itemName ?? "",
            sku: item.customSku ?? p.itemSku ?? "",
            price: Number(item.customPrice ?? p.price ?? 0),
            stock: Number(p.stock ?? 0),
            imageUrl: p.imageUrl ?? null,
          });
        }
      }
    }

    if (resolved.length !== items.length) {
      throw new PublishMultiProductError(
        "ITEMS_RESOLVE_FAILED",
        `Apenas ${resolved.length} de ${items.length} produtos puderam ser resolvidos.`,
      );
    }

    // ============ 7. Carrega dados do principal (categoria, dimensões, attributes)
    const principal = resolved.find(
      (r) =>
        r.source === listing.mainProductSource &&
        r.sourceId === Number(listing.mainProductSourceId),
    );
    if (!principal || principal.source !== "shopee") {
      throw new PublishMultiProductError(
        "PRINCIPAL_RESOLVE_FAILED",
        "Principal não encontrado ou não é Shopee.",
      );
    }

    const [principalData] = await sharedDb
      .select()
      .from(shopeeProducts)
      .where(eq(shopeeProducts.itemId, principal.sourceId))
      .limit(1);

    if (!principalData?.categoryId) {
      throw new PublishMultiProductError(
        "CATEGORY_MISSING",
        "Produto principal sem categoria Shopee. Re-sincronize o produto.",
      );
    }

    // ============ 8. Token Shopee
    onProgress?.("Validando token Shopee");
    const { accessToken, shopId } = await getValidToken(listing.shopeeAccountId);

    // ============ 9. Upload de imagens
    onProgress?.("Fazendo upload da capa do anúncio");
    const thumbImageId = await shopeePublish.uploadImageFromUrl(
      accessToken,
      shopId,
      listing.thumbUrl,
      "normal",
    );

    onProgress?.(`Fazendo upload de ${resolved.length} imagens das variações`);
    const optionImageIds: string[] = [];
    for (let i = 0; i < resolved.length; i++) {
      const item = resolved[i];
      try {
        if (item.imageUrl) {
          const id = await shopeePublish.uploadImageFromUrl(
            accessToken,
            shopId,
            item.imageUrl,
            "normal",
          );
          optionImageIds.push(id);
        } else {
          // Sem imagem própria: fallback pra thumb (variação ainda terá imagem)
          optionImageIds.push(thumbImageId);
        }
        if (i < resolved.length - 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (err) {
        console.warn(
          `[multi-product-publish] Falha upload variação ${i}, usando thumb fallback:`,
          err,
        );
        optionImageIds.push(thumbImageId);
      }
    }

    // ============ 10. Logistics (top 5)
    onProgress?.("Configurando canais de envio");
    const channels = await shopeePublish.getLogisticsChannels(accessToken, shopId);
    const logisticIds = (channels as any[])
      .filter((c) => c.enabled)
      .map((c) => c.logistics_channel_id)
      .slice(0, 5);

    // ============ 11. Cria/promove na Shopee
    let shopeeItemId: number;
    let mode: "create" | "promote";

    // Hidrata wizardStateJson - fonte de verdade dos precos/variacoes
    const ws = (() => {
      try {
        const raw = listing.wizardStateJson as string | null;
        if (!raw) return {} as any;
        const parsed = JSON.parse(raw);
        return parsed?.version === 1 ? parsed : ({} as any);
      } catch { return {} as any; }
    })();

    const optionLabels: string[] = Array.isArray(ws.optionLabels)
      ? ws.optionLabels.filter((l: string) => l && l.trim())
      : [];
    const computedCellsList: any[] = Array.isArray(ws.computedCells) ? ws.computedCells : [];
    const computedByCellKey = new Map<string, any>();
    computedCellsList.forEach((c: any) => computedByCellKey.set(c.cellKey, c));

    // Sufixo unico pra evitar duplicate de SKU em re-tentativas
    const skuSuffix = String(Date.now()).slice(-6);

    // Categoria: prefere a do wizard
    const finalCategoryId = Number(ws.categoryId ?? principalData.categoryId);

    // Marca: prefere a do wizard
    const finalBrand = ws.brandValue?.brandId
      ? { brandId: Number(ws.brandValue.brandId), originalBrandName: String(ws.brandValue.brandName ?? "") }
      : { brandId: 0, originalBrandName: "No Brand" };

    // Monta opcoes da variacao (1D concatenado: "Produto | Opcao")
    // Quando nao tem variacao 2 (optionLabels vazio), so usa nome do produto
    const hasOptions = optionLabels.length > 0;
    const variationOptions: string[] = [];
    const variationOptionImageIds: string[] = [];
    const models: shopeePublish.KitVariation["models"] = [];
    let minPrice = Infinity;

    for (let productIdx = 0; productIdx < resolved.length; productIdx++) {
      const product = resolved[productIdx];
      const productLabel = (ws.productNameOverrides?.[String(productIdx)] ?? product.name ?? `Produto ${productIdx + 1}`).slice(0, 12);

      if (hasOptions) {
        for (let optIdx = 0; optIdx < optionLabels.length; optIdx++) {
          const optLabel = optionLabels[optIdx].slice(0, 6);
          const cellKey = `${productIdx}-${optIdx}`;
          const computed = computedByCellKey.get(cellKey);
          const cellOpt = ws.optionDetailsMatrix?.[productIdx]?.[optIdx];

          let price = 0;
          if (computed?.pricing?.price > 0) price = Number(computed.pricing.price);
          else if (cellOpt?.price && Number(cellOpt.price) > 0) price = Number(cellOpt.price);
          else price = Number(product.price ?? 0);

          const stock = cellOpt?.stock != null && cellOpt.stock !== ""
            ? Number(cellOpt.stock)
            : (product.stock > 0 ? product.stock : 1);

          const sku = cellOpt?.sku ? String(cellOpt.sku) : `${listing.id}-${skuSuffix}-P${productIdx + 1}-V${optIdx + 1}`;
          const optionLabel = `${productLabel} | ${optLabel}`.slice(0, 20);

          variationOptions.push(optionLabel);
          variationOptionImageIds.push(optionImageIds[productIdx] ?? thumbImageId);
          models.push({
            tierIndex: [variationOptions.length - 1],
            price: price >= 1 ? price : 1,
            stock: stock > 0 ? stock : 1,
            sku,
          });
          if (price > 0 && price < minPrice) minPrice = price;
        }
      } else {
        const price = Number(product.price ?? 0);
        const stock = product.stock > 0 ? product.stock : 1;
        const sku = product.sku || `${listing.id}-${skuSuffix}-P${productIdx + 1}`;
        const optionLabel = productLabel.slice(0, 20);

        variationOptions.push(optionLabel);
        variationOptionImageIds.push(optionImageIds[productIdx] ?? thumbImageId);
        models.push({
          tierIndex: [variationOptions.length - 1],
          price: price >= 1 ? price : 1,
          stock,
          sku,
        });
        if (price > 0 && price < minPrice) minPrice = price;
      }
    }

    // Preco do item-level: usa o menor encontrado, fallback principal.price/0.01
    const itemLevelPrice = minPrice !== Infinity && minPrice >= 1 ? minPrice : Math.max(Number(principal.price ?? 1), 1);

    if (listing.mode === "promote" && listing.existingShopeeItemId) {
      onProgress?.("Promovendo anúncio existente a multi-variação");
      mode = "promote";
      shopeeItemId = Number(listing.existingShopeeItemId);

      await shopeePublish.promoteSimpleToVariated(accessToken, shopId, {
        itemId: shopeeItemId,
        variationTypeName: "Modelo",
        variations: variationOptions.map((label, idx) => ({
          label,
          price: models[idx].price,
          stock: models[idx].stock,
          sku: models[idx].sku ?? `${listing.id}-V${idx + 1}`,
          imageId: variationOptionImageIds[idx],
        })),
      });
    } else {
      onProgress?.("Criando anúncio na Shopee");
      mode = "create";

      // Atributos: prefere os do wizard, fallback pra os do principal
      // O wizard salva { valueId, originalValue, displayValue } - precisa mapear pra { valueId, originalValueName, valueUnit }
      const normalizeAttributeValue = (val: any) => {
        if (val == null) return null;
        // Se ja vier no formato Shopee, mantem
        const valueId = Number(val.valueId ?? val.value_id ?? 0);
        const originalValueName = val.originalValueName ?? val.original_value_name ?? val.originalValue ?? val.original_value ?? val.displayValue ?? val.display_value ?? "";
        const valueUnit = val.valueUnit ?? val.value_unit ?? "";
        // Se valueId = 0 (texto livre), precisa garantir que tem originalValueName
        if (valueId === 0 && !originalValueName) return null;
        const out: any = { valueId };
        if (originalValueName) out.originalValueName = String(originalValueName);
        if (valueUnit) out.valueUnit = String(valueUnit);
        return out;
      };

      let finalAttributes = convertAttributesToCreateInput(principalData.attributes);
      if (ws.attributeValues && typeof ws.attributeValues === "object") {
        const fromWizard = Object.entries(ws.attributeValues)
          .map(([attrIdStr, val]: [string, any]) => {
            const valuesRaw = Array.isArray(val) ? val : [val];
            const attributeValueList = valuesRaw
              .map(normalizeAttributeValue)
              .filter((v: any) => v !== null);
            if (attributeValueList.length === 0) return null;
            return {
              attributeId: Number(attrIdStr),
              attributeValueList,
            };
          })
          .filter((a: any) => a !== null);
        if (fromWizard.length > 0) finalAttributes = fromWizard as any;
      }

      const created = await shopeePublish.createProduct(accessToken, shopId, {
        itemName: listing.title.trim().substring(0, 120),
        description: listing.description.trim().substring(0, 5000),
        categoryId: finalCategoryId,
        // Item-level price/stock são "container" — o init_tier_variation
        // sobrescreve com valores reais por modelo. Usamos o menor preco
        // dos models como placeholder pra atender o schema do add_item.
        price: itemLevelPrice,
        stock: 0,
        weight: Number(principalData.weight ?? 0),
        imageIds: [thumbImageId],
        condition: "NEW",
        sku: `${listing.id}-${skuSuffix}-MAIN`,
        dimension: principalData.dimensionLength
          ? {
              packageLength: Math.round(Number(principalData.dimensionLength)),
              packageWidth: Math.round(Number(principalData.dimensionWidth ?? 0)),
              packageHeight: Math.round(Number(principalData.dimensionHeight ?? 0)),
            }
          : undefined,
        logisticIds: logisticIds.length > 0 ? logisticIds : undefined,
        attributes: finalAttributes,
        brand: finalBrand,
      });

      shopeeItemId = created.itemId;

      // Salva o shopeeItemId IMEDIATAMENTE pra rastrear orfaos se init_tier_variation falhar
      await sharedDb.update(multiProductListings)
        .set({ shopeeItemId: shopeeItemId, status: "publishing" })
        .where(eq(multiProductListings.id, listingId));

      onProgress?.("Criando variações");
      try {
        await shopeePublish.initTierVariation(accessToken, shopId, shopeeItemId, {
          name: "Modelo",
          options: variationOptions,
          optionImageIds: variationOptionImageIds,
          models,
        });
      } catch (initErr: any) {
        // initTierVariation falhou. Item ja foi criado na Shopee como produto simples.
        // Marca como erro mas mantem shopeeItemId pra que o user possa apagar manualmente.
        const enrichedMsg = `${initErr?.message ?? "init_tier_variation falhou"} | ITEM ORFAO criado na Shopee: itemId=${shopeeItemId} (deletar manualmente em seller.shopee.com.br)`;
        throw new Error(enrichedMsg);
      }
    }

    // ============ 12. Sucesso
    onProgress?.("Finalizando");
    await sharedDb
      .update(multiProductListings)
      .set({
        status: "published",
        shopeeItemId,
        publishedAt: new Date(),
        lastError: null,
      })
      .where(eq(multiProductListings.id, listingId));

    return {
      itemId: shopeeItemId,
      itemUrl: `https://shopee.com.br/product/${shopId}/${shopeeItemId}`,
      imagesUploaded: 1 + optionImageIds.length,
      modelsCreated: resolved.length,
      mode,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
    await sharedDb
      .update(multiProductListings)
      .set({
        status: "error",
        lastError: errorMsg.substring(0, 1024),
      })
      .where(eq(multiProductListings.id, listingId));
    throw err;
  }
}
