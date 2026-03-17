import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  Package, Image as ImageIcon, FileText, Tag, ChevronLeft, ChevronRight,
  ExternalLink, Copy, Check
} from "lucide-react";
import { useState, useEffect } from "react";

interface ProductDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: {
    id: number;
    name: string;
    sku: string;
    ean: string;
    mainPrice: number;
    totalStock: number;
    weight: number;
    imageUrl: string;
    description: string;
    tags: string[];
    categoryId: number;
    manufacturerId: number;
  } | null;
  inventoryId: number;
}

export function ProductDetailModal({ open, onOpenChange, product, inventoryId }: ProductDetailModalProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Fetch full product details from BaseLinker API (includes all images)
  const { data: fullDetails, isLoading: detailsLoading } = trpc.baselinker.getProductDetails.useQuery(
    { inventoryId, productIds: [product?.id || 0] },
    { enabled: open && !!product?.id && !!inventoryId }
  );

  const fullProduct = fullDetails ? Object.values(fullDetails)[0] as any : null;

  // Extract all images
  const allImages: string[] = [];
  if (fullProduct?.images) {
    const entries = Object.entries(fullProduct.images).sort(([a], [b]) => Number(a) - Number(b));
    for (const [, url] of entries) {
      if (url) allImages.push(url as string);
    }
  }
  if (allImages.length === 0 && product?.imageUrl) {
    allImages.push(product.imageUrl);
  }

  // Extract features/parameters
  const features: Record<string, string> = {};
  if (fullProduct?.text_fields) {
    try {
      const featuresStr = fullProduct.text_fields.features;
      if (featuresStr) {
        const parsed = typeof featuresStr === "string" ? JSON.parse(featuresStr) : featuresStr;
        Object.assign(features, parsed);
      }
    } catch { /* ignore */ }
  }

  // Extract description
  const description = fullProduct?.text_fields?.description || product?.description || "";

  useEffect(() => {
    setSelectedImageIndex(0);
  }, [product?.id]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-lg font-semibold truncate pr-8">{product.name}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row gap-0 md:gap-6 px-6 pb-6 overflow-hidden">
          {/* Left: Image Gallery */}
          <div className="w-full md:w-[360px] shrink-0">
            {detailsLoading ? (
              <Skeleton className="w-full aspect-square rounded-lg" />
            ) : (
              <div className="space-y-3">
                {/* Main image */}
                <div className="relative aspect-square rounded-lg border overflow-hidden bg-muted/30">
                  {allImages.length > 0 ? (
                    <img
                      src={allImages[selectedImageIndex]}
                      alt={product.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="h-16 w-16 text-muted-foreground/30" />
                    </div>
                  )}
                  {/* Navigation arrows */}
                  {allImages.length > 1 && (
                    <>
                      <button
                        onClick={() => setSelectedImageIndex(i => (i - 1 + allImages.length) % allImages.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setSelectedImageIndex(i => (i + 1) % allImages.length)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                        {selectedImageIndex + 1} / {allImages.length}
                      </div>
                    </>
                  )}
                </div>
                {/* Thumbnails */}
                {allImages.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {allImages.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedImageIndex(idx)}
                        className={`shrink-0 h-14 w-14 rounded-md border-2 overflow-hidden transition ${
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
            )}
          </div>

          {/* Right: Product Details */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <Tabs defaultValue="info" className="h-full">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="info" className="gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Dados
                </TabsTrigger>
                <TabsTrigger value="description" className="gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Descrição
                </TabsTrigger>
                <TabsTrigger value="images" className="gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Fotos ({allImages.length})
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="h-[400px] mt-3">
                {/* Info Tab */}
                <TabsContent value="info" className="mt-0 space-y-4">
                  {/* Basic info grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <InfoField
                      label="ID Produto"
                      value={String(product.id)}
                      onCopy={() => copyToClipboard(String(product.id), "id")}
                      copied={copiedField === "id"}
                    />
                    <InfoField
                      label="SKU"
                      value={product.sku || "—"}
                      onCopy={product.sku ? () => copyToClipboard(product.sku, "sku") : undefined}
                      copied={copiedField === "sku"}
                    />
                    <InfoField
                      label="EAN"
                      value={product.ean || "—"}
                      onCopy={product.ean ? () => copyToClipboard(product.ean, "ean") : undefined}
                      copied={copiedField === "ean"}
                    />
                    <InfoField
                      label="Preço"
                      value={product.mainPrice ? `R$ ${product.mainPrice.toFixed(2)}` : "—"}
                    />
                    <InfoField
                      label="Estoque"
                      value={product.totalStock != null ? String(product.totalStock) : "—"}
                    />
                    <InfoField
                      label="Peso"
                      value={product.weight ? `${product.weight} kg` : "—"}
                    />
                    <InfoField
                      label="Categoria ID"
                      value={product.categoryId ? String(product.categoryId) : "—"}
                    />
                    <InfoField
                      label="Fabricante ID"
                      value={product.manufacturerId ? String(product.manufacturerId) : "—"}
                    />
                  </div>

                  {/* Tags */}
                  {product.tags && product.tags.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        Tags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {product.tags.map((tag, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Features/Parameters */}
                  {Object.keys(features).length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">Características</p>
                      <div className="rounded-md border divide-y">
                        {Object.entries(features).map(([key, value]) => (
                          <div key={key} className="flex items-center px-3 py-1.5 text-xs">
                            <span className="font-medium text-muted-foreground w-1/3 shrink-0">{key}</span>
                            <span className="flex-1">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Description Tab */}
                <TabsContent value="description" className="mt-0">
                  {description ? (
                    <div
                      className="prose prose-sm max-w-none text-sm"
                      dangerouslySetInnerHTML={{ __html: description }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <FileText className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">Sem descrição disponível</p>
                    </div>
                  )}
                </TabsContent>

                {/* Images Tab */}
                <TabsContent value="images" className="mt-0">
                  {allImages.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {allImages.map((img, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setSelectedImageIndex(idx);
                            // Switch to info tab to see the big image
                          }}
                          className="relative aspect-square rounded-lg border overflow-hidden hover:ring-2 ring-primary/30 transition group"
                        >
                          <img src={img} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                          <div className="absolute top-1.5 left-1.5 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                            {idx + 1}
                          </div>
                          {idx === 0 && (
                            <div className="absolute bottom-1.5 left-1.5 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded font-medium">
                              Capa
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <ImageIcon className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">Nenhuma foto disponível</p>
                    </div>
                  )}
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium truncate">{value}</p>
        {onCopy && (
          <button
            onClick={onCopy}
            className="shrink-0 h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}
