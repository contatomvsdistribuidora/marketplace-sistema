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
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  Clock,
  User,
} from "lucide-react";

export default function MlAccounts() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const mlConnected = params.get("ml_connected");
  const mlError = params.get("ml_error");

  const [deleteAccountId, setDeleteAccountId] = useState<number | null>(null);

  const { data: accounts, isLoading, refetch } = trpc.ml.accounts.useQuery();
  const getAuthUrl = trpc.ml.getAuthUrl.useMutation();
  const disconnectMutation = trpc.ml.disconnect.useMutation();
  const deleteMutation = trpc.ml.deleteAccount.useMutation();

  // Handle OAuth callback params
  useEffect(() => {
    if (mlConnected === "true") {
      toast.success("Conta do Mercado Livre conectada com sucesso!");
      refetch();
      // Clean URL
      window.history.replaceState({}, "", "/ml-accounts");
    }
    if (mlError) {
      toast.error(`Erro ao conectar: ${decodeURIComponent(mlError)}`);
      window.history.replaceState({}, "", "/ml-accounts");
    }
  }, [mlConnected, mlError, refetch]);

  const handleConnect = async () => {
    try {
      const result = await getAuthUrl.mutateAsync({
        origin: window.location.origin,
      });
      // Redirect to ML authorization page
      window.location.href = result.authUrl;
    } catch (error: any) {
      toast.error(`Erro ao gerar URL de autorização: ${error.message}`);
    }
  };

  const handleDisconnect = async (accountId: number) => {
    try {
      await disconnectMutation.mutateAsync({ accountId });
      toast.success("Conta desconectada");
      refetch();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
    }
  };

  const handleDelete = async () => {
    if (!deleteAccountId) return;
    try {
      await deleteMutation.mutateAsync({ accountId: deleteAccountId });
      toast.success("Conta removida permanentemente");
      setDeleteAccountId(null);
      refetch();
    } catch (error: any) {
      toast.error(`Erro: ${error.message}`);
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
          <h1 className="text-2xl font-bold tracking-tight">Contas do Mercado Livre</h1>
          <p className="text-muted-foreground mt-1">
            Conecte suas contas do Mercado Livre para publicar anúncios diretamente via API.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={handleConnect} disabled={getAuthUrl.isPending}>
            {getAuthUrl.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Conectar Conta
          </Button>
        </div>
      </div>

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <ShieldCheck className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Como funciona a conexão?</p>
              <p>
                Ao clicar em "Conectar Conta", você será redirecionado para o Mercado Livre para autorizar
                o acesso. Após autorizar, seus tokens de acesso serão salvos de forma segura. Você pode
                conectar múltiplas contas e publicar anúncios em qualquer uma delas.
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
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Nenhuma conta conectada</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Conecte sua primeira conta do Mercado Livre para começar a publicar anúncios diretamente
              pela API, sem precisar do BaseLinker como intermediário.
            </p>
            <Button onClick={handleConnect} disabled={getAuthUrl.isPending}>
              {getAuthUrl.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Conectar Primeira Conta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {accounts.map((account: any) => (
            <Card key={account.id} className={!account.isActive ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-yellow-100 flex items-center justify-center">
                      <span className="text-xl font-bold text-yellow-700">ML</span>
                    </div>
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {account.nickname || `ML User ${account.mlUserId}`}
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
                        {account.isTokenExpired && account.isActive && (
                          <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                            <Clock className="h-3 w-3 mr-1" />
                            Token Expirado
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>
                        {account.email || `ID: ${account.mlUserId}`} | Site: {account.siteId}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {account.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisconnect(account.id)}
                        disabled={disconnectMutation.isPending}
                      >
                        Desconectar
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteAccountId(account.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">ML User ID</span>
                    <p className="font-medium">{account.mlUserId}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Token Expira</span>
                    <p className="font-medium">{formatDate(account.tokenExpiresAt)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Último Uso</span>
                    <p className="font-medium">{formatDate(account.lastUsedAt)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Conectada em</span>
                    <p className="font-medium">{formatDate(account.createdAt)}</p>
                  </div>
                </div>
                {!account.isActive && (
                  <div className="mt-4 p-3 rounded-lg bg-orange-50 border border-orange-200">
                    <p className="text-sm text-orange-800">
                      Esta conta está inativa. O token pode ter expirado ou sido revogado.
                      Reconecte a conta para continuar usando.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={handleConnect}
                    >
                      Reconectar
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteAccountId !== null} onOpenChange={() => setDeleteAccountId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover conta permanentemente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Os tokens de acesso serão removidos e você precisará
              reconectar a conta se quiser usá-la novamente. Os anúncios já publicados no Mercado
              Livre não serão afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
