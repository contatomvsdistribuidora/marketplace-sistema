import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Trash2, ShoppingCart, CheckCircle2, XCircle, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";

export default function AmazonAccounts() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [sellerId, setSellerId] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [marketplace, setMarketplace] = useState("BR");

  const { data: accounts, isLoading, refetch } = trpc.amazon.getAccounts.useQuery();
  const { data: marketplaces } = trpc.amazon.getMarketplaces.useQuery();

  const connectMutation = trpc.amazon.connectManual.useMutation({
    onSuccess: () => {
      toast.success("Conta Amazon conectada com sucesso!");
      setShowAddDialog(false);
      setSellerId("");
      setRefreshToken("");
      setSellerName("");
      refetch();
    },
    onError: (err) => {
      toast.error(`Erro ao conectar: ${err.message}`);
    },
  });

  const disconnectMutation = trpc.amazon.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Conta desconectada");
      refetch();
    },
    onError: (err) => {
      toast.error(`Erro ao desconectar: ${err.message}`);
    },
  });

  const handleConnect = () => {
    if (!sellerId.trim() || !refreshToken.trim()) {
      toast.error("Seller ID e Refresh Token são obrigatórios");
      return;
    }
    connectMutation.mutate({
      sellerId: sellerId.trim(),
      refreshToken: refreshToken.trim(),
      sellerName: sellerName.trim() || undefined,
      marketplace,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contas Amazon</h1>
          <p className="text-muted-foreground">Gerencie suas contas de vendedor na Amazon</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Conectar Conta
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Conectar Conta Amazon</DialogTitle>
              <DialogDescription>
                Para conectar sua conta Amazon, você precisa das credenciais de Self-Authorization do Seller Central.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Como obter as credenciais:</p>
                    <ol className="mt-1 list-decimal pl-4 space-y-1 text-xs">
                      <li>Acesse o <a href="https://sellercentral.amazon.com.br" target="_blank" rel="noopener" className="underline">Seller Central</a></li>
                      <li>Vá em <strong>Apps & Services → Develop Apps</strong></li>
                      <li>Autorize o app e copie o <strong>Refresh Token</strong></li>
                      <li>O <strong>Seller ID</strong> está em Settings → Account Info</li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sellerName">Nome da Conta (opcional)</Label>
                <Input
                  id="sellerName"
                  placeholder="Ex: Minha Loja Amazon"
                  value={sellerName}
                  onChange={(e) => setSellerName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sellerId">Seller ID *</Label>
                <Input
                  id="sellerId"
                  placeholder="Ex: A1B2C3D4E5F6G7"
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="refreshToken">Refresh Token *</Label>
                <Textarea
                  id="refreshToken"
                  placeholder="Atzr|..."
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="marketplace">Marketplace</Label>
                <Select value={marketplace} onValueChange={setMarketplace}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {marketplaces?.map((mp) => (
                      <SelectItem key={mp.code} value={mp.code}>
                        {mp.name} ({mp.domain})
                      </SelectItem>
                    )) || (
                      <>
                        <SelectItem value="BR">Amazon Brasil (amazon.com.br)</SelectItem>
                        <SelectItem value="US">Amazon US (amazon.com)</SelectItem>
                        <SelectItem value="MX">Amazon México (amazon.com.mx)</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleConnect}
                disabled={connectMutation.isPending}
                className="gap-2"
              >
                {connectMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="h-4 w-4" />
                )}
                Conectar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Status Banner */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <ShoppingCart className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">Integração Amazon SP-API</p>
              <p className="mt-1">
                Para usar a integração com a Amazon, você precisa ter uma conta de vendedor ativa e
                um app registrado no Seller Central com as credenciais LWA (Login with Amazon).
                Após obter a autorização, insira o Seller ID e Refresh Token abaixo.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts List */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-1/3 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-4 bg-muted rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : accounts && accounts.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((account) => (
            <Card key={account.id} className={!account.isActive ? "opacity-60" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5 text-orange-500" />
                    <CardTitle className="text-lg">
                      {account.sellerName || account.sellerId}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    {account.isActive ? (
                      <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Ativa
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
                        <XCircle className="h-3 w-3 mr-1" />
                        Inativa
                      </Badge>
                    )}
                  </div>
                </div>
                <CardDescription>
                  {account.marketplaceName}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Seller ID:</span>
                    <span className="font-mono text-xs">{account.sellerId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Token:</span>
                    <span>
                      {account.tokenValid ? (
                        <Badge variant="outline" className="text-green-600 text-xs">Válido</Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 text-xs">Expirado (auto-renova)</Badge>
                      )}
                    </span>
                  </div>
                  {account.lastUsedAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Último uso:</span>
                      <span>{new Date(account.lastUsedAt).toLocaleDateString("pt-BR")}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Conectada em:</span>
                    <span>{new Date(account.createdAt).toLocaleDateString("pt-BR")}</span>
                  </div>
                </div>

                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1"
                    onClick={() => window.open(`https://${account.marketplaceName?.includes("Brasil") ? "sellercentral.amazon.com.br" : "sellercentral.amazon.com"}`, "_blank")}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Seller Central
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive gap-1"
                    onClick={() => {
                      if (confirm("Deseja desconectar esta conta?")) {
                        disconnectMutation.mutate({ accountId: account.id });
                      }
                    }}
                    disabled={disconnectMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                    Desconectar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShoppingCart className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">Nenhuma conta conectada</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Conecte sua conta de vendedor da Amazon para começar a exportar produtos.
              Você precisará do Seller ID e Refresh Token do Seller Central.
            </p>
            <Button className="mt-4 gap-2" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4" />
              Conectar Primeira Conta
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
