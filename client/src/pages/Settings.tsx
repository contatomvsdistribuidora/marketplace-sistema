import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Key, Database, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function SettingsPage() {
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const utils = trpc.useUtils();
  const { data: tokenData, isLoading: tokenLoading } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const { data: inventories, isLoading: invLoading } = trpc.baselinker.getInventories.useQuery(undefined, {
    enabled: !!tokenData?.hasToken,
  });

  const setTokenMutation = trpc.settings.setToken.useMutation({
    onSuccess: () => {
      toast.success("Token salvo e validado com sucesso!");
      setToken("");
      utils.settings.getToken.invalidate();
      utils.baselinker.getInventories.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao salvar token");
    },
  });

  const removeTokenMutation = trpc.settings.removeToken.useMutation({
    onSuccess: () => {
      toast.success("Token removido");
      utils.settings.getToken.invalidate();
    },
  });

  const setInventoryMutation = trpc.settings.setInventoryId.useMutation({
    onSuccess: () => {
      toast.success("Inventário padrão salvo!");
      utils.settings.getInventoryId.invalidate();
    },
  });

  const handleSaveToken = async () => {
    if (!token.trim()) {
      toast.error("Insira um token válido");
      return;
    }
    setIsSaving(true);
    try {
      await setTokenMutation.mutateAsync({ token: token.trim() });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">Gerencie sua conexão com o BaseLinker</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Token da API BaseLinker</CardTitle>
              <CardDescription>
                Encontre seu token em: BaseLinker → Minha Conta → API
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {tokenLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : tokenData?.hasToken ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">Token configurado</p>
                  <p className="text-xs text-green-600 dark:text-green-400 font-mono">{tokenData.maskedToken}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTokenMutation.mutate()}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="border-t pt-4">
                <Label className="text-sm font-medium">Atualizar Token</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="password"
                    placeholder="Cole o novo token aqui..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <Button onClick={handleSaveToken} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                <XCircle className="h-5 w-5 text-amber-600" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Nenhum token configurado. Configure para começar a usar o app.
                </p>
              </div>
              <div>
                <Label className="text-sm font-medium">Token da API</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="password"
                    placeholder="Cole seu token do BaseLinker aqui..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveToken()}
                  />
                  <Button onClick={handleSaveToken} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  O token será validado automaticamente antes de ser salvo.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {tokenData?.hasToken && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Inventário Padrão</CardTitle>
                <CardDescription>
                  Selecione o catálogo/inventário do BaseLinker que deseja usar
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {invLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando inventários...
              </div>
            ) : (
              <div className="space-y-3">
                <Select
                  value={inventoryData?.inventoryId?.toString() || ""}
                  onValueChange={(val) => setInventoryMutation.mutate({ inventoryId: parseInt(val) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione um inventário" />
                  </SelectTrigger>
                  <SelectContent>
                    {(inventories || []).map((inv: any) => (
                      <SelectItem key={inv.inventory_id} value={String(inv.inventory_id)}>
                        {inv.name} ({inv.inventory_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {inventoryData?.inventoryId && (
                  <Badge variant="secondary" className="text-xs">
                    Inventário ativo: {inventoryData.inventoryId}
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
