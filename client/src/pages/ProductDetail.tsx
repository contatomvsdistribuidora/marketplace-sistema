import { useState, useMemo, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  ArrowLeft, Package, FileText, Tag, Video,
  ChevronLeft, ChevronRight, Copy, Check, ExternalLink, Code,
} from "lucide-react";
import { toast } from "sonner";

function InfoField({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1.5 text-sm">
        <span className="font-medium truncate">{value}</span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title={copied ? "Copiado" : "Copiar"}
          >
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

function formatCurrencyBRL(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  try {
    const date = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function ProductDetail() {
  const urlSearch = useSearch();
  const [, setLocation] = useLocation();

  const productId = useMemo(() => {
    const p = new URLSearchParams(urlSearch).get("id");
    const n = p ? Number(p) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [urlSearch]);

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: invData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = invData?.inventoryId;

  const cacheQuery = trpc.baselinker.getProductsByIds.useQuery(
    { inventoryId: inventoryId ?? 0, productIds: [productId ?? 0] },
    { enabled: !!inventoryId && productId !== null },
  );

  const detailsQuery = trpc.baselinker.getProductDetails.useQuery(
    { inventoryId: inventoryId ?? 0, productIds: [productId ?? 0] },
    { enabled: !!inventoryId && productId !== null },
  );

  const manufacturersQuery = trpc.baselinker.getManufacturers.useQuery(
    { inventoryId: inventoryId ?? 0 },
    {
      enabled: !!inventoryId,
      staleTime: 60 * 60 * 1000, // 1h — fabricantes mudam raramente
      refetchOnWindowFocus: false,
    },
  );

  const cached = cacheQuery.data?.[0];
  const fullProduct = detailsQuery.data
    ? (Object.values(detailsQuery.data)[0] as any)
    : null;

  // Reset image index quando o produto muda
  useEffect(() => {
    setSelectedImageIndex(0);
  }, [productId]);

  // Galeria de imagens — fonte primária é getProductDetails (tem todas as 16),
  // fallback pra imageUrl do cache se a query ao vivo falhar.
  const allImages: string[] = useMemo(() => {
    const out: string[] = [];
    if (fullProduct?.images && typeof fullProduct.images === "object") {
      const entries = Object.entries(fullProduct.images).sort(
        ([a], [b]) => Number(a) - Number(b),
      );
      for (const [, url] of entries) {
        if (url) out.push(url as string);
      }
    }
    if (out.length === 0 && cached?.imageUrl) out.push(cached.imageUrl);
    return out;
  }, [fullProduct, cached]);

  const features: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {};
    if (fullProduct?.text_fields?.features) {
      try {
        const raw = fullProduct.text_fields.features;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object") Object.assign(out, parsed);
      } catch {
        /* ignore */
      }
    }
    if (fullProduct?.features && typeof fullProduct.features === "object") {
      for (const [k, v] of Object.entries(fullProduct.features)) {
        if (v != null && !out[k]) out[k] = String(v);
      }
    }
    return out;
  }, [fullProduct]);

  const description =
    fullProduct?.text_fields?.description || cached?.description || "";

  // ============ Live derived state (BL ao vivo, com fallback pro cache) ============

  const liveStock = useMemo(() => {
    if (fullProduct?.stock && typeof fullProduct.stock === "object") {
      return Object.values(fullProduct.stock).reduce(
        (s: number, v: any) => s + (Number(v) || 0),
        0,
      );
    }
    return cached?.totalStock ?? 0;
  }, [fullProduct, cached]);

  const livePrice = useMemo(() => {
    if (fullProduct?.prices && typeof fullProduct.prices === "object") {
      const vals = Object.values(fullProduct.prices) as number[];
      if (vals.length > 0) return Number(vals[0]);
    }
    return cached?.mainPrice ? Number(cached.mainPrice) : 0;
  }, [fullProduct, cached]);

  const priceGroupCount = useMemo(() => {
    if (fullProduct?.prices && typeof fullProduct.prices === "object") {
      return Object.keys(fullProduct.prices).length;
    }
    return 1;
  }, [fullProduct]);

  const stockWarehouseCount = useMemo(() => {
    if (fullProduct?.stock && typeof fullProduct.stock === "object") {
      return Object.keys(fullProduct.stock).length;
    }
    return 0;
  }, [fullProduct]);

  const liveDimensions = useMemo(() => {
    const fp = fullProduct as any;
    return {
      height: fp?.height != null ? Number(fp.height) : null,
      width: fp?.width != null ? Number(fp.width) : null,
      length: fp?.length != null ? Number(fp.length) : null,
    };
  }, [fullProduct]);

  const hasDimensions = useMemo(() => {
    return !!(liveDimensions.height || liveDimensions.width || liveDimensions.length);
  }, [liveDimensions]);

  const liveCostPriceFromExtras = useMemo(() => {
    const tf = fullProduct?.text_fields;
    if (!tf || typeof tf !== "object") return null;
    for (const [k, v] of Object.entries(tf)) {
      const kLower = k.toLowerCase();
      if (kLower.includes("cost") || kLower.includes("custo")) {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) return num;
      }
    }
    return null;
  }, [fullProduct]);

  const liveCostPrice = useMemo(() => {
    const fp = fullProduct as any;
    // Prioridade: average_cost (BL doc) > average_landed_cost > variantes legadas
    const candidates = [
      fp?.average_cost,
      fp?.average_landed_cost,
      fp?.price_cost,
      fp?.cost_price,
      fp?.purchase_price,
      fp?.price_purchase,
    ];
    for (const c of candidates) {
      if (c != null && Number.isFinite(Number(c)) && Number(c) > 0) return Number(c);
    }
    return liveCostPriceFromExtras;
  }, [fullProduct, liveCostPriceFromExtras]);

  const manufacturerMap = useMemo(() => {
    const map = new Map<number, string>();
    const list = (manufacturersQuery.data ?? []) as any[];
    for (const m of list) {
      const id = Number(m?.manufacturer_id ?? m?.id);
      const name = String(m?.name ?? m?.manufacturer_name ?? "");
      if (id && name) map.set(id, name);
    }
    return map;
  }, [manufacturersQuery.data]);

  const liveManufacturer = useMemo(() => {
    // 1. Tenta man_name do live (caso BL popule em outras lojas — confirmado vazio na MVS)
    const liveName = (fullProduct as any)?.man_name;
    if (liveName) return String(liveName);

    // 2. Lookup pelo ID via mapa cacheado de getInventoryManufacturers
    const liveId =
      (fullProduct as any)?.manufacturer_id ?? cached?.manufacturerId ?? null;
    if (liveId) {
      const name = manufacturerMap.get(Number(liveId));
      if (name) return name;
      // Mapa ainda carregando — sinaliza
      if (manufacturersQuery.isLoading) return `Carregando... (ID ${liveId})`;
      // Mapa carregado mas id não bate — fallback
      return `ID: ${liveId}`;
    }

    return "—";
  }, [fullProduct, cached, manufacturerMap, manufacturersQuery.isLoading]);

  const liveSuppliers = useMemo(() => {
    const fp = fullProduct as any;
    const sup = fp?.suppliers;
    if (!sup) return [] as Array<{ name: string; code: string; cost: number | null }>;
    if (Array.isArray(sup)) {
      return sup
        .map((s: any) => ({
          name: String(s?.name ?? s?.supplier_name ?? "—"),
          code: String(s?.code ?? s?.supplier_code ?? ""),
          cost: s?.cost != null ? Number(s.cost) : null,
        }))
        .filter((s) => s.name !== "—");
    }
    return [];
  }, [fullProduct]);

  // Cache+live fallback nos campos básicos (eliminam assimetria — antes só vinham do cache)
  const liveName = useMemo(() => {
    return (fullProduct as any)?.name || cached?.name || "";
  }, [fullProduct, cached]);

  const liveSku = useMemo(() => {
    return (fullProduct as any)?.sku || cached?.sku || "";
  }, [fullProduct, cached]);

  const liveEan = useMemo(() => {
    return (fullProduct as any)?.ean || cached?.ean || "";
  }, [fullProduct, cached]);

  const liveWeight = useMemo(() => {
    const fp = fullProduct as any;
    if (fp?.weight != null) return Number(fp.weight);
    if (cached?.weight) return Number(cached.weight);
    return null;
  }, [fullProduct, cached]);

  const liveCategoryId = useMemo(() => {
    return (fullProduct as any)?.category_id || cached?.categoryId || null;
  }, [fullProduct, cached]);

  const liveTags = useMemo(() => {
    const fp = fullProduct as any;
    if (Array.isArray(fp?.tags)) return fp.tags as string[];
    if (Array.isArray(cached?.tags)) return cached!.tags as string[];
    return [];
  }, [fullProduct, cached]);

  const liveTaxRate = useMemo(() => {
    const tr = (fullProduct as any)?.tax_rate;
    if (tr != null && Number.isFinite(Number(tr))) return Number(tr);
    return null;
  }, [fullProduct]);

  const liveVideoFile = useMemo(() => {
    const ef = fullProduct?.text_fields?.extra_field_101404;
    if (ef && typeof ef === "object" && !Array.isArray(ef)) {
      return { url: (ef as any).url ?? null, title: (ef as any).title ?? null };
    }
    return null;
  }, [fullProduct]);

  const liveVideoLink = useMemo(() => {
    const ef = fullProduct?.text_fields?.extra_field_97122;
    if (typeof ef === "string") return ef;
    if (ef && typeof ef === "object" && !Array.isArray(ef)) {
      return (ef as any).url ?? null;
    }
    return null;
  }, [fullProduct]);

  const extraFields = useMemo(() => {
    const tf = fullProduct?.text_fields;
    if (!tf || typeof tf !== "object") return {} as Record<string, any>;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(tf)) {
      if (!k.startsWith("extra_field_")) continue;
      // Vídeos têm bloco dedicado na coluna esquerda — não duplicar aqui.
      if (k === "extra_field_101404" || k === "extra_field_97122") continue;
      out[k] = v;
    }
    return out;
  }, [fullProduct]);

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      toast.success("Copiado");
      setTimeout(() => setCopiedField(null), 2000);
    });
  }

  // ============ Estados especiais ============
  if (productId === null) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Package className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">ID de produto inválido</h2>
            <p className="text-sm text-muted-foreground">
              Use a URL <code>/product?id=N</code> com um ID numérico válido.
            </p>
            <Button onClick={() => setLocation("/products")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar para Produtos
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading = cacheQuery.isLoading || (!cached && cacheQuery.isFetching);

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 lg:p-6 max-w-7xl">
        <Skeleton className="h-6 w-64 mb-3" />
        <Skeleton className="h-12 w-full mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-[450px_1fr] gap-6">
          <Skeleton className="aspect-square w-full" />
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!cached) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Package className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">Produto não encontrado</h2>
            <p className="text-sm text-muted-foreground">
              Produto {productId} não está no cache local. Sincronize em
              /products primeiro.
            </p>
            <Button onClick={() => setLocation("/products")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar para Produtos
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const effectiveVideoUrl = cached.videoUrl ?? liveVideoFile?.url ?? null;
  const effectiveVideoTitle = cached.videoTitle ?? liveVideoFile?.title ?? null;
  const effectiveVideoLinkUrl = cached.videoLinkUrl ?? liveVideoLink ?? null;
  const hasVideo = !!(effectiveVideoUrl || effectiveVideoLinkUrl);
  const descExtra1 = (fullProduct as any)?.description_extra1 || null;
  const descExtra2 = (fullProduct as any)?.description_extra2 || null;

  return (
    <div className="container mx-auto p-4 lg:p-6 max-w-7xl">
      {/* Header com breadcrumb + voltar */}
      <div className="sticky top-0 bg-background z-10 pb-3 -mx-4 lg:-mx-6 px-4 lg:px-6 border-b mb-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setLocation("/products");
                  }}
                >
                  Produtos
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="line-clamp-1 max-w-md">
                  {liveName || `(produto ${productId})`}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/products")}
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Voltar
          </Button>
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-bold line-clamp-2">{liveName}</h1>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">ID: {String(productId)}</Badge>
            {liveSku && <Badge variant="outline">SKU: {liveSku}</Badge>}
            {liveEan && <Badge variant="outline">EAN: {liveEan}</Badge>}
            <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
              Preço: {formatCurrencyBRL(livePrice)}
              {priceGroupCount > 1 && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  +{priceGroupCount - 1} grupos
                </span>
              )}
            </Badge>
            <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">
              Estoque: {liveStock} unid
              {stockWarehouseCount > 1 && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  ({stockWarehouseCount} depósitos)
                </span>
              )}
            </Badge>
          </div>
        </div>
      </div>

      {/* Body em 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-[450px_1fr] gap-6">
        {/* Coluna esquerda — Galeria + Vídeo */}
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="relative aspect-square rounded-lg border overflow-hidden bg-white">
              {detailsQuery.isLoading && allImages.length === 0 ? (
                <Skeleton className="w-full h-full" />
              ) : allImages.length > 0 ? (
                <>
                  <img
                    src={allImages[selectedImageIndex]}
                    alt={liveName}
                    className="w-full h-full object-contain p-2"
                  />
                  {allImages.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedImageIndex(
                            (i) => (i - 1 + allImages.length) % allImages.length,
                          )
                        }
                        className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedImageIndex((i) => (i + 1) % allImages.length)
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                        {selectedImageIndex + 1} / {allImages.length}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="h-16 w-16 text-muted-foreground/30" />
                </div>
              )}
            </div>
            {allImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {allImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedImageIndex(idx)}
                    className={`shrink-0 h-16 w-16 rounded-md border-2 overflow-hidden transition ${
                      idx === selectedImageIndex
                        ? "border-primary ring-1 ring-primary/30"
                        : "border-transparent hover:border-muted-foreground/30"
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Vídeo do produto (Fase G) */}
          {hasVideo && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Video className="h-4 w-4" />
                  Vídeo do produto
                </div>
                {effectiveVideoUrl && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-xs">
                        ✅ Apto Shopee
                      </Badge>
                      <span className="text-xs text-muted-foreground truncate">
                        {effectiveVideoTitle ?? "(sem título)"}
                      </span>
                    </div>
                    <a
                      href={effectiveVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir vídeo
                    </a>
                  </div>
                )}
                {effectiveVideoLinkUrl && (
                  <div className="space-y-1">
                    <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-xs">
                      🔗 Link externo
                    </Badge>
                    <a
                      href={effectiveVideoLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline text-blue-600 hover:text-blue-800 flex items-center gap-1 break-all"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {effectiveVideoLinkUrl}
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Coluna direita — Tabs */}
        <div className="min-w-0">
          <Tabs defaultValue="info">
            <TabsList className="w-full justify-start mb-4">
              <TabsTrigger value="info" className="gap-1.5">
                <Package className="h-3.5 w-3.5" />
                Geral
              </TabsTrigger>
              <TabsTrigger value="description" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Descrição
              </TabsTrigger>
              <TabsTrigger value="features" className="gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Atributos ({Object.keys(features).length + Object.keys(extraFields).length})
              </TabsTrigger>
              <TabsTrigger value="raw" className="gap-1.5">
                <Code className="h-3.5 w-3.5" />
                Cru (BL)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="mt-0 space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <InfoField
                  label="ID Produto"
                  value={String(productId)}
                  onCopy={() => copyToClipboard(String(productId), "id")}
                  copied={copiedField === "id"}
                />
                <InfoField
                  label="SKU"
                  value={liveSku || "—"}
                  onCopy={liveSku ? () => copyToClipboard(liveSku, "sku") : undefined}
                  copied={copiedField === "sku"}
                />
                <InfoField
                  label="EAN"
                  value={liveEan || "—"}
                  onCopy={liveEan ? () => copyToClipboard(liveEan, "ean") : undefined}
                  copied={copiedField === "ean"}
                />
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">Preço</div>
                  <div className="text-sm font-medium">
                    {formatCurrencyBRL(livePrice)}
                    {priceGroupCount > 1 && (
                      <span className="text-xs text-muted-foreground ml-1">
                        +{priceGroupCount - 1} grupos
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">Preço de custo</div>
                  <div className="text-sm font-medium">
                    {liveCostPrice != null ? formatCurrencyBRL(liveCostPrice) : "—"}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">Estoque</div>
                  <div className="text-sm font-medium">{liveStock} unidades</div>
                  {fullProduct?.stock &&
                    typeof fullProduct.stock === "object" &&
                    Object.keys(fullProduct.stock).length > 1 && (
                      <div className="text-[11px] space-y-0.5 mt-1">
                        {Object.entries(fullProduct.stock).map(([wh, qty]) => (
                          <div key={wh} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Depósito {wh}:</span>
                            <span>{Number(qty) || 0}</span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
                <InfoField
                  label="Peso"
                  value={liveWeight != null ? `${liveWeight} kg` : "—"}
                />
                <InfoField
                  label="Taxa de imposto"
                  value={liveTaxRate != null ? `${liveTaxRate}%` : "—"}
                />
                <div className="col-span-2 sm:col-span-3 space-y-1">
                  <div className="text-xs text-muted-foreground">Dimensões</div>
                  {hasDimensions ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded border p-2 text-center bg-muted/30">
                        <div className="text-[10px] text-muted-foreground uppercase">Altura</div>
                        <div className="text-sm font-medium">
                          {liveDimensions.height != null ? `${liveDimensions.height} cm` : "—"}
                        </div>
                      </div>
                      <div className="rounded border p-2 text-center bg-muted/30">
                        <div className="text-[10px] text-muted-foreground uppercase">Largura</div>
                        <div className="text-sm font-medium">
                          {liveDimensions.width != null ? `${liveDimensions.width} cm` : "—"}
                        </div>
                      </div>
                      <div className="rounded border p-2 text-center bg-muted/30">
                        <div className="text-[10px] text-muted-foreground uppercase">Comprimento</div>
                        <div className="text-sm font-medium">
                          {liveDimensions.length != null ? `${liveDimensions.length} cm` : "—"}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">—</div>
                  )}
                </div>
                <InfoField
                  label="Categoria BL"
                  value={liveCategoryId ? String(liveCategoryId) : "—"}
                />
                <InfoField label="Fabricante" value={liveManufacturer} />
                <InfoField
                  label="Cache atualizado"
                  value={formatDateTime(cached.cachedAt)}
                />
              </div>

              {liveSuppliers.length > 0 && (
                <div className="col-span-2 sm:col-span-3 space-y-1">
                  <div className="text-xs text-muted-foreground">Fornecedores</div>
                  <div className="space-y-1">
                    {liveSuppliers.map((s, idx) => (
                      <div
                        key={idx}
                        className="rounded border p-2 text-sm flex items-center justify-between gap-3"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{s.name}</span>
                          {s.code && (
                            <span className="text-xs text-muted-foreground">Código: {s.code}</span>
                          )}
                        </div>
                        {s.cost != null && (
                          <span className="text-sm font-medium text-green-700">
                            {formatCurrencyBRL(s.cost)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {liveTags.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Tags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {liveTags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="description" className="mt-0">
              {description ? (
                <div className="rounded border p-4 max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm">
                  {description}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  Sem descrição cadastrada.
                </div>
              )}
            </TabsContent>

            <TabsContent value="features" className="mt-0">
              {detailsQuery.isLoading &&
                Object.keys(features).length === 0 &&
                Object.keys(extraFields).length === 0 &&
                !descExtra1 &&
                !descExtra2 && (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    Carregando atributos...
                  </div>
                )}

              {Object.keys(features).length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium mb-2">Atributos</h3>
                  <div className="rounded border divide-y">
                    {Object.entries(features).map(([k, v]) => (
                      <div key={k} className="flex items-start gap-4 px-4 py-2 text-sm">
                        <span className="text-muted-foreground min-w-32 shrink-0">{k}</span>
                        <span className="font-medium flex-1 break-words">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(extraFields).length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium mb-2">Campos extras (BL)</h3>
                  <div className="rounded border divide-y">
                    {Object.entries(extraFields).map(([k, v]) => {
                      let displayValue: string;
                      if (v === null || v === undefined) displayValue = "—";
                      else if (typeof v === "object") displayValue = JSON.stringify(v);
                      else displayValue = String(v);
                      return (
                        <div key={k} className="flex items-start gap-4 px-4 py-2 text-sm">
                          <span className="text-muted-foreground font-mono text-xs min-w-40 shrink-0">
                            {k}
                          </span>
                          <span className="font-medium flex-1 break-all text-right">
                            {displayValue}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(descExtra1 || descExtra2) && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Descrições extras</h3>
                  {descExtra1 && (
                    <div className="mb-3">
                      <div className="text-xs text-muted-foreground mb-1">Descrição extra 1</div>
                      <div className="rounded border p-3 text-sm whitespace-pre-wrap">
                        {descExtra1}
                      </div>
                    </div>
                  )}
                  {descExtra2 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Descrição extra 2</div>
                      <div className="rounded border p-3 text-sm whitespace-pre-wrap">
                        {descExtra2}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!detailsQuery.isLoading &&
                Object.keys(features).length === 0 &&
                Object.keys(extraFields).length === 0 &&
                !descExtra1 &&
                !descExtra2 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nenhum atributo encontrado.
                  </p>
                )}
            </TabsContent>

            <TabsContent value="raw" className="mt-0">
              {detailsQuery.isLoading ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  Carregando dados ao vivo do BaseLinker...
                </div>
              ) : detailsQuery.error ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Falha ao carregar: {detailsQuery.error.message}
                </div>
              ) : (
                <pre className="rounded border bg-muted/30 p-3 max-h-[60vh] overflow-auto text-xs">
                  {JSON.stringify(fullProduct ?? {}, null, 2)}
                </pre>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

