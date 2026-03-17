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
  User,
  Store,
  Globe,
} from "lucide-react";

export default function TikTokAccounts() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const connected = params.get("connected");
  const error = params.get("error");

  const [deleteAccountId, setDeleteAccountId] = useState<number | null>(null);

  const { data: accounts, isLoading, refetch } = trpc.tiktok.accounts.useQuery();
  const { data: authUrlData } = trpc.tiktok.getAuthUrl.useQuery({ region: "GLOBAL" });
  const disconnectMutation = trpc.tiktok.disconnect.useMutation();

  // Handle OAuth callback params
  useEffect(() => {
    if (connected === "true") {
      toast.success("Conta do TikTok Shop conectada com sucesso!");
      refetch();
      window.history.replaceState({}, "", "/tiktok-accounts");
    }
    if (error) {
      toast.error(`Erro ao conectar: ${decodeURIComponent(error)}`);
      window.history.replaceState({}, "", "/tiktok-accounts");
    }
  }, [connected, error, refetch]);

  const handleConnect = () => {
    if (authUrlData?.url) {
      window.location.href = authUrlData.url;
    } else {
      toast.error("Credenciais do TikTok Shop não configuradas. Configure o App Key e App Secret primeiro.");
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
      await disconnectMutation.mutateAsync({ accountId: deleteAccountId });
      toast.success("Conta removida");
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
          <h1 className="text-2xl font-bold tracking-tight">Contas do TikTok Shop</h1>
          <p className="text-muted-foreground mt-1">
            Conecte suas contas do TikTok Shop para publicar produtos diretamente via API.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={handleConnect}>
            <Plus className="h-4 w-4 mr-2" />
            Conectar Conta
          </Button>
        </div>
      </div>

      {/* Info Card */}
      <Card className="border-pink-200 bg-pink-50/50">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <ShieldCheck className="h-5 w-5 text-pink-600 mt-0.5 shrink-0" />
            <div className="text-sm text-pink-800">
              <p className="font-medium mb-1">Como funciona a conexão?</p>
              <p>
                Ao clicar em "Conectar Conta", você será redirecionado para o TikTok Shop para autorizar
                o acesso. Após autorizar, seus tokens de acesso serão salvos de forma segura. Você pode
                conectar múltiplas contas e publicar produtos em qualquer uma delas.
              </p>
              <p className="mt-2 font-medium">
                Pré-requisito: Você precisa ter uma conta de vendedor ativa no TikTok Shop.
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
              Conecte sua primeira conta do TikTok Shop para começar a publicar produtos diretamente
              pela API.
            </p>
            <Button onClick={handleConnect}>
              <Plus className="h-4 w-4 mr-2" />
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
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center">
                      <span className="text-xl font-bold text-white">TT</span>
                    </div>
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {account.sellerName || account.shopName || `TikTok ${account.ttOpenId.substring(0, 8)}...`}
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
                        Open ID: {account.ttOpenId.substring(0, 16)}...
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
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Região
                    </span>
                    <p className="font-medium">{account.sellerBaseRegion || account.shopRegion || "N/A"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Store className="h-3 w-3" /> Loja
                    </span>
                    <p className="font-medium">{account.shopName || "Não vinculada"}</p>
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
              reconectar a conta se quiser usá-la novamente. Os produtos já publicados no TikTok
              Shop não serão afetados.
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
