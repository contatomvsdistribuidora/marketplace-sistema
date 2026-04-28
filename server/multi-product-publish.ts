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

    if (listing.mode === "promote" && listing.existingShopeeItemId) {
      onProgress?.("Promovendo anúncio existente a multi-variação");
      mode = "promote";
      shopeeItemId = Number(listing.existingShopeeItemId);

      await shopeePublish.promoteSimpleToVariated(accessToken, shopId, {
        itemId: shopeeItemId,
        variationTypeName: "Variação",
        variations: resolved.map((item, idx) => ({
          label: item.name.substring(0, 40),
          price: item.price,
          stock: item.stock > 0 ? item.stock : 1,
          sku: `${listing.id}-V${idx + 1}`,
          imageId: optionImageIds[idx],
        })),
      });
    } else {
      onProgress?.("Criando anúncio na Shopee");
      mode = "create";

      const created = await shopeePublish.createProduct(accessToken, shopId, {
        itemName: listing.title.trim().substring(0, 120),
        description: listing.description.trim().substring(0, 5000),
        categoryId: Number(principalData.categoryId),
        // Item-level price/stock são "container" — o init_tier_variation
        // sobrescreve com valores reais por modelo. Usamos o do principal
        // como placeholder pra atender o schema do add_item.
        price: principal.price,
        stock: 0,
        weight: Number(principalData.weight ?? 0),
        imageIds: [thumbImageId],
        condition: "NEW",
        sku: `${listing.id}-MAIN`,
        dimension: principalData.dimensionLength
          ? {
              packageLength: Math.round(Number(principalData.dimensionLength)),
              packageWidth: Math.round(Number(principalData.dimensionWidth ?? 0)),
              packageHeight: Math.round(Number(principalData.dimensionHeight ?? 0)),
            }
          : undefined,
        logisticIds: logisticIds.length > 0 ? logisticIds : undefined,
        attributes: convertAttributesToCreateInput(principalData.attributes),
        brand: { brandId: 0, originalBrandName: "No Brand" },
      });

      shopeeItemId = created.itemId;

      onProgress?.("Criando variações");
      await shopeePublish.initTierVariation(accessToken, shopId, shopeeItemId, {
        name: "Variação",
        options: resolved.map((item) => item.name.substring(0, 40)),
        optionImageIds,
        models: resolved.map((item, idx) => ({
          tierIndex: [idx],
          price: item.price,
          stock: item.stock > 0 ? item.stock : 1,
          sku: `${listing.id}-V${idx + 1}`,
        })),
      });
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
