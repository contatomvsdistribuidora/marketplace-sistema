import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { itemKey, type Listing, type ListingItem, type ResolvedProduct } from "./types";

/**
 * Resolves human-readable product details (name, sku, price, image) for a list
 * of multi_product_listing_items. Items only carry { source, sourceId } so we
 * batch-fetch by exact IDs and build a Map<key, ResolvedProduct> for O(1) lookup.
 *
 * Usa getProductsByIds (BL) ao inves de filterProducts({pageSize:200}): o
 * endpoint dedicado busca apenas os IDs necessarios, sem teto de 200 nem
 * dependencia de quais produtos estao nas primeiras paginas do inventario.
 */
export function useResolvedProducts(listing: Listing, items: ListingItem[]) {
  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;
  const blAvailable = !!tokenData?.hasToken && !!inventoryId;

  // IDs especificos pra batch — evita dependencia da paginacao do inventario.
  // Memoizado pra que useQuery nao refaz fetch a cada render.
  const blIds = useMemo(
    () => items
      .filter((it) => it.source === "baselinker")
      .map((it) => Number(it.sourceId))
      .filter((n) => Number.isFinite(n) && n > 0),
    [items],
  );
  const hasBl = blIds.length > 0;
  const hasShopee = items.some((it) => it.source === "shopee");

  const { data: blData, isLoading: blLoading } = trpc.baselinker.getProductsByIds.useQuery(
    { inventoryId: inventoryId!, productIds: blIds },
    { enabled: blAvailable && hasBl },
  );

  const { data: shopeeData, isLoading: shopeeLoading } = trpc.shopee.getProducts.useQuery(
    { accountId: listing.shopeeAccountId, offset: 0, limit: 200, hasVariation: false },
    { enabled: hasShopee },
  );

  const productMap = useMemo(() => {
    const map = new Map<string, ResolvedProduct>();
    // getProductsByIdsFromCache mapeia productCache.productId -> chave `id`.
    // Procurar `productId` aqui retornaria undefined e pularia tudo.
    if (Array.isArray(blData)) {
      for (const p of blData as any[]) {
        const sourceId = Number(p.id);
        if (!sourceId) continue;
        map.set(itemKey("baselinker", sourceId), {
          source: "baselinker",
          sourceId,
          name: p.name ?? "",
          sku: p.sku ?? "",
          price: String(p.mainPrice ?? "0"),
          imageUrl: p.imageUrl ?? null,
          weight: p.weight != null ? String(p.weight) : null,
          dimensionLength: null,
          dimensionWidth: null,
          dimensionHeight: null,
          categoryId: null,
          totalStock: typeof p.totalStock === "number" ? p.totalStock : null,
        });
      }
    }
    if (shopeeData?.products) {
      for (const p of shopeeData.products as any[]) {
        const sourceId = Number(p.itemId);
        if (!sourceId) continue;
        map.set(itemKey("shopee", sourceId), {
          source: "shopee",
          sourceId,
          name: p.itemName ?? "",
          sku: p.itemSku ?? "",
          price: String(p.price ?? "0"),
          imageUrl: p.imageUrl ?? null,
          weight: p.weight ?? null,
          dimensionLength: p.dimensionLength ?? null,
          dimensionWidth: p.dimensionWidth ?? null,
          dimensionHeight: p.dimensionHeight ?? null,
          categoryId: p.categoryId != null ? Number(p.categoryId) : null,
          totalStock: typeof p.stock === "number" ? p.stock : null,
        });
      }
    }
    return map;
  }, [blData, shopeeData]);

  return {
    productMap,
    isResolving: (hasBl && blLoading) || (hasShopee && shopeeLoading),
  };
}
