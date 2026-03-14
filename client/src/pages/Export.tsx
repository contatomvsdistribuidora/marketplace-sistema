import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Upload, Store, Loader2, Sparkles, CheckCircle, XCircle, AlertCircle,
  ArrowRight, ArrowLeft, Package, Edit3, Save, Info, Link2, RefreshCw
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

type ExportStep = "select" | "mapping" | "review" | "exporting" | "done";

interface MappedProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  features: Record<string, string>;
  ean?: string;
  sku?: string;
  mainPrice?: number;
  totalStock?: number;
  imageUrl?: string;
  suggestedCategory?: { id: string; name: string; path: string; confidence: number };
  suggestedAttributes?: { attributeName: string; attributeId: string; value: string; confidence: number; source: string }[];
  status: "pending" | "mapped" | "error";
  errorMessage?: string;
}

// Flattened integration account for display
interface IntegrationAccount {
  integrationCode: string;
  integrationLabel: string;
  accountId: string;
  accountName: string;
  langs: string[];
}

// Map BaseLinker marketplace type codes to readable names
const MARKETPLACE_TYPE_NAMES: Record<string, string> = {
  shop: "Loja Virtual",
  blconnect: "BL Connect",
  amazon: "Amazon",
  americanas: "Americanas",
  omnik: "Omnik",
  shopeebr: "Shopee",
  carrefourbr: "Carrefour",
  kabum: "KaBuM!",
  leroymerlinbr: "Leroy Merlin",
  madeiramadeira: "Madeira Madeira",
  magaluopenapi: "Magazine Luiza",
  webcontinental: "Webcontinental",
  olist: "Olist",
  shein: "Shein",
  viavarejo: "Via Varejo",
  melibr: "Mercado Livre",
  mercadolivre: "Mercado Livre",
  shopee: "Shopee",
  magalu: "Magazine Luiza",
};

export default function ExportPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<ExportStep>("select");
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>("");
  const [selectedAccount, setSelectedAccount] = useState<string>(""); // "integrationCode:accountId"
  const [mappedProducts, setMappedProducts] = useState<MappedProduct[]>([]);
  const [mappingProgress, setMappingProgress] = useState(0);
  const [isMappingInProgress, setIsMappingInProgress] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportJobId, setExportJobId] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [preSelectedIds, setPreSelectedIds] = useState<number[]>([]);
  const [preSelectedTag, setPreSelectedTag] = useState<string>("");

  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;

  const { data: marketplaces } = trpc.marketplaces.list.useQuery();

  // Fetch marketplace integrations (Mercado Livre, Amazon, Shopee, etc.)
  const { data: integrationsData, isLoading: integrationsLoading, refetch: refetchIntegrations } = trpc.baselinker.getIntegrations.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!tokenData?.hasToken && !!inventoryId }
  );

  // Search filter for accounts
  const [accountSearch, setAccountSearch] = useState("");

  // Flatten marketplace accounts from getOrderSources into a list
  const allAccounts = useMemo<IntegrationAccount[]>(() => {
    if (!integrationsData) return [];
    const accounts: IntegrationAccount[] = [];

    // Process accounts from getOrderSources (the correct API method)
    // integrationsData.accounts is already parsed by the server
    if (integrationsData.accounts && Array.isArray(integrationsData.accounts)) {
      for (const acc of integrationsData.accounts) {
        accounts.push({
          integrationCode: acc.marketplaceType,
          integrationLabel: MARKETPLACE_TYPE_NAMES[acc.marketplaceType] || acc.marketplaceName || formatIntegrationName(acc.marketplaceType),
          accountId: acc.id, // e.g. "melibr_16544"
          accountName: acc.name,
          langs: [],
        });
      }
    }

    return accounts;
  }, [integrationsData]);

  // Filter accounts by search
  const displayedAccounts = useMemo(() => {
    if (!accountSearch) return allAccounts;
    const search = accountSearch.toLowerCase();
    return allAccounts.filter(a =>
      a.accountName.toLowerCase().includes(search) ||
      a.integrationLabel.toLowerCase().includes(search) ||
      a.accountId.toLowerCase().includes(search) ||
      a.integrationCode.toLowerCase().includes(search)
    );
  }, [allAccounts, accountSearch]);

  // Get selected account info
  const selectedAccountInfo = useMemo(() => {
    if (!selectedAccount) return null;
    return allAccounts.find(a => `${a.integrationCode}:${a.accountId}` === selectedAccount) || null;
  }, [selectedAccount, allAccounts]);

  // Load pre-selected product IDs from sessionStorage
  useEffect(() => {
    const storedIds = sessionStorage.getItem("export_product_ids");
    const storedTag = sessionStorage.getItem("export_tag");
    if (storedIds) {
      try {
        const ids = JSON.parse(storedIds) as string[];
        setPreSelectedIds(ids.map(id => parseInt(id)).filter(id => !isNaN(id)));
      } catch (e) {
        console.error("Error parsing stored product IDs:", e);
      }
    }
    if (storedTag) {
      setPreSelectedTag(storedTag);
    }
  }, []);

  // Fetch pre-selected products from cache
  const { data: preSelectedProducts, isLoading: preSelectedLoading } = trpc.baselinker.getProductsByIds.useQuery(
    { inventoryId: inventoryId!, productIds: preSelectedIds },
    { enabled: !!inventoryId && preSelectedIds.length > 0 }
  );

  // Auto-populate mapped products from pre-selected products
  useEffect(() => {
    if (preSelectedProducts && preSelectedProducts.length > 0 && mappedProducts.length === 0) {
      setMappedProducts(
        preSelectedProducts.map((p: any) => ({
          id: String(p.id),
          name: p.name || "",
          description: p.description || "",
          category: String(p.categoryId || ""),
          features: {},
          ean: p.ean || "",
          sku: p.sku || "",
          mainPrice: p.mainPrice || 0,
          totalStock: p.totalStock || 0,
          imageUrl: p.imageUrl || "",
          status: "pending" as const,
        }))
      );
      sessionStorage.removeItem("export_product_ids");
      sessionStorage.removeItem("export_tag");
    }
  }, [preSelectedProducts]);

  const mapCategoryMutation = trpc.ai.mapCategory.useMutation();
  const fillAttributesMutation = trpc.ai.fillAttributes.useMutation();
  const createExportMutation = trpc.exports.create.useMutation();
  const updateExportMutation = trpc.exports.updateStatus.useMutation();
  const addLogMutation = trpc.exports.addLog.useMutation();

  const handleStartMapping = async () => {
    if (!selectedMarketplace) {
      toast.error("Selecione um marketplace de destino");
      return;
    }
    if (!selectedAccount) {
      toast.error("Selecione a conta/integração de destino");
      return;
    }
    if (mappedProducts.length === 0) {
      toast.error("Nenhum produto selecionado para exportar");
      return;
    }

    setIsMappingInProgress(true);
    setStep("mapping");
    setMappingProgress(0);

    const marketplace = (marketplaces || []).find((m: any) => m.id.toString() === selectedMarketplace);
    const marketplaceName = marketplace?.name || "Marketplace";
    const accountName = selectedAccountInfo?.accountName || "";

    for (let i = 0; i < mappedProducts.length; i++) {
      const product = mappedProducts[i];
      try {
        const categorySuggestions = await mapCategoryMutation.mutateAsync({
          product: {
            name: product.name,
            description: product.description,
            features: product.features,
            category: product.category,
            ean: product.ean,
            sku: product.sku,
          },
          marketplace: `${marketplaceName} (${accountName})`,
          availableCategories: [],
        });

        const attributeSuggestions = await fillAttributesMutation.mutateAsync({
          product: {
            name: product.name,
            description: product.description,
            features: product.features,
            category: product.category,
          },
          requiredAttributes: [
            { name: "Marca", id: "brand", required: true },
            { name: "Modelo", id: "model", required: true },
            { name: "Cor", id: "color", required: false },
            { name: "Material", id: "material", required: false },
            { name: "Peso", id: "weight", required: false },
            { name: "Dimensões", id: "dimensions", required: false },
          ],
          marketplace: marketplaceName,
        });

        setMappedProducts((prev) =>
          prev.map((p) =>
            p.id === product.id
              ? {
                  ...p,
                  suggestedCategory: categorySuggestions[0]
                    ? {
                        id: categorySuggestions[0].categoryId,
                        name: categorySuggestions[0].categoryName,
                        path: categorySuggestions[0].categoryPath,
                        confidence: categorySuggestions[0].confidence,
                      }
                    : undefined,
                  suggestedAttributes: attributeSuggestions,
                  status: "mapped" as const,
                }
              : p
          )
        );
      } catch (error: any) {
        setMappedProducts((prev) =>
          prev.map((p) =>
            p.id === product.id
              ? { ...p, status: "error" as const, errorMessage: error.message }
              : p
          )
        );
      }

      setMappingProgress(Math.round(((i + 1) / mappedProducts.length) * 100));
    }

    setIsMappingInProgress(false);
    setStep("review");
    toast.success("Mapeamento concluído! Revise os resultados antes de exportar.");
  };

  const handleExport = async () => {
    const marketplace = (marketplaces || []).find((m: any) => m.id.toString() === selectedMarketplace);
    if (!marketplace) return;

    setStep("exporting");
    setExportProgress(0);

    const { jobId } = await createExportMutation.mutateAsync({
      marketplaceId: marketplace.id,
      totalProducts: mappedProducts.length,
      tagFilter: preSelectedTag || undefined,
    });

    if (!jobId) {
      toast.error("Erro ao criar job de exportação");
      return;
    }

    setExportJobId(jobId);
    await updateExportMutation.mutateAsync({ jobId, status: "processing" });

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < mappedProducts.length; i++) {
      const product = mappedProducts[i];

      try {
        await addLogMutation.mutateAsync({
          jobId,
          productId: product.id,
          productName: product.name,
          marketplaceId: marketplace.id,
          status: product.status === "mapped" ? "success" : "skipped",
          mappedCategory: product.suggestedCategory?.path || "",
          mappedAttributes: product.suggestedAttributes,
        });
        if (product.status === "mapped") successCount++;
      } catch (error: any) {
        errorCount++;
        await addLogMutation.mutateAsync({
          jobId,
          productId: product.id,
          productName: product.name,
          marketplaceId: marketplace.id,
          status: "error",
          errorMessage: error.message,
        });
      }

      setExportProgress(Math.round(((i + 1) / mappedProducts.length) * 100));
      await updateExportMutation.mutateAsync({
        jobId,
        processedProducts: i + 1,
        successCount,
        errorCount,
      });
    }

    await updateExportMutation.mutateAsync({
      jobId,
      status: errorCount === mappedProducts.length ? "failed" : "completed",
    });

    setStep("done");
    toast.success(`Exportação concluída! ${successCount} sucesso, ${errorCount} erros.`);
  };

  const updateProductAttribute = (productId: string, attrIndex: number, newValue: string) => {
    setMappedProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId || !p.suggestedAttributes) return p;
        const attrs = [...p.suggestedAttributes];
        attrs[attrIndex] = { ...attrs[attrIndex], value: newValue };
        return { ...p, suggestedAttributes: attrs };
      })
    );
  };

  if (!tokenData?.hasToken || !inventoryId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Exportar Produtos</h1>
          <p className="text-muted-foreground mt-1">Exporte produtos para marketplaces com IA</p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <Upload className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm text-center">
              Configure seu token e inventário nas configurações para começar.
            </p>
            <Button variant="outline" onClick={() => setLocation("/settings")}>
              Ir para Configurações
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exportar Produtos</h1>
        <p className="text-muted-foreground mt-1">
          Exporte produtos do BaseLinker para marketplaces com mapeamento inteligente
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[
          { key: "select", label: "Selecionar" },
          { key: "mapping", label: "Mapeamento IA" },
          { key: "review", label: "Revisar" },
          { key: "exporting", label: "Exportando" },
          { key: "done", label: "Concluído" },
        ].map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium ${
                step === s.key
                  ? "bg-primary text-primary-foreground"
                  : ["select", "mapping", "review", "exporting", "done"].indexOf(step) > i
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-sm hidden sm:inline ${step === s.key ? "font-medium" : "text-muted-foreground"}`}>
              {s.label}
            </span>
            {i < 4 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step: Select */}
      {step === "select" && (
        <div className="space-y-4">
          {/* Products loaded from Products page */}
          {preSelectedLoading && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm">Carregando {preSelectedIds.length} produtos selecionados...</span>
                </div>
              </CardContent>
            </Card>
          )}

          {mappedProducts.length > 0 && (
            <Card className="border-green-500/30 bg-green-50">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-800">
                      {mappedProducts.length} produto(s) carregado(s) para exportação
                    </p>
                    {preSelectedTag && preSelectedTag !== "all" && (
                      <p className="text-xs text-green-600 mt-0.5">
                        Tag: {preSelectedTag}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-green-700"
                    onClick={() => {
                      setMappedProducts([]);
                      setPreSelectedIds([]);
                      setLocation("/products");
                    }}
                  >
                    Alterar seleção
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {mappedProducts.length === 0 && !preSelectedLoading && (
            <Card className="border-dashed border-amber-300 bg-amber-50/50">
              <CardContent className="flex flex-col items-center justify-center py-8 gap-3">
                <Info className="h-8 w-8 text-amber-500" />
                <p className="text-sm text-amber-700 text-center">
                  Nenhum produto selecionado. Vá para a página de <strong>Produtos</strong>, selecione os produtos desejados e clique em <strong>"Exportar"</strong>.
                </p>
                <Button variant="outline" onClick={() => setLocation("/products")}>
                  <Package className="mr-2 h-4 w-4" />
                  Ir para Produtos
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Product preview table */}
          {mappedProducts.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Produtos para Exportação ({mappedProducts.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>EAN</TableHead>
                        <TableHead className="text-right">Preço</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappedProducts.slice(0, 20).map((p, idx) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                          <TableCell>
                            <p className="text-sm font-medium truncate max-w-[300px]">{p.name}</p>
                            <p className="text-xs text-muted-foreground">ID: {p.id}</p>
                          </TableCell>
                          <TableCell className="text-xs">{p.sku || "—"}</TableCell>
                          <TableCell className="text-xs">{p.ean || "—"}</TableCell>
                          <TableCell className="text-right text-sm">
                            {p.mainPrice ? `R$ ${p.mainPrice.toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm">{p.totalStock ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                      {mappedProducts.length > 20 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-2">
                            ... e mais {mappedProducts.length - 20} produto(s)
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Marketplace + Account selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4" />
                Marketplace e Conta de Destino
              </CardTitle>
              <CardDescription>Selecione o marketplace e a conta/integração para onde deseja exportar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Marketplace selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Marketplace</label>
                <Select 
                  value={selectedMarketplace} 
                  onValueChange={(val) => {
                    setSelectedMarketplace(val);
                    setSelectedAccount(""); // Reset account when marketplace changes
                    setAccountSearch("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um marketplace" />
                  </SelectTrigger>
                  <SelectContent>
                    {(marketplaces || []).map((mp: any) => (
                      <SelectItem key={mp.id} value={String(mp.id)}>
                        {mp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Account/Integration selection */}
              {selectedMarketplace && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Link2 className="h-3.5 w-3.5" />
                      Conta / Integração
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {allAccounts.length} integrações encontradas
                      </span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 text-xs"
                        onClick={() => refetchIntegrations()}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Atualizar
                      </Button>
                    </div>
                  </div>

                  {integrationsLoading ? (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Carregando integrações de marketplace...</span>
                    </div>
                  ) : allAccounts.length > 0 ? (
                    <>
                      {/* Search field for accounts */}
                      <Input
                        placeholder="Buscar conta por nome, marketplace ou ID..."
                        value={accountSearch}
                        onChange={(e) => setAccountSearch(e.target.value)}
                        className="h-8 text-sm"
                      />

                      {displayedAccounts.length > 0 ? (
                        <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a conta de destino" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {displayedAccounts.map((a) => (
                              <SelectItem key={`${a.integrationCode}:${a.accountId}`} value={`${a.integrationCode}:${a.accountId}`}>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
                                    {a.integrationLabel}
                                  </Badge>
                                  <span>{a.accountName}</span>
                                  <span className="text-xs text-muted-foreground">(#{a.accountId})</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                          <p className="text-xs text-amber-700">
                            Nenhuma conta encontrada com "{accountSearch}". Tente outro termo.
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      <p className="text-xs text-amber-700">
                        Nenhuma integração de marketplace encontrada. Verifique se os marketplaces estão conectados no BaseLinker e se o inventário correto está selecionado.
                      </p>
                    </div>
                  )}

                  {/* Selected account info */}
                  {selectedAccountInfo && (
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                        <div>
                          <p className="text-sm font-medium">
                            {selectedAccountInfo.accountName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {selectedAccountInfo.integrationLabel} &bull; ID: {selectedAccountInfo.accountId}
                            {selectedAccountInfo.langs.length > 0 && (
                              <> &bull; Idiomas: {selectedAccountInfo.langs.join(", ")}</>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={handleStartMapping}
                disabled={!selectedMarketplace || !selectedAccount || mappedProducts.length === 0 || isMappingInProgress}
                className="w-full"
                size="lg"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Iniciar Mapeamento com IA ({mappedProducts.length} produtos)
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step: Mapping */}
      {step === "mapping" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Mapeamento com IA em Progresso
            </CardTitle>
            <CardDescription>
              A IA está analisando cada produto para sugerir categorias e preencher fichas técnicas
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={mappingProgress} className="h-3" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{mappingProgress}% concluído</span>
              <span>
                {mappedProducts.filter((p) => p.status !== "pending").length} de {mappedProducts.length} produtos
              </span>
            </div>
            <div className="max-h-[400px] overflow-y-auto space-y-2">
              {mappedProducts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                  {p.status === "pending" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                  {p.status === "mapped" && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
                  {p.status === "error" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                  <span className="text-sm truncate flex-1">{p.name}</span>
                  {p.suggestedCategory && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {p.suggestedCategory.confidence}%
                    </Badge>
                  )}
                  {p.status === "error" && (
                    <span className="text-xs text-destructive shrink-0">{p.errorMessage}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Review */}
      {step === "review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setStep("select")}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Voltar
              </Button>
              <Badge variant="secondary">
                {mappedProducts.filter((p) => p.status === "mapped").length} mapeado(s)
              </Badge>
              <Badge variant="destructive">
                {mappedProducts.filter((p) => p.status === "error").length} erro(s)
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs text-muted-foreground">
                Destino: <strong>{selectedAccountInfo?.accountName}</strong>
                {selectedAccountInfo && (
                  <span className="ml-1">({selectedAccountInfo.integrationLabel})</span>
                )}
              </div>
              <Button onClick={handleExport}>
                <Upload className="mr-2 h-4 w-4" />
                Confirmar Exportação
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Categoria Sugerida</TableHead>
                      <TableHead>Confiança</TableHead>
                      <TableHead>Atributos</TableHead>
                      <TableHead className="w-12">Editar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappedProducts.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          {product.status === "mapped" && <CheckCircle className="h-4 w-4 text-green-500" />}
                          {product.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                          {product.status === "pending" && <AlertCircle className="h-4 w-4 text-amber-500" />}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[200px]">
                            <p className="text-sm font-medium truncate">{product.name}</p>
                            <p className="text-xs text-muted-foreground">ID: {product.id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {product.suggestedCategory ? (
                            <div className="max-w-[200px]">
                              <p className="text-sm truncate">{product.suggestedCategory.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{product.suggestedCategory.path}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {product.suggestedCategory && (
                            <Badge
                              variant={product.suggestedCategory.confidence >= 80 ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {product.suggestedCategory.confidence}%
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {product.suggestedAttributes && product.suggestedAttributes.length > 0 ? (
                            editingProduct === product.id ? (
                              <div className="space-y-1">
                                {product.suggestedAttributes.map((attr, idx) => (
                                  <div key={idx} className="flex items-center gap-1">
                                    <span className="text-xs text-muted-foreground w-16 shrink-0">{attr.attributeName}:</span>
                                    <Input
                                      className="h-6 text-xs"
                                      value={attr.value}
                                      onChange={(e) => updateProductAttribute(product.id, idx, e.target.value)}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                {product.suggestedAttributes.slice(0, 3).map((attr, idx) => (
                                  <p key={idx} className="text-xs">
                                    <span className="text-muted-foreground">{attr.attributeName}:</span> {attr.value}
                                  </p>
                                ))}
                                {product.suggestedAttributes.length > 3 && (
                                  <p className="text-xs text-muted-foreground">
                                    +{product.suggestedAttributes.length - 3} mais
                                  </p>
                                )}
                              </div>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {product.status === "mapped" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingProduct(editingProduct === product.id ? null : product.id)}
                            >
                              {editingProduct === product.id ? (
                                <Save className="h-3 w-3" />
                              ) : (
                                <Edit3 className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step: Exporting */}
      {step === "exporting" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary animate-pulse" />
              Exportando Produtos...
            </CardTitle>
            <CardDescription>
              Os produtos estão sendo exportados para{" "}
              <strong>{selectedAccountInfo?.accountName}</strong>
              {selectedAccountInfo && (
                <span className="ml-1">({selectedAccountInfo.integrationLabel})</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={exportProgress} className="h-3" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{exportProgress}% concluído</span>
              <span>
                {Math.round((exportProgress / 100) * mappedProducts.length)} de {mappedProducts.length} produtos
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Done */}
      {step === "done" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold">Exportação Concluída!</h3>
            <p className="text-sm text-muted-foreground">
              Destino: {selectedAccountInfo?.accountName}
              {selectedAccountInfo && (
                <span className="ml-1">({selectedAccountInfo.integrationLabel})</span>
              )}
            </p>
            <div className="flex items-center gap-4">
              <Badge variant="default" className="text-sm">
                {mappedProducts.filter((p) => p.status === "mapped").length} sucesso
              </Badge>
              <Badge variant="destructive" className="text-sm">
                {mappedProducts.filter((p) => p.status === "error").length} erros
              </Badge>
            </div>
            <div className="flex gap-3 mt-4">
              <Button variant="outline" onClick={() => setLocation("/logs")}>
                Ver Logs Detalhados
              </Button>
              <Button
                onClick={() => {
                  setStep("select");
                  setMappedProducts([]);
                  setPreSelectedIds([]);
                  setPreSelectedTag("");
                  setExportJobId(null);
                  setSelectedAccount("");
                  setLocation("/products");
                }}
              >
                Nova Exportação
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Format integration code into a human-readable label */
function formatIntegrationName(code: string): string {
  // Map common BaseLinker integration codes to display names
  const knownIntegrations: Record<string, string> = {
    "allegro": "Allegro",
    "amazon": "Amazon",
    "ebay": "eBay",
    "emag": "eMAG",
    "shopee": "Shopee",
    "mercadolivre": "Mercado Livre",
    "mercadolibre": "Mercado Livre",
    "tiktok": "TikTok Shop",
    "tiktokshop": "TikTok Shop",
    "magalu": "Magazine Luiza",
    "magazineluiza": "Magazine Luiza",
    "madeiramadeira": "Madeira Madeira",
    "leroymerlin": "Leroy Merlin",
    "shopify": "Shopify",
    "woocommerce": "WooCommerce",
    "prestashop": "PrestaShop",
    "bling": "Bling",
    "olist": "Olist",
    "b2w": "B2W (Americanas)",
    "americanas": "Americanas",
    "casasbahia": "Casas Bahia",
    "extra": "Extra",
    "pontofrio": "Ponto Frio",
    "carrefour": "Carrefour",
    "dafiti": "Dafiti",
    "netshoes": "Netshoes",
    "kabum": "KaBuM!",
    "wish": "Wish",
    "etsy": "Etsy",
    "aliexpress": "AliExpress",
  };

  // Check for exact match
  const lower = code.toLowerCase();
  if (knownIntegrations[lower]) return knownIntegrations[lower];

  // Check for custom integrations
  if (code.startsWith("custom_")) {
    return `Canal Personalizado (${code.replace("custom_", "#")})`;
  }

  // Check partial matches
  for (const [key, name] of Object.entries(knownIntegrations)) {
    if (lower.includes(key) || key.includes(lower)) return name;
  }

  // Fallback: capitalize
  return code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ");
}
