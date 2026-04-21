import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Key, Database, Loader2, Trash2, Sparkles, Zap, CheckCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const AI_PROVIDERS = [
  { value: "anthropic", label: "Anthropic Claude",   model: "claude-sonnet-4-20250514", color: "bg-purple-100 text-purple-700 border-purple-300" },
  { value: "groq",      label: "Groq (Gratuito)",    model: "llama-3.3-70b-versatile",  color: "bg-green-100 text-green-700 border-green-300"   },
  { value: "openai",    label: "OpenAI GPT",         model: "gpt-4o-mini",              color: "bg-blue-100 text-blue-700 border-blue-300"       },
  { value: "gemini",    label: "Google Gemini",      model: "gemini-2.0-flash-lite",    color: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  { value: "forge",     label: "Forge (interno)",    model: "gemini-2.5-flash",         color: "bg-gray-100 text-gray-700 border-gray-300"       },
] as const;

export default function SettingsPage() {
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // ── AI Provider state ──
  const [aiProvider, setAiProvider] = useState("");
  const [aiApiKey, setAiApiKey]     = useState("");
  const [testResult, setTestResult] = useState<"idle"|"loading"|"ok"|"error">("idle");

  const utils = trpc.useUtils();
  const { data: tokenData, isLoading: tokenLoading } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const { data: aiConfig, isLoading: aiLoading } = trpc.settings.getAiConfig.useQuery();

  const setAiConfigMutation  = trpc.settings.setAiConfig.useMutation({
    onSuccess: () => {
      toast.success("Configuração de IA salva!");
      setAiApiKey("");
      utils.settings.getAiConfig.invalidate();
    },
    onError: (err) => toast.error(err.message || "Erro ao salvar"),
  });
  const testAiMutation = trpc.settings.testAiConnection.useMutation({
    onSuccess: (data) => {
      setTestResult("ok");
      toast.success(`Conexão OK! Resposta: "${data.response}"`);
    },
    onError: (err) => {
      setTestResult("error");
      toast.error(`Falha: ${err.message}`);
    },
  });
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

  const activeProviderInfo = AI_PROVIDERS.find(p => p.value === aiConfig?.activeProvider);
  const selectedProviderInfo = AI_PROVIDERS.find(p => p.value === (aiProvider || aiConfig?.savedProvider || aiConfig?.activeProvider));

  async function handleTestAi() {
    const provider = (aiProvider || aiConfig?.savedProvider || aiConfig?.activeProvider) as any;
    if (!provider || (!aiApiKey && !aiConfig?.hasKey)) {
      toast.error("Selecione um provedor e insira a API Key");
      return;
    }
    if (!aiApiKey && aiConfig?.hasKey) {
      toast.info("Para testar insira a API Key novamente (não armazenamos em texto claro)");
      return;
    }
    setTestResult("loading");
    await testAiMutation.mutateAsync({ provider, apiKey: aiApiKey });
  }

  async function handleSaveAi() {
    const provider = (aiProvider || aiConfig?.savedProvider) as any;
    if (!provider) { toast.error("Selecione um provedor"); return; }
    if (!aiApiKey)  { toast.error("Insira a API Key"); return; }
    await setAiConfigMutation.mutateAsync({ provider, apiKey: aiApiKey });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">Gerencie sua conexão com o BaseLinker e provedores de IA</p>
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

      {/* ── Configurações de IA ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <CardTitle>Configurações de IA</CardTitle>
                <CardDescription>Provedor de inteligência artificial para geração de conteúdo</CardDescription>
              </div>
            </div>
            {activeProviderInfo && (
              <Badge className={`text-xs border ${activeProviderInfo.color}`}>
                <Zap className="h-3 w-3 mr-1" /> {activeProviderInfo.label} ativo
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {aiLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : (
            <>
              {/* Status env vars */}
              {aiConfig && (
                <div className="flex flex-wrap gap-2">
                  {AI_PROVIDERS.filter(p => p.value !== "forge").map(p => {
                    const hasEnv = aiConfig.envKeys[p.value as keyof typeof aiConfig.envKeys];
                    return (
                      <span key={p.value} className={`text-xs px-2 py-1 rounded-full border font-medium ${hasEnv ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-400 border-gray-200"}`}>
                        {hasEnv ? "✓" : "○"} {p.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Seletor de provedor */}
              <div className="space-y-2">
                <Label>Provedor de IA</Label>
                <Select
                  value={aiProvider || aiConfig?.savedProvider || aiConfig?.activeProvider || ""}
                  onValueChange={v => { setAiProvider(v); setTestResult("idle"); }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um provedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_PROVIDERS.map(p => (
                      <SelectItem key={p.value} value={p.value}>
                        <div className="flex items-center gap-2">
                          <span>{p.label}</span>
                          <span className="text-xs text-muted-foreground">({p.model})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProviderInfo && (
                  <p className="text-xs text-muted-foreground">
                    Modelo: <b>{selectedProviderInfo.model}</b>
                  </p>
                )}
              </div>

              {/* Campo API Key */}
              <div className="space-y-2">
                <Label>
                  API Key
                  {aiConfig?.hasKey && <span className="ml-2 text-xs text-green-600 font-normal">✓ Key salva ({aiConfig.maskedApiKey})</span>}
                </Label>
                <Input
                  type="password"
                  placeholder={aiConfig?.hasKey ? "Cole nova key para substituir..." : "Cole sua API Key aqui..."}
                  value={aiApiKey}
                  onChange={e => { setAiApiKey(e.target.value); setTestResult("idle"); }}
                />
                <p className="text-xs text-muted-foreground">
                  {(aiProvider || aiConfig?.savedProvider) === "groq" && "Obtenha gratuitamente em console.groq.com"}
                  {(aiProvider || aiConfig?.savedProvider) === "anthropic" && "Disponível em console.anthropic.com"}
                  {(aiProvider || aiConfig?.savedProvider) === "openai" && "Disponível em platform.openai.com"}
                  {(aiProvider || aiConfig?.savedProvider) === "gemini" && "Disponível em aistudio.google.com"}
                </p>
              </div>

              {/* Botões */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={handleTestAi}
                  disabled={testAiMutation.isPending}
                  className="flex items-center gap-2"
                >
                  {testAiMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : testResult === "ok" ? (
                    <CheckCheck className="h-4 w-4 text-green-600" />
                  ) : testResult === "error" ? (
                    <XCircle className="h-4 w-4 text-red-500" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  {testResult === "ok" ? "Conexão OK!" : testResult === "error" ? "Falhou" : "Testar conexão"}
                </Button>

                <Button
                  onClick={handleSaveAi}
                  disabled={setAiConfigMutation.isPending || !aiApiKey}
                  className="flex items-center gap-2"
                >
                  {setAiConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Salvar
                </Button>
              </div>

              {/* Informações sobre os provedores */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t">
                {AI_PROVIDERS.filter(p => ["anthropic","groq","openai"].includes(p.value)).map(p => (
                  <div key={p.value} className={`rounded-lg border p-3 ${p.color}`}>
                    <p className="text-xs font-bold">{p.label}</p>
                    <p className="text-xs opacity-75 mt-0.5">{p.model}</p>
                    {p.value === "groq" && <p className="text-xs font-medium mt-1">Gratuito ✓</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
