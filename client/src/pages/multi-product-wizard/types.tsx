import { Badge } from "@/components/ui/badge";
import { Package, Store } from "lucide-react";

export type WizardStep = "A" | "B" | "C" | "D";

export const STEPS: { key: WizardStep; label: string }[] = [
  { key: "A", label: "Produtos" },
  { key: "B", label: "Conteúdo" },
  { key: "C", label: "Mídia" },
  { key: "D", label: "Revisão" },
];

export const TITLE_MAX = 100;

export type Source = "baselinker" | "shopee";

export type ResolvedProduct = {
  source: Source;
  sourceId: number;
  name: string;
  sku: string;
  price: string;
  imageUrl: string | null;
  weight: string | null;
  dimensionLength: string | null;
  dimensionWidth: string | null;
  dimensionHeight: string | null;
};

export type ListingItem = {
  id: number;
  listingId: number;
  source: Source;
  sourceId: number;
  position: number;
  customPrice: string | null;
  customSku: string | null;
};

export type Listing = {
  id: number;
  userId: number;
  shopeeAccountId: number;
  mode: "new" | "promote";
  status: "draft" | "ready" | "publishing" | "published" | "error";
  existingShopeeItemId: number | null;
  shopeeItemId: number | null;
  mainProductSource: Source;
  mainProductSourceId: number;
  title: string | null;
  description: string | null;
  thumbStatus: "pending" | "generated" | "approved";
  thumbUrl: string | null;
  videoUrl: string | null;
  videoBankId: number | null;
  lastError: string | null;
};

export function itemKey(source: string, sourceId: number | string): string {
  return `${source}:${sourceId}`;
}

export function formatPrice(p: string | number | null | undefined): string {
  if (p === null || p === undefined || p === "") return "—";
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n)) return String(p);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function SourceBadge({ source }: { source: Source }) {
  return source === "baselinker" ? (
    <Badge variant="outline" className="text-xs gap-1 border-orange-300 bg-orange-50 text-orange-700">
      <Package className="h-3 w-3" />
      BL
    </Badge>
  ) : (
    <Badge variant="outline" className="text-xs gap-1 border-pink-300 bg-pink-50 text-pink-700">
      <Store className="h-3 w-3" />
      Shopee
    </Badge>
  );
}
