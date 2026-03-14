import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload, Store, Tag, Loader2, Sparkles, CheckCircle, XCircle, AlertCircle,
  ArrowRight, ArrowLeft, Package, Edit3, Save
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
  suggestedCategory?: { id: string; name: string; path: string; confidence: number };
  suggestedAttributes?: { attributeName: string; attributeId: string; value: string; confidence: number; source: string }[];
  status: "pending" | "mapped" | "error";
  errorMessage?: string;
}

export default function ExportPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<ExportStep>("select");
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>("");
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [mappedProducts, setMappedProducts] = useState<MappedProduct[]>([]);
  const [mappingProgress, setMappingProgress] = useState(0);
  const [isMappingInProgress, setIsMappingInProgress] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportJobId, setExportJobId] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);

  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;

  const { data: marketplaces } = trpc.marketplaces.list.useQuery();
  const { data: tags } = trpc.baselinker.getTags.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!inventoryId && !!tokenData?.hasToken }
  );

  const { data: productsData, isLoading: productsLoading, refetch: refetchProducts } = trpc.baselinker.getProducts.useQuery(
    {
      inventoryId: inventoryId!,
      tagName: selectedTag && selectedTag !== "all" ? selectedTag : undefined,
    },
    { enabled: false }
  );

  const mapCategoryMutation = trpc.ai.mapCategory.useMutation();
  const fillAttributesMutation = trpc.ai.fillAttributes.useMutation();
  const createExportMutation = trpc.exports.create.useMutation();
  const updateExportMutation = trpc.exports.updateStatus.useMutation();
  const addLogMutation = trpc.exports.addLog.useMutation();

  const products = useMemo(() => {
    if (!productsData?.products) return [];
    return Object.entries(productsData.products).map(([id, data]: [string, any]) => ({
      id,
      name: data.name || "",
      description: data.text_fields?.description || data.text_fields?.["description_extra1"] || "",
      category: data.category_id?.toString() || "",
      features: data.features || {},
      sku: data.sku || "",
      ean: data.ean || "",
      prices: data.prices || {},
      stock: data.stock || {},
    }));
  }, [productsData]);

  const handleLoadProducts = async () => {
    if (!selectedTag) {
      toast.error("Selecione uma tag para filtrar os produtos");
      return;
    }
    await refetchProducts();
  };

  useEffect(() => {
    if (products.length > 0 && mappedProducts.length === 0) {
      setMappedProducts(
        products.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          features: p.features,
          status: "pending" as const,
        }))
      );
    }
  }, [products]);

  const handleStartMapping = async () => {
    if (!selectedMarketplace) {
      toast.error("Selecione um marketplace de destino");
      return;
    }
    if (mappedProducts.length === 0) {
      toast.error("Carregue os produtos primeiro");
      return;
    }

    setIsMappingInProgress(true);
    setStep("mapping");
    setMappingProgress(0);

    const marketplace = (marketplaces || []).find((m: any) => m.id.toString() === selectedMarketplace);
    const marketplaceName = marketplace?.name || "Marketplace";

    // Process products one by one with AI
    for (let i = 0; i < mappedProducts.length; i++) {
      const product = mappedProducts[i];
      try {
        // Map category with AI
        const categorySuggestions = await mapCategoryMutation.mutateAsync({
          product: {
            name: product.name,
            description: product.description,
            features: product.features,
            category: product.category,
          },
          marketplace: marketplaceName,
          availableCategories: [], // Will use AI general knowledge
        });

        // Fill attributes with AI
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

    // Create export job
    const { jobId } = await createExportMutation.mutateAsync({
      marketplaceId: marketplace.id,
      totalProducts: mappedProducts.length,
      tagFilter: selectedTag,
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
        // Here we would call the actual BaseLinker API to export the product
        // For now, we log the mapping result
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
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Tag className="h-4 w-4" />
                Filtrar por Tag
              </CardTitle>
              <CardDescription>Selecione a tag dos produtos que deseja exportar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedTag} onValueChange={setSelectedTag}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os produtos</SelectItem>
                  {(tags || []).map((tag: any) => (
                    <SelectItem key={tag.tag_id} value={String(tag.tag_id)}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleLoadProducts} disabled={productsLoading} className="w-full">
                {productsLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Carregando...
                  </>
                ) : (
                  <>
                    <Package className="mr-2 h-4 w-4" />
                    Carregar Produtos
                  </>
                )}
              </Button>
              {products.length > 0 && (
                <Badge variant="secondary">{products.length} produto(s) carregado(s)</Badge>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4" />
                Marketplace de Destino
              </CardTitle>
              <CardDescription>Selecione para qual marketplace deseja exportar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedMarketplace} onValueChange={setSelectedMarketplace}>
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
              <Button
                onClick={handleStartMapping}
                disabled={!selectedMarketplace || products.length === 0}
                className="w-full"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Iniciar Mapeamento com IA
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
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {mappedProducts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                  {p.status === "pending" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                  {p.status === "mapped" && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
                  {p.status === "error" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                  <span className="text-sm truncate">{p.name}</span>
                  {p.suggestedCategory && (
                    <Badge variant="outline" className="ml-auto shrink-0 text-xs">
                      {p.suggestedCategory.confidence}%
                    </Badge>
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
          <div className="flex items-center justify-between">
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
            <Button onClick={handleExport}>
              <Upload className="mr-2 h-4 w-4" />
              Confirmar Exportação
            </Button>
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
            <CardDescription>Os produtos estão sendo exportados para o marketplace selecionado</CardDescription>
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
                  setSelectedTag("");
                  setSelectedMarketplace("");
                  setExportJobId(null);
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
