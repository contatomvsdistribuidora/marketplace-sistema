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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Tag,
  AlertTriangle,
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
  const [syncReport, setSyncReport] = useState<{
    accountId: number;
    added: number;
    updated: number;
    removed: number;
    total: number;
    errors: Array<{ itemId: number; error: string }>;
  } | null>(null);
  const [syncJobId, setSyncJobId] = useState<number | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; page: number } | null>(null);
  // Phase 1: counting products on Shopee before starting the job
  const [countPhase, setCountPhase] = useState<{
    counting: boolean;
    total: number | null;
    byStatus: Record<string, number> | null;
  }>({ counting: false, total: null, byStatus: null });
  const [showErrorLog, setShowErrorLog] = useState(false);
  // Resume modal state
  const [resumeModal, setResumeModal] = useState<{
    accountId: number;
    accountName: string;
    jobId: number;
    processedItems: number;
    totalItems: number;
    byStatus: Record<string, number>;
  } | null>(null);
  const [resumeModalLoading, setResumeModalLoading] = useState(false);

  const { data: accounts, isLoading, refetch } = trpc.shopee.getAccounts.useQuery();
  const { data: authUrlData } = trpc.shopee.getAuthUrl.useQuery({
    redirectUrl: `${window.location.origin}/api/shopee/callback`,
  });
  const deactivateMutation = trpc.shopee.deactivateAccount.useMutation();
  const countItemsMutation = trpc.shopee.countItems.useMutation();
  const getResumableSyncJobMutation = trpc.shopee.getResumableSyncJob.useMutation();
  const resumeSyncJobMutation = trpc.shopee.resumeSyncJob.useMutation();
  const startSyncJobMutation = trpc.shopee.startSyncJob.useMutation();

  const { data: jobStatus } = trpc.shopee.getJobStatus.useQuery(
    { jobId: syncJobId! },
    { enabled: !!syncJobId, refetchInterval: syncJobId ? 2000 : false }
  );

  useEffect(() => {
    if (!jobStatus) return;
    if (jobStatus.status === "completed") {
      const log = jobStatus.resultLog as any;
      const total = log?.total ?? jobStatus.processedItems;
      const errors: Array<{ itemId: number; error: string }> = log?.errors ?? [];
      setSyncReport({
        accountId: syncingAccountId!,
        added: log?.added ?? 0,
        updated: log?.updated ?? 0,
        removed: log?.removed ?? 0,
        total,
        errors,
      });
      setSyncJobId(null);
      setSyncingAccountId(null);
      setSyncProgress(null);
      setShowErrorLog(false);
      refetch();
      if (errors.length > 0) {
        toast.warning(`✅ ${total} produtos importados com ${errors.length} erro(s).`);
      } else {
        toast.success(`✅ ${total.toLocaleString("pt-BR")} produtos importados com sucesso!`);
      }
    } else if (jobStatus.status === "failed") {
      toast.error(`Erro na importação: ${jobStatus.lastError}`);
      setSyncJobId(null);
      setSyncingAccountId(null);
      setSyncProgress(null);
    } else if (jobStatus.status === "processing" || jobStatus.status === "queued") {
      if (jobStatus.totalItems > 0 || jobStatus.processedItems > 0) {
        const page = jobStatus.processedItems > 0 ? Math.ceil(jobStatus.processedItems / 50) : 0;
        setSyncProgress({ current: jobStatus.processedItems, total: jobStatus.totalItems, page });
      }
    }
  }, [jobStatus]);
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

  // Called when user actually starts a fresh sync (after modal decision or no resume found)
  const startFreshSync = async (accountId: number, accountName: string) => {
    setSyncingAccountId(accountId);
    setSyncReport(null);
    setSyncProgress(null);
    setShowErrorLog(false);
    setCountPhase({ counting: true, total: null, byStatus: null });

    try {
      // Phase 1: count all item IDs on Shopee (fast, IDs only)
      const countResult = await countItemsMutation.mutateAsync({ accountId });
      setCountPhase({ counting: false, total: countResult.total, byStatus: countResult.byStatus });

      // Phase 2: start fresh background import job (cancels any incomplete jobs)
      const { jobId } = await startSyncJobMutation.mutateAsync({
        accountId,
        accountName,
        knownTotal: countResult.total,
        fresh: true,
      });
      setSyncJobId(jobId);
    } catch (error: any) {
      toast.error(`Erro ao iniciar importação: ${error.message}`);
      setSyncingAccountId(null);
      setCountPhase({ counting: false, total: null, byStatus: null });
    }
  };

  // Called when user chooses to resume a previous job
  const handleResume = async (jobId: number, accountId: number, processedItems: number, totalItems: number) => {
    setResumeModalLoading(true);
    try {
      await resumeSyncJobMutation.mutateAsync({ jobId });
      setResumeModal(null);
      setSyncingAccountId(accountId);
      setSyncReport(null);
      setShowErrorLog(false);
      // Seed the progress bar immediately from the checkpoint data
      setCountPhase({ counting: false, total: totalItems, byStatus: resumeModal?.byStatus ?? null });
      setSyncProgress({ current: processedItems, total: totalItems, page: Math.ceil(processedItems / 50) });
      setSyncJobId(jobId);
    } catch (error: any) {
      toast.error(`Erro ao retomar: ${error.message}`);
    } finally {
      setResumeModalLoading(false);
    }
  };

  const handleSync = async (accountId: number, accountName: string) => {
    // Check for a resumable job before starting
    try {
      const resumable = await getResumableSyncJobMutation.mutateAsync({ accountId });
      if (resumable && resumable.processedItems > 0 && resumable.processedItems < resumable.totalItems) {
        setResumeModal({
          accountId,
          accountName,
          jobId: resumable.jobId,
          processedItems: resumable.processedItems,
          totalItems: resumable.totalItems,
          byStatus: resumable.byStatus,
        });
        return; // wait for modal decision
      }
    } catch {
      // If check fails, just proceed with fresh sync
    }

    await startFreshSync(accountId, accountName);
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
                          variant="default"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSync(account.id, account.shopName || "");
                          }}
                          disabled={syncingAccountId === account.id}
                          className="gap-2"
                        >
                          {syncingAccountId === account.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          {syncingAccountId === account.id ? "Sincronizando..." : "🔄 Sincronizar com Shopee"}
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

                {/* ── Sync completed report ── */}
                {syncReport !== null && syncReport.accountId === account.id && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                      <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                      <div className="flex-1 text-sm">
                        <p className="font-semibold text-green-800 mb-1">
                          ✅ {syncReport.total.toLocaleString("pt-BR")} produtos importados!
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-green-700">
                          <span><strong>{syncReport.added.toLocaleString("pt-BR")}</strong> adicionados</span>
                          <span><strong>{syncReport.updated.toLocaleString("pt-BR")}</strong> atualizados</span>
                          <span><strong>{syncReport.removed.toLocaleString("pt-BR")}</strong> removidos</span>
                          {syncReport.errors.length > 0 && (
                            <span className="text-amber-700">
                              <strong>{syncReport.errors.length}</strong> com erro
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className="text-green-500 hover:text-green-700 text-lg leading-none shrink-0"
                        onClick={() => setSyncReport(null)}
                      >×</button>
                    </div>

                    {/* Error log toggle */}
                    {syncReport.errors.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                        <button
                          className="flex items-center gap-2 text-sm font-medium text-amber-800 w-full text-left"
                          onClick={() => setShowErrorLog((v) => !v)}
                        >
                          <XCircle className="h-4 w-4 text-amber-600 shrink-0" />
                          {showErrorLog ? "Ocultar" : "Ver"} log de erros ({syncReport.errors.length})
                          <span className="ml-auto text-amber-500">{showErrorLog ? "▲" : "▼"}</span>
                        </button>
                        {showErrorLog && (
                          <div className="mt-3 max-h-48 overflow-y-auto space-y-1">
                            {syncReport.errors.map((err) => (
                              <div key={err.itemId} className="text-xs text-amber-900 font-mono bg-amber-100 rounded px-2 py-1">
                                <span className="font-semibold">ID {err.itemId}:</span> {err.error}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── In-progress sync indicator ── */}
                {syncingAccountId === account.id && (
                  <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 space-y-3">
                    {/* Phase 1: counting */}
                    {countPhase.counting && (
                      <div className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 text-orange-500 animate-spin shrink-0" />
                        <p className="text-sm text-orange-800 font-medium">
                          Contando produtos na Shopee...
                        </p>
                      </div>
                    )}

                    {/* Phase 1 done: show count, waiting for worker */}
                    {!countPhase.counting && countPhase.total !== null && !syncProgress && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                          <p className="text-sm text-orange-800 font-medium">
                            Total encontrado na Shopee:{" "}
                            <strong>{countPhase.total.toLocaleString("pt-BR")} produtos</strong>
                          </p>
                        </div>
                        {countPhase.byStatus && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-orange-700 pl-8">
                            {Object.entries(countPhase.byStatus).map(([status, count]) => (
                              <span key={status}>
                                <strong>{count.toLocaleString("pt-BR")}</strong> {status}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-3 pl-0">
                          <Loader2 className="h-4 w-4 text-orange-400 animate-spin shrink-0" />
                          <p className="text-xs text-orange-600">Aguardando worker iniciar importação...</p>
                        </div>
                      </div>
                    )}

                    {/* Phase 2: active import with progress */}
                    {syncProgress && syncProgress.total > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Loader2 className="h-5 w-5 text-orange-500 animate-spin shrink-0" />
                            <p className="text-sm text-orange-800 font-medium">
                              Importando...{" "}
                              <strong>
                                {syncProgress.current.toLocaleString("pt-BR")}/
                                {syncProgress.total.toLocaleString("pt-BR")}
                              </strong>{" "}
                              produtos
                            </p>
                          </div>
                          <span className="text-sm font-bold text-orange-700">
                            {Math.round((syncProgress.current / syncProgress.total) * 100)}%
                          </span>
                        </div>
                        <Progress
                          value={(syncProgress.current / syncProgress.total) * 100}
                          className="h-3"
                        />
                        <p className="text-xs text-orange-600 text-right">
                          Lote {syncProgress.page} · {syncProgress.current.toLocaleString("pt-BR")} processados
                        </p>
                      </div>
                    )}
                  </div>
                )}
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

      {/* Brand Sync Card */}
      {selectedAccountId && (
        <BrandSyncCard accountId={selectedAccountId} />
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

      {/* ── Resume / Fresh-Start modal ── */}
      <Dialog open={!!resumeModal} onOpenChange={(open) => { if (!open) setResumeModal(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importação incompleta encontrada</DialogTitle>
            <DialogDescription>
              Uma importação anterior foi interrompida. Deseja continuar de onde parou ou começar do zero?
            </DialogDescription>
          </DialogHeader>

          {resumeModal && (
            <div className="space-y-3 py-2">
              {/* Progress snapshot */}
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 space-y-2">
                <div className="flex justify-between text-sm font-medium text-orange-800">
                  <span>Progresso salvo</span>
                  <span>
                    {resumeModal.processedItems.toLocaleString("pt-BR")}/
                    {resumeModal.totalItems.toLocaleString("pt-BR")} produtos
                  </span>
                </div>
                <Progress
                  value={(resumeModal.processedItems / resumeModal.totalItems) * 100}
                  className="h-2"
                />
                <p className="text-xs text-orange-600 text-right">
                  {Math.round((resumeModal.processedItems / resumeModal.totalItems) * 100)}% concluído
                </p>
                {Object.keys(resumeModal.byStatus).length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-orange-700">
                    {Object.entries(resumeModal.byStatus).map(([status, count]) => (
                      <span key={status}>
                        <strong>{(count as number).toLocaleString("pt-BR")}</strong> {status}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Remaining count hint */}
              <p className="text-xs text-muted-foreground text-center">
                Faltam{" "}
                <strong>
                  {(resumeModal.totalItems - resumeModal.processedItems).toLocaleString("pt-BR")}
                </strong>{" "}
                produtos para completar.
              </p>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              disabled={resumeModalLoading}
              onClick={() => {
                setResumeModal(null);
                if (resumeModal) startFreshSync(resumeModal.accountId, resumeModal.accountName);
              }}
            >
              🔄 Começar do zero
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={resumeModalLoading}
              onClick={() => {
                if (resumeModal) {
                  handleResume(
                    resumeModal.jobId,
                    resumeModal.accountId,
                    resumeModal.processedItems,
                    resumeModal.totalItems
                  );
                }
              }}
            >
              {resumeModalLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "▶️"
              )}{" "}
              Continuar de onde parou
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function formatRelative(date: Date | string | null): string {
  if (!date) return "nunca";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "agora há pouco";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days === 1 ? "" : "s"}`;
}

function BrandSyncCard({ accountId }: { accountId: number }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: status, refetch, isFetching } = trpc.shopee.getBrandSyncStatus.useQuery(
    { accountId },
    { refetchInterval: 5000 },
  );
  const syncMutation = trpc.shopee.syncAllBrandsForAccount.useMutation();

  const total = status?.totalCategories ?? 0;
  const done = status?.doneCategories ?? 0;
  const inProgress = status?.inProgressCount ?? 0;
  const pending = status?.pendingCount ?? 0;
  const errors = status?.errorCount ?? 0;
  const isRunning = status?.isRunning ?? false;
  const cachedBrands = status?.totalCachedBrands ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const handleStart = async () => {
    setConfirmOpen(false);
    try {
      const result = await syncMutation.mutateAsync({ accountId });
      if (!result.jobStarted) {
        toast.info("Nenhuma categoria precisa de sincronização agora.");
      } else {
        toast.success(
          `Iniciado: ${result.totalCategories} categoria(s) na fila.${
            result.skipped ? ` ${result.skipped} já estavam atualizadas.` : ""
          }`,
        );
      }
      refetch();
    } catch (err: any) {
      toast.error(`Erro ao iniciar: ${err?.message ?? err}`);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <Tag className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Cache de Marcas Shopee</CardTitle>
                <CardDescription>
                  Sincroniza a lista de marcas (get_brand_list) por categoria. Cache de 24h.
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                Atualizar status
              </Button>
              <Button
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={isRunning || syncMutation.isPending}
                className="gap-2"
              >
                {isRunning || syncMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Sincronizar todas as marcas
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Categorias usadas</span>
              <p className="font-medium">{total}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Sincronizadas</span>
              <p className="font-medium">
                {done}/{total} ({percent}%)
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Marcas em cache</span>
              <p className="font-medium">{cachedBrands.toLocaleString("pt-BR")}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Última sincronização</span>
              <p className="font-medium">{formatRelative(status?.lastSyncedAt ?? null)}</p>
            </div>
          </div>

          {total > 0 && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Progresso</span>
                <span>{percent}%</span>
              </div>
              <Progress value={percent} className="h-2" />
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            {isRunning ? (
              <Badge variant="secondary" className="bg-orange-100 text-orange-800 gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Sincronizando ({inProgress} em curso, {pending} na fila)
              </Badge>
            ) : errors > 0 ? (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 gap-1">
                <AlertTriangle className="h-3 w-3" />
                Erro em {errors} categoria{errors === 1 ? "" : "s"}
              </Badge>
            ) : done > 0 ? (
              <Badge variant="secondary" className="bg-green-100 text-green-800 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Pronto
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-gray-100 text-gray-700">
                Nunca sincronizado
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sincronizar todas as marcas?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai chamar a API Shopee para cada categoria usada pelos seus produtos
              ({total} no total). Pode levar até 2 horas dependendo do volume. As
              marcas já em cache (menos de 24h) serão puladas. Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleStart}>Sincronizar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
