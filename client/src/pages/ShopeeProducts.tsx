import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { useSearch } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Package,
  Video,
  Image,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Star,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function ShopeeProducts() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialAccountId = params.get("accountId");

  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    initialAccountId ? parseInt(initialAccountId) : null
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const { data: accounts } = trpc.shopee.getAccounts.useQuery();
  const { data: productsData, isLoading } = trpc.shopee.getProducts.useQuery(
    { accountId: selectedAccountId!, offset: page * pageSize, limit: pageSize },
    { enabled: !!selectedAccountId }
  );
  const { data: qualityStats } = trpc.shopee.getQualityStats.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  // Auto-select first account
  useMemo(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      const active = accounts.find((a: any) => a.isActive);
      if (active) setSelectedAccountId(active.id);
    }
  }, [accounts, selectedAccountId]);

  const totalPages = productsData ? Math.ceil(productsData.total / pageSize) : 0;

  const getScoreBadge = (filled: number, total: number) => {
    if (total === 0) return { label: "Sem dados", color: "bg-gray-100 text-gray-700" };
    const pct = (filled / total) * 100;
    if (pct >= 90) return { label: "Qualificado", color: "bg-green-100 text-green-700" };
    if (pct >= 50) return { label: "Parcial", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Para Melhorar", color: "bg-red-100 text-red-700" };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos Shopee</h1>
          <p className="text-muted-foreground mt-1">
            Visualize e gerencie os produtos sincronizados das suas lojas Shopee.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {accounts && accounts.length > 0 && (
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(v) => {
                setSelectedAccountId(parseInt(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Selecione uma loja" />
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((a: any) => a.isActive)
                  .map((a: any) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.shopName || `Loja ${a.shopId}`}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Quality Summary */}
      {qualityStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="bg-blue-50/50 border-blue-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-blue-600 font-medium">Total</p>
              <p className="text-xl font-bold text-blue-800">{qualityStats.total}</p>
            </CardContent>
          </Card>
          <Card className="bg-purple-50/50 border-purple-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-purple-600 font-medium">Com Vídeo</p>
              <p className="text-xl font-bold text-purple-800">{qualityStats.withVideoPercent}%</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50/50 border-green-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-green-600 font-medium">5+ Fotos</p>
              <p className="text-xl font-bold text-green-800">{qualityStats.with5PlusImagesPercent}%</p>
            </CardContent>
          </Card>
          <Card className="bg-amber-50/50 border-amber-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-amber-600 font-medium">Atributos</p>
              <p className="text-xl font-bold text-amber-800">{qualityStats.avgAttrsFilled}%</p>
            </CardContent>
          </Card>
          <Card className="bg-teal-50/50 border-teal-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-teal-600 font-medium">Com Descrição</p>
              <p className="text-xl font-bold text-teal-800">{qualityStats.withDescriptionPercent}%</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Products List */}
      {!selectedAccountId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Selecione uma loja para ver os produtos</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !productsData || productsData.products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Nenhum produto sincronizado</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Clique em "Sincronizar" na página de Contas Shopee para importar os produtos desta loja.
            </p>
            <Button variant="outline" asChild>
              <a href="/shopee-accounts">Ir para Contas Shopee</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {productsData.products.map((product: any) => {
              const score = getScoreBadge(product.attributesFilled || 0, product.attributesTotal || 0);
              const imgCount = Array.isArray(product.images) ? product.images.length : 0;

              return (
                <Card key={product.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="py-3">
                    <div className="flex items-center gap-4">
                      {/* Thumbnail */}
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.itemName}
                          className="h-16 w-16 rounded-lg object-cover border shrink-0"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Package className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm">{product.itemName}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-sm font-semibold text-green-700">
                            R$ {product.price}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Est: {product.stock}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Vendas: {product.sold}
                          </span>
                          {product.rating && parseFloat(product.rating) > 0 && (
                            <span className="text-xs flex items-center gap-0.5 text-amber-600">
                              <Star className="h-3 w-3 fill-current" />
                              {parseFloat(product.rating).toFixed(1)}
                            </span>
                          )}
                          {product.itemSku && (
                            <span className="text-xs text-muted-foreground">
                              SKU: {product.itemSku}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quality Indicators */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Images count */}
                        <div className="flex items-center gap-1" title={`${imgCount} imagens`}>
                          <Image className={`h-4 w-4 ${imgCount >= 5 ? "text-green-500" : imgCount >= 3 ? "text-yellow-500" : "text-red-500"}`} />
                          <span className="text-xs">{imgCount}</span>
                        </div>

                        {/* Video */}
                        <div title={product.hasVideo ? "Tem vídeo" : "Sem vídeo"}>
                          <Video className={`h-4 w-4 ${product.hasVideo ? "text-purple-500" : "text-gray-300"}`} />
                        </div>

                        {/* Attributes */}
                        <div className="text-center min-w-[60px]">
                          <div className="text-xs font-medium">
                            {product.attributesFilled || 0}/{product.attributesTotal || 0}
                          </div>
                          <Progress
                            value={
                              product.attributesTotal > 0
                                ? ((product.attributesFilled || 0) / product.attributesTotal) * 100
                                : 0
                            }
                            className="h-1.5 w-14"
                          />
                        </div>

                        {/* Score Badge */}
                        <Badge variant="secondary" className={`text-xs ${score.color}`}>
                          {score.label}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Mostrando {page * pageSize + 1}-{Math.min((page + 1) * pageSize, productsData.total)} de {productsData.total}
              </span>
              <Select
                value={pageSize.toString()}
                onValueChange={(v) => {
                  setPageSize(parseInt(v));
                  setPage(0);
                }}
              >
                <SelectTrigger className="w-[80px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                {page + 1} / {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
