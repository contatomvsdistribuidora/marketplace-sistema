import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Upload, Store, Loader2, Sparkles, CheckCircle, XCircle, AlertCircle,
  ArrowRight, ArrowLeft, Package, Edit3, Save, Info, Link2, RefreshCw, ExternalLink
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

// Connected account from our system (ML, TikTok, etc.)
interface ConnectedAccount {
  id: number;
  name: string;
  marketplace: string; // "mercadolivre" | "tiktok"
  isActive: boolean;
  icon?: string;
}

export default function ExportPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<ExportStep>("select");
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>("");
  const [selectedAccount, setSelectedAccount] = useState<string>(""); // "marketplace:accountId"
  const [mappedProducts, setMappedProducts] = useState<MappedProduct[]>([]);
  const [mappingProgress, setMappingProgress] = useState(0);
  const [isMappingInProgress, setIsMappingInProgress] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportJobId, setExportJobId] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [preSelectedIds, setPreSelectedIds] = useState<number[]>([]);
  const [preSelectedTag, setPreSelectedTag] = useState<string>("");
  const [reExportJobId, setReExportJobId] = useState<number | null>(null);
  const [reExportMarketplaceId, setReExportMarketplaceId] = useState<number | null>(null);
  const [reExportMappedData, setReExportMappedData] = useState<Record<string, { mappedCategory: string | null; mappedAttributes: any }>>({});

  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;

  const { data: marketplaces } = trpc.marketplaces.list.useQuery();

  // Fetch connected accounts from our system (NOT BaseLinker)
  const { data: mlAccounts, refetch: refetchMlAccounts } = trpc.ml.accounts.useQuery();
  const { data: tiktokAccounts, refetch: refetchTiktokAccounts } = trpc.tiktok.accounts.useQuery();

  // Build unified list of connected accounts from our system
  const connectedAccounts = useMemo<ConnectedAccount[]>(() => {
    const accounts: ConnectedAccount[] = [];

    // ML accounts
    if (mlAccounts) {
      for (const acc of mlAccounts as any[]) {
        accounts.push({
          id: acc.id,
          name: acc.nickname || `ML Account #${acc.id}`,
          marketplace: "mercadolivre",
          isActive: acc.isActive,
          icon: undefined,
        });
      }
    }

    // TikTok accounts
    if (tiktokAccounts) {
      for (const acc of tiktokAccounts as any[]) {
        accounts.push({
          id: acc.id,
          name: acc.shopName || acc.sellerName || `TikTok #${acc.id}`,
          marketplace: "tiktok",
          isActive: true,
          icon: undefined,
        });
      }
    }

    return accounts;
  }, [mlAccounts, tiktokAccounts]);

  // Get selected marketplace info
  const selectedMarketplaceInfo = useMemo(() => {
    if (!selectedMarketplace || !marketplaces) return null;
    return (marketplaces as any[]).find((m: any) => String(m.id) === selectedMarketplace) || null;
  }, [selectedMarketplace, marketplaces]);

  // Map marketplace codes to our connected account types
  const MARKETPLACE_CODE_TO_ACCOUNT_TYPE: Record<string, string[]> = {
    mercadolivre: ["mercadolivre"],
    tiktok: ["tiktok"],
    shopee: [],
    amazon: [],
    madeiramadeira: [],
    magalu: [],
    leroymerlin: [],
    americanas: [],
    casasbahia: [],
    carrefour: [],
    kabum: [],
    shein: [],
    olist: [],
    aliexpress: [],
    dafiti: [],
    netshoes: [],
  };

  // Filter connected accounts by selected marketplace
  const filteredAccounts = useMemo(() => {
    if (!selectedMarketplaceInfo) return [];
    const mpCode = (selectedMarketplaceInfo as any).code?.toLowerCase();
    if (!mpCode) return [];
    const accountTypes = MARKETPLACE_CODE_TO_ACCOUNT_TYPE[mpCode];
    if (!accountTypes || accountTypes.length === 0) return [];
    return connectedAccounts.filter(a => accountTypes.includes(a.marketplace) && a.isActive);
  }, [connectedAccounts, selectedMarketplaceInfo]);

  // Check if the selected marketplace has API support
  const hasDirectApiSupport = useMemo(() => {
    if (!selectedMarketplaceInfo) return false;
    const mpCode = (selectedMarketplaceInfo as any).code?.toLowerCase();
    if (!mpCode) return false;
    const accountTypes = MARKETPLACE_CODE_TO_ACCOUNT_TYPE[mpCode];
    return accountTypes && accountTypes.length > 0;
  }, [selectedMarketplaceInfo]);

  // Get selected account info
  const selectedAccountInfo = useMemo(() => {
    if (!selectedAccount) return null;
    const [marketplace, accountIdStr] = selectedAccount.split(":");
    const accountId = parseInt(accountIdStr);
    return connectedAccounts.find(a => a.marketplace === marketplace && a.id === accountId) || null;
  }, [selectedAccount, connectedAccounts]);

  // Load pre-selected product IDs from sessionStorage
  useEffect(() => {
    const reExportId = sessionStorage.getItem("reexport_job_id");
    const reExportTag = sessionStorage.getItem("reexport_job_tag");
    if (reExportId) {
      setReExportJobId(parseInt(reExportId));
      if (reExportTag) setPreSelectedTag(reExportTag);
      sessionStorage.removeItem("reexport_job_id");
      sessionStorage.removeItem("reexport_job_tag");
      return;
    }

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

  // Fetch products from a previous job for re-export
  const { data: reExportData, isLoading: reExportLoading } = trpc.exports.getJobProducts.useQuery(
    { jobId: reExportJobId! },
    { enabled: !!reExportJobId }
  );

  useEffect(() => {
    if (reExportData && reExportData.products.length > 0 && preSelectedIds.length === 0 && mappedProducts.length === 0) {
      const ids = reExportData.products
        .map((p: any) => parseInt(p.productId))
        .filter((id: number) => !isNaN(id));
      if (ids.length > 0) {
        setPreSelectedIds(ids);
        if (reExportData.jobMarketplaceId) {
          setReExportMarketplaceId(reExportData.jobMarketplaceId);
        }
        const mappedDataMap: Record<string, { mappedCategory: string | null; mappedAttributes: any }> = {};
        for (const p of reExportData.products) {
          mappedDataMap[p.productId] = {
            mappedCategory: p.mappedCategory,
            mappedAttributes: p.mappedAttributes,
          };
        }
        setReExportMappedData(mappedDataMap);
        toast.info(`${ids.length} produtos carregados do Job #${reExportJobId} para re-exportação.`);
      }
    }
  }, [reExportData]);

  // Fetch pre-selected products from cache
  const { data: preSelectedProducts, isLoading: preSelectedLoading } = trpc.baselinker.getProductsByIds.useQuery(
    { inventoryId: inventoryId!, productIds: preSelectedIds },
    { enabled: !!inventoryId && preSelectedIds.length > 0 }
  );

  const isLoadingProducts = preSelectedLoading || reExportLoading;

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
  const mlPublishMutation = trpc.ml.publishProduct.useMutation();

  // Check if this is a re-export to the same marketplace type (can skip AI mapping)
  const canSkipMapping = useMemo(() => {
    if (!reExportJobId || !reExportMarketplaceId || !selectedMarketplace) return false;
    return reExportMarketplaceId.toString() === selectedMarketplace;
  }, [reExportJobId, reExportMarketplaceId, selectedMarketplace]);

  const hasPreviousMappedData = useMemo(() => {
    return Object.keys(reExportMappedData).length > 0;
  }, [reExportMappedData]);

  const handleStartMapping = async () => {
    if (!selectedMarketplace) {
      toast.error("Selecione um marketplace de destino");
      return;
    }
    if (!selectedAccount) {
      toast.error("Selecione a conta de destino");
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
    const accountName = selectedAccountInfo?.name || "";

    // If re-exporting to same marketplace type and we have previous mapped data, skip AI mapping
    if (canSkipMapping && hasPreviousMappedData) {
      toast.info("Re-exportação para mesmo marketplace detectada. Reutilizando mapeamento anterior...");
      let reusedCount = 0;
      let newMappingCount = 0;

      for (let i = 0; i < mappedProducts.length; i++) {
        const product = mappedProducts[i];
        const previousData = reExportMappedData[product.id];

        if (previousData && (previousData.mappedCategory || previousData.mappedAttributes)) {
          const attrs = previousData.mappedAttributes as any[];
          setMappedProducts((prev) =>
            prev.map((p) =>
              p.id === product.id
                ? {
                    ...p,
                    suggestedCategory: previousData.mappedCategory
                      ? {
                          id: previousData.mappedCategory,
                          name: previousData.mappedCategory,
                          path: previousData.mappedCategory,
                          confidence: 100,
                        }
                      : undefined,
                    suggestedAttributes: Array.isArray(attrs) ? attrs : undefined,
                    status: "mapped" as const,
                  }
                : p
            )
          );
          reusedCount++;
        } else {
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
              ],
              marketplace: `${marketplaceName} (${accountName})`,
            });

            setMappedProducts((prev) =>
              prev.map((p) =>
                p.id === product.id
                  ? {
                      ...p,
                      suggestedCategory: categorySuggestions?.[0] ? {
                          id: categorySuggestions[0].categoryId,
                          name: categorySuggestions[0].categoryName,
                          path: categorySuggestions[0].categoryPath,
                          confidence: categorySuggestions[0].confidence,
                        } : undefined,
                      suggestedAttributes: attributeSuggestions || undefined,
                      status: "mapped" as const,
                    }
                  : p
              )
            );
            newMappingCount++;
          } catch (error: any) {
            setMappedProducts((prev) =>
              prev.map((p) =>
                p.id === product.id
                  ? { ...p, status: "error" as const, errorMessage: error.message }
                  : p
              )
            );
          }
        }

        setMappingProgress(Math.round(((i + 1) / mappedProducts.length) * 100));
      }

      toast.success(`Mapeamento concluído: ${reusedCount} reutilizados, ${newMappingCount} novos.`);
    } else {
      // Normal AI mapping
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
            ],
            marketplace: `${marketplaceName} (${accountName})`,
          });

          setMappedProducts((prev) =>
            prev.map((p) =>
              p.id === product.id
                ? {
                    ...p,
                    suggestedCategory: categorySuggestions?.[0] ? {
                        id: categorySuggestions[0].categoryId,
                        name: categorySuggestions[0].categoryName,
                        path: categorySuggestions[0].categoryPath,
                        confidence: categorySuggestions[0].confidence,
                      } : undefined,
                    suggestedAttributes: attributeSuggestions || undefined,
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
    }

    setIsMappingInProgress(false);
    setStep("review");
    toast.success("Mapeamento concluído! Revise os resultados antes de exportar.");
  };

  const handleExport = async () => {
    const marketplace = (marketplaces || []).find((m: any) => m.id.toString() === selectedMarketplace);
    if (!marketplace || !selectedAccountInfo) return;

    const mpCode = (selectedMarketplaceInfo as any)?.code?.toLowerCase() || "";

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

    toast.info(`Publicando diretamente via API do ${marketplace.name}...`, { duration: 3000 });

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < mappedProducts.length; i++) {
      const product = mappedProducts[i];

      if (product.status !== "mapped") {
        await addLogMutation.mutateAsync({
          jobId,
          productId: product.id,
          productName: product.name,
          marketplaceId: marketplace.id,
          status: "skipped",
          errorMessage: product.status === "error" ? product.errorMessage : "Produto não mapeado",
        });
        setExportProgress(Math.round(((i + 1) / mappedProducts.length) * 100));
        await updateExportMutation.mutateAsync({
          jobId,
          processedProducts: i + 1,
          successCount,
          errorCount,
        });
        continue;
      }

      try {
        // Build features from suggested attributes
        const features: Record<string, string> = {};
        if (product.suggestedAttributes) {
          for (const attr of product.suggestedAttributes) {
            if (attr.value) {
              features[attr.attributeName] = attr.value;
            }
          }
        }

        if (mpCode === "mercadolivre") {
          // ===== DIRECT ML API EXPORT =====
          const mlResult = await mlPublishMutation.mutateAsync({
            accountId: selectedAccountInfo.id,
            productId: product.id,
            name: product.name,
            description: product.description || undefined,
            price: product.mainPrice || 0,
            stock: product.totalStock || 1,
            ean: product.ean || undefined,
            sku: product.sku || undefined,
            brand: features["Marca"] || features["brand"] || undefined,
            images: product.imageUrl ? [product.imageUrl] : undefined,
            features,
            // Don't pass AI-mapped categoryId - let ML's domain_discovery predict the correct category
            // categoryId: product.suggestedCategory?.id || undefined,
          });

          await addLogMutation.mutateAsync({
            jobId,
            productId: product.id,
            productName: product.name,
            marketplaceId: marketplace.id,
            status: mlResult.success ? "success" : "error",
            errorMessage: mlResult.error || undefined,
          });

          if (mlResult.success) {
            successCount++;
            const permalink = mlResult.permalink ? ` - ${mlResult.permalink}` : "";
            toast.success(`"${product.name.substring(0, 30)}..." publicado no ML!${permalink}`, { duration: 4000 });
          } else {
            errorCount++;
            toast.error(`Erro ML: "${product.name.substring(0, 30)}...": ${mlResult.error}`, { duration: 4000 });
          }
        } else if (mpCode === "tiktok") {
          // ===== TIKTOK SHOP API (placeholder) =====
          // TikTok createProduct requires shopCipher and specific product format
          // For now, log as error with message to use TikTok publish page
          errorCount++;
          await addLogMutation.mutateAsync({
            jobId,
            productId: product.id,
            productName: product.name,
            marketplaceId: marketplace.id,
            status: "error",
            errorMessage: "TikTok Shop: use a página 'Publicar no TikTok' para publicação individual por enquanto.",
          });
          toast.error(`TikTok: Use a página dedicada para publicar "${product.name.substring(0, 30)}..."`, { duration: 4000 });
        } else {
          // ===== MARKETPLACE SEM API DIRETA =====
          errorCount++;
          await addLogMutation.mutateAsync({
            jobId,
            productId: product.id,
            productName: product.name,
            marketplaceId: marketplace.id,
            status: "error",
            errorMessage: `API direta para ${marketplace.name} ainda não disponível. Conecte a conta do marketplace primeiro.`,
          });
        }
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
        toast.error(`Erro em "${product.name.substring(0, 30)}...": ${error.message}`, { duration: 3000 });
      }

      setExportProgress(Math.round(((i + 1) / mappedProducts.length) * 100));
      await updateExportMutation.mutateAsync({
        jobId,
        processedProducts: i + 1,
        successCount,
        errorCount,
      });

      // Small delay between API calls to avoid rate limiting
      if (i < mappedProducts.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    await updateExportMutation.mutateAsync({
      jobId,
      status: errorCount === mappedProducts.length ? "failed" : "completed",
    });

    setStep("done");
    toast.success(`Exportação concluída! ${successCount} publicados, ${errorCount} erros.`);
  };

  const updateProductAttribute = (productId: string, attrIndex: number, newValue: string) => {
    setMappedProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId || !p.suggestedAttributes) return p;
        const newAttrs = [...p.suggestedAttributes];
        newAttrs[attrIndex] = { ...newAttrs[attrIndex], value: newValue };
        return { ...p, suggestedAttributes: newAttrs };
      })
    );
  };

  const getMarketplaceDisplayName = () => {
    if (!selectedMarketplaceInfo) return "Marketplace";
    return (selectedMarketplaceInfo as any).name || "Marketplace";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exportar Produtos</h1>
        <p className="text-muted-foreground">
          Exporte produtos do BaseLinker diretamente para marketplaces via API
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: "select", label: "Selecionar", num: 1 },
          { key: "mapping", label: "Mapeamento IA", num: 2 },
          { key: "review", label: "Revisar", num: 3 },
          { key: "exporting", label: "Publicando", num: 4 },
          { key: "done", label: "Concluído", num: 5 },
        ].map((s, idx) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium ${
                step === s.key
                  ? "bg-primary text-primary-foreground"
                  : ["select", "mapping", "review", "exporting", "done"].indexOf(step) >
                    ["select", "mapping", "review", "exporting", "done"].indexOf(s.key)
                  ? "bg-green-500 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {s.num}
            </div>
            <span className={step === s.key ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
            {idx < 4 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step: Select */}
      {step === "select" && (
        <div className="space-y-4">
          {/* Products loaded from Products page */}
          {isLoadingProducts && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm">
                    {reExportJobId
                      ? `Carregando produtos do Job #${reExportJobId} para re-exportação...`
                      : `Carregando ${preSelectedIds.length} produtos selecionados...`
                    }
                  </span>
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
                      {reExportJobId && (
                        <Badge variant="outline" className="ml-2 text-xs border-green-500 text-green-700">
                          Re-exportação do Job #{reExportJobId}
                        </Badge>
                      )}
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

          {mappedProducts.length === 0 && !isLoadingProducts && (
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
                Marketplace de Destino
              </CardTitle>
              <CardDescription>Selecione o marketplace e a conta conectada para publicar diretamente</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Marketplace selection - Visual cards with logos */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {(marketplaces || []).map((mp: any) => {
                  const isSelected = selectedMarketplace === String(mp.id);
                  const mpCode = mp.code?.toLowerCase();
                  const accountTypes = MARKETPLACE_CODE_TO_ACCOUNT_TYPE[mpCode];
                  const hasApi = accountTypes && accountTypes.length > 0;
                  return (
                    <button
                      key={mp.id}
                      onClick={() => {
                        setSelectedMarketplace(String(mp.id));
                        setSelectedAccount("");
                      }}
                      className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-md cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/20"
                          : "border-border hover:border-primary/40 bg-card"
                      }`}
                    >
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5">
                          <CheckCircle className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      {hasApi && (
                        <div className="absolute top-1.5 left-1.5">
                          <Badge variant="default" className="text-[8px] h-4 px-1 bg-green-600">API</Badge>
                        </div>
                      )}
                      <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden">
                        {mp.icon ? (
                          <img src={mp.icon} alt={mp.name} className="h-8 w-8 object-contain" />
                        ) : (
                          <Store className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <span className={`text-xs font-medium text-center leading-tight ${
                        isSelected ? "text-primary" : "text-foreground"
                      }`}>
                        {mp.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Account selection - from our connected accounts (NOT BaseLinker) */}
              {selectedMarketplace && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Link2 className="h-3.5 w-3.5" />
                      Conta Conectada
                      {selectedMarketplaceInfo && (
                        <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                          {(selectedMarketplaceInfo as any).icon && (
                            <img src={(selectedMarketplaceInfo as any).icon} alt="" className="h-3 w-3 object-contain" />
                          )}
                          {(selectedMarketplaceInfo as any).name}
                        </Badge>
                      )}
                    </label>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={() => {
                        refetchMlAccounts();
                        refetchTiktokAccounts();
                      }}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Atualizar
                    </Button>
                  </div>

                  {!hasDirectApiSupport ? (
                    <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertCircle className="h-8 w-8 text-amber-500" />
                      <div className="text-center">
                        <p className="text-sm font-medium text-amber-800">
                          API direta para {getMarketplaceDisplayName()} ainda não disponível
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                          Atualmente suportamos exportação direta via API para: <strong>Mercado Livre</strong> e <strong>TikTok Shop</strong>.
                          Outros marketplaces serão adicionados em breve.
                        </p>
                      </div>
                    </div>
                  ) : filteredAccounts.length > 0 ? (
                    <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                      {filteredAccounts.map((a) => {
                        const accountKey = `${a.marketplace}:${a.id}`;
                        const isAccSelected = selectedAccount === accountKey;
                        return (
                          <button
                            key={accountKey}
                            onClick={() => setSelectedAccount(accountKey)}
                            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                              isAccSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                : "border-border hover:border-primary/30 hover:bg-muted/30"
                            }`}
                          >
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                              isAccSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                              {isAccSelected ? (
                                <CheckCircle className="h-4 w-4" />
                              ) : (
                                <Store className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${
                                isAccSelected ? "text-primary" : ""
                              }`}>
                                {a.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {a.marketplace === "mercadolivre" ? "Mercado Livre" : "TikTok Shop"} &bull; Conta #{a.id}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200 shrink-0">
                              API Direta
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-blue-50 border border-blue-200">
                      <Info className="h-8 w-8 text-blue-500" />
                      <div className="text-center">
                        <p className="text-sm font-medium text-blue-800">
                          Nenhuma conta {getMarketplaceDisplayName()} conectada
                        </p>
                        <p className="text-xs text-blue-600 mt-1">
                          Conecte uma conta na página de contas do marketplace para publicar diretamente.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const mpCode = (selectedMarketplaceInfo as any)?.code?.toLowerCase();
                          if (mpCode === "mercadolivre") setLocation("/ml-accounts");
                          else if (mpCode === "tiktok") setLocation("/tiktok-accounts");
                        }}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Conectar Conta
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Info about direct export */}
              {selectedAccount && selectedAccountInfo && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-xs text-green-700">
                    <strong>Exportação direta via API ativada!</strong> Os produtos serão publicados diretamente no {getMarketplaceDisplayName()} usando a conta <strong>{selectedAccountInfo.name}</strong>, sem intermediários.
                  </p>
                </div>
              )}

              {/* Info about re-export skip mapping */}
              {canSkipMapping && hasPreviousMappedData && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-blue-500 shrink-0" />
                  <p className="text-xs text-blue-700">
                    <strong>Re-exportação para mesmo marketplace detectada.</strong> O mapeamento anterior (categorias e atributos) será reutilizado automaticamente.
                  </p>
                </div>
              )}

              <Button
                onClick={handleStartMapping}
                disabled={!selectedMarketplace || !selectedAccount || mappedProducts.length === 0 || isMappingInProgress}
                className="w-full"
                size="lg"
              >
                {canSkipMapping && hasPreviousMappedData ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reutilizar Mapeamento e Continuar ({mappedProducts.length} produtos)
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Iniciar Mapeamento com IA ({mappedProducts.length} produtos)
                  </>
                )}
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
                Destino: <strong>{selectedAccountInfo?.name}</strong>
                <Badge variant="default" className="ml-2 text-[10px] bg-green-600">
                  API Direta {getMarketplaceDisplayName()}
                </Badge>
              </div>
              <Button onClick={handleExport}>
                <Upload className="mr-2 h-4 w-4" />
                Publicar no {getMarketplaceDisplayName()}
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
              Publicando Produtos no {getMarketplaceDisplayName()}...
            </CardTitle>
            <CardDescription>
              Os produtos estão sendo publicados diretamente via API na conta{" "}
              <strong>{selectedAccountInfo?.name}</strong>
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
            <h3 className="text-xl font-semibold">Publicação Concluída!</h3>
            <p className="text-sm text-muted-foreground">
              Publicado diretamente no {getMarketplaceDisplayName()} via API — conta: <strong>{selectedAccountInfo?.name}</strong>
            </p>
            <div className="flex items-center gap-4">
              <Badge variant="default" className="text-sm">
                {mappedProducts.filter((p) => p.status === "mapped").length} publicado(s)
              </Badge>
              <Badge variant="destructive" className="text-sm">
                {mappedProducts.filter((p) => p.status === "error").length} erro(s)
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
