import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  Store,
  Package,
  Video,
  Image,
  FileText,
  BarChart3,
  Download,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

export default function ShopeeAccounts() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const shopeeSuccess = params.get("shopee_success");
  const shopeeError = params.get("shopee_error");
  const shopName = params.get("shop_name");

  const [deleteAccountId, setDeleteAccountId] = useState<number | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<number | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  const { data: accounts, isLoading, refetch } = trpc.shopee.getAccounts.useQuery();
  const { data: authUrlData } = trpc.shopee.getAuthUrl.useQuery({
    redirectUrl: `${window.location.origin}/api/shopee/callback`,
  });
  const deactivateMutation = trpc.shopee.deactivateAccount.useMutation();
  const syncMutation = trpc.shopee.syncProducts.useMutation();
  const { data: qualityStats } = trpc.shopee.getQualityStats.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );
  const { data: productsData } = trpc.shopee.getProducts.useQuery(
    { accountId: selectedAccountId!, limit: 10 },
    { enabled: !!selectedAccountId }
  );

  // Handle OAuth callback params
  useEffect(() => {
    if (shopeeSuccess === "true") {
      toast.success(`Loja Shopee "${shopName || ""}" conectada com sucesso!`);
      refetch();
      window.history.replaceState({}, "", "/shopee-accounts");
    }
    if (shopeeError) {
      toast.error(`Erro ao conectar Shopee: ${decodeURIComponent(shopeeError)}`);
      window.history.replaceState({}, "", "/shopee-accounts");
    }
  }, [shopeeSuccess, shopeeError, shopName, refetch]);

  // Auto-select first account
  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      const active = accounts.find((a: any) => a.isActive);
      if (active) setSelectedAccountId(active.id);
    }
  }, [accounts, selectedAccountId]);

  const handleConnect = () => {
    if (!authUrlData?.url) {
      toast.error("Erro ao gerar URL de autorização");
      return;
    }
    // Add state with userId info
    window.location.href = authUrlData.url;
  };

  const handleDeactivate = async (accountId: number) => {
    try {
      await deactivateMutation.mutateAsync({ accountId });
      toast.success("Conta desconectada");
      refetch();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleSync = async (accountId: number) => {
    setSyncingAccountId(accountId);
    try {
      const result = await syncMutation.mutateAsync({ accountId });
      toast.success(`Sincronização concluída: ${result.synced} de ${result.total} produtos`);
      refetch();
    } catch (error: any) {
      toast.error(`Erro na sincronização: ${error.message}`);
    } finally {
      setSyncingAccountId(null);
    }
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "Nunca";
    return new Date(date).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contas Shopee</h1>
          <p className="text-muted-foreground mt-1">
            Conecte suas lojas Shopee para gerenciar produtos, otimizar anúncios e criar campanhas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={handleConnect}>
            <Plus className="h-4 w-4 mr-2" />
            Conectar Loja
          </Button>
        </div>
      </div>

      {/* Info Card */}
      <Card className="border-orange-200 bg-orange-50/50">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <ShieldCheck className="h-5 w-5 text-orange-600 mt-0.5 shrink-0" />
            <div className="text-sm text-orange-800">
              <p className="font-medium mb-1">Como funciona a conexão com a Shopee?</p>
              <p>
                Ao clicar em "Conectar Loja", você será redirecionado para a Shopee para autorizar o acesso.
                Após autorizar, os tokens de acesso serão salvos de forma segura. Você pode conectar até 4 lojas
                e gerenciar todas de um único painel. O App está em modo <strong>Developing</strong> (teste).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !accounts || accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-16 w-16 rounded-full bg-orange-100 flex items-center justify-center mb-4">
              <Store className="h-8 w-8 text-orange-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Nenhuma loja conectada</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Conecte sua primeira loja Shopee para começar a gerenciar produtos, otimizar anúncios
              com IA, criar variações/kits e monitorar concorrentes.
            </p>
            <Button onClick={handleConnect}>
              <Plus className="h-4 w-4 mr-2" />
              Conectar Primeira Loja
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {accounts.map((account: any) => (
            <Card
              key={account.id}
              className={`cursor-pointer transition-all ${
                !account.isActive ? "opacity-60" : ""
              } ${selectedAccountId === account.id ? "ring-2 ring-orange-500" : ""}`}
              onClick={() => account.isActive && setSelectedAccountId(account.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-orange-100 flex items-center justify-center">
                      <Store className="h-6 w-6 text-orange-600" />
                    </div>
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {account.shopName || `Loja ${account.shopId}`}
                        {account.isActive ? (
                          <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Ativa
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-red-100 text-red-800">
                            <XCircle className="h-3 w-3 mr-1" />
                            Inativa
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>
                        Shop ID: {account.shopId} | Região: {account.region}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {account.isActive && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSync(account.id);
                          }}
                          disabled={syncingAccountId === account.id}
                        >
                          {syncingAccountId === account.id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4 mr-2" />
                          )}
                          Sincronizar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeactivate(account.id);
                          }}
                          disabled={deactivateMutation.isPending}
                        >
                          Desconectar
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteAccountId(account.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Produtos</span>
                    <p className="font-medium">{account.totalProducts || 0}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status</span>
                    <p className="font-medium">{account.shopStatus || "Normal"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Última Sync</span>
                    <p className="font-medium">{formatDate(account.lastSyncAt)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Conectada em</span>
                    <p className="font-medium">{formatDate(account.createdAt)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quality Dashboard */}
      {selectedAccountId && qualityStats && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Dashboard de Qualidade</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Package className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Produtos</p>
                    <p className="text-2xl font-bold">{qualityStats.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <Video className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Com Vídeo</p>
                    <p className="text-2xl font-bold">{qualityStats.withVideoPercent}%</p>
                  </div>
                </div>
                <Progress value={qualityStats.withVideoPercent} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {qualityStats.withVideo} de {qualityStats.total}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <Image className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">5+ Imagens</p>
                    <p className="text-2xl font-bold">{qualityStats.with5PlusImagesPercent}%</p>
                  </div>
                </div>
                <Progress value={qualityStats.with5PlusImagesPercent} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {qualityStats.with5PlusImages} de {qualityStats.total}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Atributos Preenchidos</p>
                    <p className="text-2xl font-bold">{qualityStats.avgAttrsFilled}%</p>
                  </div>
                </div>
                <Progress value={qualityStats.avgAttrsFilled} className="h-2" />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Recent Products Preview */}
      {selectedAccountId && productsData && productsData.products.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Produtos Recentes ({productsData.total} total)</h2>
            <Button variant="outline" size="sm" asChild>
              <a href={`/shopee-products?accountId=${selectedAccountId}`}>
                Ver Todos
              </a>
            </Button>
          </div>
          <div className="grid gap-3">
            {productsData.products.map((product: any) => (
              <Card key={product.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="py-3">
                  <div className="flex items-center gap-4">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.itemName}
                        className="h-14 w-14 rounded-lg object-cover border"
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center">
                        <Package className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{product.itemName}</p>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                        <span>R$ {product.price}</span>
                        <span>Estoque: {product.stock}</span>
                        <span>Vendas: {product.sold}</span>
                        {product.hasVideo ? (
                          <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-xs">
                            <Video className="h-3 w-3 mr-1" />
                            Vídeo
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium">
                          {product.attributesFilled}/{product.attributesTotal}
                        </span>
                        <span className="text-xs text-muted-foreground">attrs</span>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`text-xs mt-1 ${
                          product.attributesTotal > 0 && product.attributesFilled === product.attributesTotal
                            ? "bg-green-100 text-green-700"
                            : product.attributesFilled > 0
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {product.attributesTotal > 0 && product.attributesFilled === product.attributesTotal
                          ? "Completo"
                          : product.attributesFilled > 0
                          ? "Parcial"
                          : "Incompleto"}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteAccountId !== null} onOpenChange={() => setDeleteAccountId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar loja permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá desconectar a loja Shopee. Os tokens de acesso serão removidos e você precisará
              reconectar a loja se quiser usá-la novamente. Os produtos na Shopee não serão afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleteAccountId) {
                  await deactivateMutation.mutateAsync({ accountId: deleteAccountId });
                  toast.success("Loja desconectada");
                  setDeleteAccountId(null);
                  refetch();
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
