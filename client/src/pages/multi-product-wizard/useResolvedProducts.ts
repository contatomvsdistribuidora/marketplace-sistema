import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { itemKey, type Listing, type ListingItem, type ResolvedProduct } from "./types";

/**
 * Resolves human-readable product details (name, sku, price, image) for a list
 * of multi_product_listing_items. Items only carry { source, sourceId } so we
 * batch-fetch from the BaseLinker cache (productCache) and Shopee products to
 * build a Map<key, ResolvedProduct> for O(1) lookup.
 *
 * Limit 200 covers up to MAX_SELECTION=50 with margin. If more is needed, swap
 * for a dedicated "products by ids" endpoint.
 */
export function useResolvedProducts(listing: Listing, items: ListingItem[]) {
  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;
  const blAvailable = !!tokenData?.hasToken && !!inventoryId;

  const hasBl = items.some((it) => it.source === "baselinker");
  const hasShopee = items.some((it) => it.source === "shopee");

  const { data: blData, isLoading: blLoading } = trpc.baselinker.filterProducts.useQuery(
    { inventoryId: inventoryId!, filters: {}, page: 1, pageSize: 200 },
    { enabled: blAvailable && hasBl },
  );

  const { data: shopeeData, isLoading: shopeeLoading } = trpc.shopee.getProducts.useQuery(
    { accountId: listing.shopeeAccountId, offset: 0, limit: 200, hasVariation: false },
    { enabled: hasShopee },
  );

  const productMap = useMemo(() => {
    const map = new Map<string, ResolvedProduct>();
    if (blData?.products) {
      for (const p of blData.products as any[]) {
        const sourceId = Number(p.productId);
        if (!sourceId) continue;
        map.set(itemKey("baselinker", sourceId), {
          source: "baselinker",
          sourceId,
          name: p.name ?? "",
          sku: p.sku ?? "",
          price: String(p.mainPrice ?? "0"),
          imageUrl: p.imageUrl ?? null,
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
