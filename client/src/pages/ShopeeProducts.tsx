import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
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
  Star,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

type SyncStatus = "synced" | "outdated" | "not_found" | "checking" | "unknown";

function SyncBadge({ status, changes }: { status: SyncStatus; changes?: string[] }) {
  if (status === "checking")
    return (
      <Badge variant="outline" className="text-xs gap-1 text-muted-foreground border-muted-foreground/30">
        <Loader2 className="h-3 w-3 animate-spin" />
        Verificando
      </Badge>
    );
  if (status === "synced")
    return (
      <Badge variant="outline" className="text-xs gap-1 text-green-700 border-green-300 bg-green-50">
        <CheckCircle2 className="h-3 w-3" />
        Sincronizado
      </Badge>
    );
  if (status === "outdated")
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 text-yellow-700 border-yellow-300 bg-yellow-50"
        title={changes?.length ? `Diferente: ${changes.join(", ")}` : undefined}
      >
        <AlertTriangle className="h-3 w-3" />
        Desatualizado{changes?.length ? ` (${changes.join(", ")})` : ""}
      </Badge>
    );
  if (status === "not_found")
    return (
      <Badge variant="outline" className="text-xs gap-1 text-red-700 border-red-300 bg-red-50">
        <WifiOff className="h-3 w-3" />
        Não sincronizado
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      —
    </Badge>
  );
}

function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ShopeeProducts() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const initialAccountId = params.get("accountId");

  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    initialAccountId ? parseInt(initialAccountId) : null
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [syncingProductId, setSyncingProductId] = useState<number | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const { data: accounts } = trpc.shopee.getAccounts.useQuery();
  const { data: productsData, isLoading, refetch: refetchProducts } = trpc.shopee.getProducts.useQuery(
    { accountId: selectedAccountId!, offset: page * pageSize, limit: pageSize },
    { enabled: !!selectedAccountId }
  );
  const { data: qualityStats } = trpc.shopee.getQualityStats.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  const currentItemIds = useMemo(
    () => productsData?.products.map((p: any) => Number(p.itemId)) ?? [],
    [productsData]
  );

  const {
    data: syncStatusData,
    isLoading: isCheckingSync,
    isFetching: isFetchingSync,
    refetch: recheckSync,
  } = trpc.shopee.checkSyncStatus.useQuery(
    { accountId: selectedAccountId!, itemIds: currentItemIds },
    { enabled: !!selectedAccountId && currentItemIds.length > 0, staleTime: 30_000 }
  );

  const syncStatusByItemId = useMemo(() => {
    const map = new Map<number, { status: SyncStatus; changes?: string[] }>();
    if (syncStatusData) {
      for (const s of syncStatusData) map.set(s.itemId, s);
    }
    return map;
  }, [syncStatusData]);

  const syncSingleMutation = trpc.shopee.syncSingleProduct.useMutation();
  const syncAllMutation = trpc.shopee.syncProducts.useMutation();

  // Auto-select first account
  useMemo(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      const active = accounts.find((a: any) => a.isActive);
      if (active) setSelectedAccountId(active.id);
    }
  }, [accounts, selectedAccountId]);

  const totalPages = productsData ? Math.ceil(productsData.total / pageSize) : 0;

  const syncValues = useMemo(() => Array.from(syncStatusByItemId.values()), [syncStatusByItemId]);
  const outdatedCount = useMemo(
    () => syncValues.filter(s => s.status === "outdated" || s.status === "not_found").length,
    [syncValues]
  );

  const getScoreBadge = (filled: number, total: number) => {
    if (total === 0) return { label: "Sem dados", color: "bg-gray-100 text-gray-700" };
    const pct = (filled / total) * 100;
    if (pct >= 90) return { label: "Qualificado", color: "bg-green-100 text-green-700" };
    if (pct >= 50) return { label: "Parcial", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Para Melhorar", color: "bg-red-100 text-red-700" };
  };

  const handleSyncSingle = async (productId: number, productName: string) => {
    setSyncingProductId(productId);
    try {
      await syncSingleMutation.mutateAsync({ productId });
      toast.success(`✅ "${productName}" sincronizado com sucesso!`);
      refetchProducts();
      recheckSync();
    } catch (err: any) {
      toast.error(`❌ Erro ao sincronizar: ${err.message}`);
    } finally {
      setSyncingProductId(null);
    }
  };

  const handleSyncAll = async () => {
    if (!selectedAccountId) return;
    setSyncingAll(true);
    try {
      const result = await syncAllMutation.mutateAsync({ accountId: selectedAccountId });
      toast.success(
        `✅ Sincronização concluída — ${result.added} adicionados · ${result.updated} atualizados · ${result.removed} removidos`
      );
      refetchProducts();
      recheckSync();
    } catch (err: any) {
      toast.error(`❌ Erro na sincronização: ${err.message}`);
    } finally {
      setSyncingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos Shopee</h1>
          <p className="text-muted-foreground mt-1">
            Visualize e gerencie os produtos sincronizados das suas lojas Shopee.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {accounts && accounts.length > 0 && (
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(v) => { setSelectedAccountId(parseInt(v)); setPage(0); }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Selecione uma loja" />
              </SelectTrigger>
              <SelectContent>
                {accounts.filter((a: any) => a.isActive).map((a: any) => (
                  <SelectItem key={a.id} value={a.id.toString()}>
                    {a.shopName || `Loja ${a.shopId}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedAccountId && (
            <Button
              onClick={handleSyncAll}
              disabled={syncingAll}
              className="gap-2"
            >
              {syncingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncingAll ? "Sincronizando..." : "🔄 Sincronizar Todos"}
            </Button>
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

      {/* Sync status bar */}
      {productsData && productsData.products.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2 text-sm">
          <div className="flex items-center gap-3">
            {isCheckingSync || isFetchingSync ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Verificando status de sincronização...</span>
              </>
            ) : syncStatusData ? (
              <>
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {syncValues.filter(s => s.status === "synced").length} sincronizados
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="flex items-center gap-1 text-yellow-700">
                  <AlertTriangle className="h-4 w-4" />
                  {syncValues.filter(s => s.status === "outdated").length} desatualizados
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="flex items-center gap-1 text-red-700">
                  <WifiOff className="h-4 w-4" />
                  {syncValues.filter(s => s.status === "not_found").length} não encontrados
                </span>
              </>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={() => recheckSync()}>
            <RefreshCw className="h-3 w-3" />
            Reverificar
          </Button>
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
              const itemId = Number(product.itemId);
              const syncInfo = syncStatusByItemId.get(itemId);
              const syncStatus: SyncStatus = isCheckingSync || isFetchingSync
                ? "checking"
                : syncInfo?.status ?? "unknown";
              const isSyncingThis = syncingProductId === product.id;

              return (
                <Card
                  key={product.id}
                  onClick={() => setLocation(`/shopee-criador?productId=${product.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLocation(`/shopee-criador?productId=${product.id}`);
                    }
                  }}
                  className={`cursor-pointer hover:shadow-md hover:border-orange-300 transition-all ${
                    syncStatus === "outdated" ? "border-yellow-200" :
                    syncStatus === "not_found" ? "border-red-200" : ""
                  }`}
                >
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
                          <span className="text-sm font-semibold text-green-700">R$ {product.price}</span>
                          <span className="text-xs text-muted-foreground">Est: {product.stock}</span>
                          <span className="text-xs text-muted-foreground">Vendas: {product.sold}</span>
                          {product.rating && parseFloat(product.rating) > 0 && (
                            <span className="text-xs flex items-center gap-0.5 text-amber-600">
                              <Star className="h-3 w-3 fill-current" />
                              {parseFloat(product.rating).toFixed(1)}
                            </span>
                          )}
                          {product.itemSku && (
                            <span className="text-xs text-muted-foreground">SKU: {product.itemSku}</span>
                          )}
                        </div>
                        {/* Last sync + status */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <SyncBadge status={syncStatus} changes={syncInfo?.changes} />
                          <span className="text-xs text-muted-foreground">
                            Sync: {formatDate(product.lastSyncAt)}
                          </span>
                        </div>
                      </div>

                      {/* Quality Indicators */}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <div className="flex items-center gap-1" title={`${imgCount} imagens`}>
                          <Image className={`h-4 w-4 ${imgCount >= 5 ? "text-green-500" : imgCount >= 3 ? "text-yellow-500" : "text-red-500"}`} />
                          <span className="text-xs">{imgCount}</span>
                        </div>
                        <div title={product.hasVideo ? "Tem vídeo" : "Sem vídeo"}>
                          <Video className={`h-4 w-4 ${product.hasVideo ? "text-purple-500" : "text-gray-300"}`} />
                        </div>
                        <div className="text-center min-w-[60px]">
                          <div className="text-xs font-medium">
                            {product.attributesFilled || 0}/{product.attributesTotal || 0}
                          </div>
                          <Progress
                            value={product.attributesTotal > 0
                              ? ((product.attributesFilled || 0) / product.attributesTotal) * 100
                              : 0}
                            className="h-1.5 w-14"
                          />
                        </div>
                        <Badge variant="secondary" className={`text-xs ${score.color}`}>
                          {score.label}
                        </Badge>

                        {/* Individual sync button — only for outdated/not_found */}
                        {(syncStatus === "outdated" || syncStatus === "not_found") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            disabled={isSyncingThis}
                            onClick={(e) => {
                              e.stopPropagation(); // don't trigger the Card's navigate-to-wizard
                              handleSyncSingle(product.id, product.itemName);
                            }}
                          >
                            {isSyncingThis
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <RefreshCw className="h-3 w-3" />}
                            {isSyncingThis ? "..." : "🔄 Sincronizar"}
                          </Button>
                        )}
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
                Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, productsData.total)} de {productsData.total}
              </span>
              <Select
                value={pageSize.toString()}
                onValueChange={(v) => { setPageSize(parseInt(v)); setPage(0); }}
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
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">{page + 1} / {totalPages || 1}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
