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

  const hasVideo = !!(cached.videoUrl || cached.videoLinkUrl);

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
                  {cached.name || `(produto ${productId})`}
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
          <h1 className="text-xl font-bold line-clamp-2">{cached.name}</h1>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">ID: {String(productId)}</Badge>
            {cached.sku && <Badge variant="outline">SKU: {cached.sku}</Badge>}
            {cached.ean && <Badge variant="outline">EAN: {cached.ean}</Badge>}
            <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">
              Preço: R$ {cached.mainPrice.toFixed(2)}
            </Badge>
            <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">
              Estoque: {cached.totalStock ?? 0}
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
                    alt={cached.name}
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
                {cached.videoUrl && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700 text-xs">
                        ✅ Apto Shopee
                      </Badge>
                      <span className="text-xs text-muted-foreground truncate">
                        {cached.videoTitle ?? "(sem título)"}
                      </span>
                    </div>
                    <a
                      href={cached.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir vídeo
                    </a>
                  </div>
                )}
                {cached.videoLinkUrl && (
                  <div className="space-y-1">
                    <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-xs">
                      🔗 Link externo
                    </Badge>
                    <a
                      href={cached.videoLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs underline text-blue-600 hover:text-blue-800 flex items-center gap-1 break-all"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {cached.videoLinkUrl}
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
                Atributos ({Object.keys(features).length})
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
                  value={cached.sku || "—"}
                  onCopy={cached.sku ? () => copyToClipboard(cached.sku, "sku") : undefined}
                  copied={copiedField === "sku"}
                />
                <InfoField
                  label="EAN"
                  value={cached.ean || "—"}
                  onCopy={cached.ean ? () => copyToClipboard(cached.ean, "ean") : undefined}
                  copied={copiedField === "ean"}
                />
                <InfoField
                  label="Preço"
                  value={cached.mainPrice ? `R$ ${cached.mainPrice.toFixed(2)}` : "—"}
                />
                <InfoField
                  label="Estoque"
                  value={cached.totalStock != null ? String(cached.totalStock) : "—"}
                />
                <InfoField
                  label="Peso"
                  value={cached.weight ? `${cached.weight} kg` : "—"}
                />
                <InfoField
                  label="Categoria BL"
                  value={cached.categoryId ? String(cached.categoryId) : "—"}
                />
                <InfoField
                  label="Fabricante BL"
                  value={cached.manufacturerId ? String(cached.manufacturerId) : "—"}
                />
                <InfoField
                  label="Cache atualizado"
                  value={formatDateTime(cached.cachedAt)}
                />
              </div>

              {cached.tags && cached.tags.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Tags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {cached.tags.map((t) => (
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
              {Object.keys(features).length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  {detailsQuery.isLoading
                    ? "Carregando atributos..."
                    : "Nenhum atributo cadastrado no BaseLinker."}
                </div>
              ) : (
                <div className="rounded border divide-y">
                  {Object.entries(features).map(([k, v]) => (
                    <div key={k} className="flex items-start gap-4 px-4 py-2 text-sm">
                      <span className="text-muted-foreground min-w-32 shrink-0">{k}</span>
                      <span className="font-medium flex-1 break-words">{String(v)}</span>
                    </div>
                  ))}
                </div>
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

