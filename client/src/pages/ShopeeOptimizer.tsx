import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import {
  Sparkles,
  RefreshCw,
  Loader2,
  Package,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ArrowLeft,
  Wand2,
  FileText,
  Image,
  Video,
  Tag,
  Ruler,
  Copy,
  BarChart3,
  Target,
  Zap,
  Star,
  Search,
  ExternalLink,
  ListChecks,
  Layers,
  TrendingDown,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

// Grade color mapping
function gradeColor(grade: string) {
  switch (grade) {
    case "A": return "bg-green-100 text-green-800 border-green-300";
    case "B": return "bg-blue-100 text-blue-800 border-blue-300";
    case "C": return "bg-yellow-100 text-yellow-800 border-yellow-300";
    case "D": return "bg-orange-100 text-orange-800 border-orange-300";
    case "F": return "bg-red-100 text-red-800 border-red-300";
    default: return "bg-gray-100 text-gray-800 border-gray-300";
  }
}

function scoreColor(score: number) {
  if (score >= 85) return "text-green-600";
  if (score >= 70) return "text-blue-600";
  if (score >= 50) return "text-yellow-600";
  if (score >= 30) return "text-orange-600";
  return "text-red-600";
}

function progressColor(score: number, max: number) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  if (pct >= 80) return "bg-green-500";
  if (pct >= 60) return "bg-blue-500";
  if (pct >= 40) return "bg-yellow-500";
  return "bg-red-500";
}

export default function ShopeeOptimizer() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [filterGrade, setFilterGrade] = useState<string>("all");
  const [filterProblem, setFilterProblem] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [optimizedTitle, setOptimizedTitle] = useState<any>(null);
  const [optimizedDesc, setOptimizedDesc] = useState<any>(null);
  const [showTitleDialog, setShowTitleDialog] = useState(false);
  const [showDescDialog, setShowDescDialog] = useState(false);
  const [showSuggestionsDialog, setShowSuggestionsDialog] = useState(false);
  const [showChecklistDialog, setShowChecklistDialog] = useState(false);
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [checklist, setChecklist] = useState<any>(null);
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [batchOptimizing, setBatchOptimizing] = useState(false);
  const [batchResults, setBatchResults] = useState<any>(null);

  const { data: accounts } = trpc.shopee.getAccounts.useQuery();
  const { data: diagnostics, isLoading: diagLoading, refetch: refetchDiag } =
    trpc.shopee.getBatchDiagnostics.useQuery(
      { accountId: selectedAccountId! },
      { enabled: !!selectedAccountId }
    );
  const { data: productDetail } = trpc.shopee.getProductDiagnostic.useQuery(
    { productId: selectedProductId! },
    { enabled: !!selectedProductId }
  );

  const optimizeTitleMutation = trpc.shopee.optimizeTitle.useMutation();
  const optimizeDescMutation = trpc.shopee.optimizeDescription.useMutation();
  const getSuggestionsMutation = trpc.shopee.getOptimizationSuggestions.useMutation();
  const getChecklistQuery = trpc.shopee.getProductChecklist.useQuery(
    { productId: selectedProductId! },
    { enabled: !!selectedProductId }
  );
  const getUrlsQuery = trpc.shopee.getProductUrls.useQuery(
    { accountId: selectedAccountId!, productId: selectedProductId! },
    { enabled: !!selectedAccountId && !!selectedProductId }
  );
  const batchOptimizeTitlesMutation = trpc.shopee.batchOptimizeTitles.useMutation();
  const batchOptimizeDescsMutation = trpc.shopee.batchOptimizeDescriptions.useMutation();

  // Auto-select first active account
  const activeAccounts = useMemo(
    () => (accounts || []).filter((a: any) => a.isActive),
    [accounts]
  );

  if (activeAccounts.length > 0 && !selectedAccountId) {
    setSelectedAccountId(activeAccounts[0].id);
  }

  // Filter products
  const filteredProducts = useMemo(() => {
    if (!diagnostics?.products) return [];
    let filtered = diagnostics.products;
    if (filterGrade !== "all") {
      filtered = filtered.filter((p: any) => p.grade === filterGrade);
    }
    if (filterProblem !== "all") {
      filtered = filtered.filter((p: any) => {
        const issues = Object.values(p.categories).flatMap((cat: any) => cat.issues);
        const issuesStr = issues.join(" ").toLowerCase();
        return issuesStr.includes(filterProblem.toLowerCase());
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((p: any) => p.itemName?.toLowerCase().includes(q));
    }
    return filtered;
  }, [diagnostics, filterGrade, filterProblem, searchQuery]);

  // Count perfect products
  const perfectCount = useMemo(() => {
    return (diagnostics?.products || []).filter((p: any) => p.grade === "A").length;
  }, [diagnostics]);

  const handleOptimizeTitle = async (productId: number) => {
    try {
      const result = await optimizeTitleMutation.mutateAsync({ productId });
      setOptimizedTitle(result);
      setShowTitleDialog(true);
    } catch (error: any) {
      toast.error(`Erro ao otimizar título: ${error.message}`);
    }
  };

  const handleOptimizeDesc = async (productId: number) => {
    try {
      const result = await optimizeDescMutation.mutateAsync({ productId });
      setOptimizedDesc(result);
      setShowDescDialog(true);
    } catch (error: any) {
      toast.error(`Erro ao otimizar descrição: ${error.message}`);
    }
  };

  const handleGetSuggestions = async (productId: number) => {
    try {
      console.log("[ShopeeOptimizer] Fetching suggestions for product:", productId);
      const result = await getSuggestionsMutation.mutateAsync({ productId });
      console.log("[ShopeeOptimizer] Suggestions result:", result);
      setSuggestions(result);
      setShowSuggestionsDialog(true);
      console.log("[ShopeeOptimizer] Dialog should be visible now");
    } catch (error: any) {
      console.error("[ShopeeOptimizer] Error getting suggestions:", error);
      toast.error(`Erro ao gerar sugestões: ${error.message}`);
    }
  };

  const handleGetChecklist = async (productId: number) => {
    if (getChecklistQuery.data) {
      setChecklist(getChecklistQuery.data);
      setShowChecklistDialog(true);
    }
  };

  const handleOpenShopee = async (productId: number) => {
    if (getUrlsQuery.data) {
      window.open(getUrlsQuery.data.shopeeUrl, "_blank");
    }
  };

  const handleOpenSellerCenter = async (productId: number) => {
    if (getUrlsQuery.data) {
      window.open(getUrlsQuery.data.sellerCenterUrl, "_blank");
    }
  };

  const handleBatchOptimize = async (type: "titles" | "descriptions") => {
    if (selectedProducts.size === 0) {
      toast.error("Selecione pelo menos um produto");
      return;
    }
    try {
      setBatchOptimizing(true);
      const productIds = Array.from(selectedProducts);
      const result = type === "titles"
        ? await batchOptimizeTitlesMutation.mutateAsync({ productIds })
        : await batchOptimizeDescsMutation.mutateAsync({ productIds });
      setBatchResults({ type, results: result });
      toast.success(`${result.length} produtos otimizados!`);
    } catch (error: any) {
      toast.error(`Erro na otimização em lote: ${error.message}`);
    } finally {
      setBatchOptimizing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado para a área de transferência!");
  };

  // ========== PRODUCT DETAIL VIEW ==========
  if (selectedProductId && productDetail) {
    const { product, diagnostic } = productDetail;
    return (
      <div className="space-y-6">
        {/* Back button */}
        <Button variant="ghost" onClick={() => setSelectedProductId(null)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Voltar para lista
        </Button>

        {/* Product Header */}
        <div className="flex items-start gap-4">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.itemName || ""} className="h-24 w-24 rounded-xl object-cover border" />
          ) : (
            <div className="h-24 w-24 rounded-xl bg-muted flex items-center justify-center">
              <Package className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1">
            <h1 className="text-xl font-bold">{product.itemName}</h1>
            <div className="flex items-center gap-3 mt-2">
              <Badge className={`text-lg px-3 py-1 ${gradeColor(diagnostic.grade)}`}>
                Nota {diagnostic.grade}
              </Badge>
              <span className={`text-2xl font-bold ${scoreColor(diagnostic.overallScore)}`}>
                {diagnostic.overallScore}/100
              </span>
              <span className="text-muted-foreground">|</span>
              <span className="text-sm text-muted-foreground">R$ {product.price}</span>
              <span className="text-sm text-muted-foreground">Vendas: {product.sold}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => handleOpenShopee(product.id)}
              className="gap-2"
              variant="outline"
            >
              <ExternalLink className="h-4 w-4" />
              Ver na Shopee
            </Button>
            <Button
              onClick={() => handleOpenSellerCenter(product.id)}
              className="gap-2"
              variant="outline"
            >
              <ExternalLink className="h-4 w-4" />
              Editar no Seller Center
            </Button>
          </div>
        </div>

        {/* Tabs for Diagnostics and Checklist */}
        <Tabs defaultValue="diagnostics" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="diagnostics">Diagnóstico</TabsTrigger>
            <TabsTrigger value="checklist">Checklist Perfeito</TabsTrigger>
          </TabsList>

          <TabsContent value="diagnostics" className="space-y-4">
            {/* Score Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Title */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                        <Tag className="h-4 w-4 text-blue-600" />
                      </div>
                      <CardTitle className="text-sm">Título</CardTitle>
                    </div>
                    <span className={`font-bold ${scoreColor((diagnostic.categories.title.score / diagnostic.categories.title.maxScore) * 100)}`}>
                      {diagnostic.categories.title.score}/{diagnostic.categories.title.maxScore}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={(diagnostic.categories.title.score / diagnostic.categories.title.maxScore) * 100}
                    className="h-2 mb-3"
                  />
                  <p className="text-xs text-muted-foreground mb-2">{product.itemName?.length || 0} caracteres</p>
                  {diagnostic.categories.title.issues.map((issue: string, i: number) => (
                    <p key={i} className="text-xs text-red-600 flex items-start gap-1 mb-1">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      {issue}
                    </p>
                  ))}
                  {diagnostic.categories.title.suggestions.map((sug: string, i: number) => (
                    <p key={i} className="text-xs text-blue-600 flex items-start gap-1 mb-1">
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
                      {sug}
                    </p>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-3 gap-2"
                    onClick={() => handleOptimizeTitle(product.id)}
                    disabled={optimizeTitleMutation.isPending}
                  >
                    {optimizeTitleMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Otimizar com IA
                  </Button>
                </CardContent>
              </Card>

              {/* Description */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-purple-100 flex items-center justify-center">
                        <FileText className="h-4 w-4 text-purple-600" />
                      </div>
                      <CardTitle className="text-sm">Descrição</CardTitle>
                    </div>
                    <span className={`font-bold ${scoreColor((diagnostic.categories.description.score / diagnostic.categories.description.maxScore) * 100)}`}>
                      {diagnostic.categories.description.score}/{diagnostic.categories.description.maxScore}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={(diagnostic.categories.description.score / diagnostic.categories.description.maxScore) * 100}
                    className="h-2 mb-3"
                  />
                  <p className="text-xs text-muted-foreground mb-2">
                    {(product.description || "").split(/\s+/).filter((w: string) => w.length > 0).length} palavras
                  </p>
                  {diagnostic.categories.description.issues.map((issue: string, i: number) => (
                    <p key={i} className="text-xs text-red-600 flex items-start gap-1 mb-1">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      {issue}
                    </p>
                  ))}
                  {diagnostic.categories.description.suggestions.map((sug: string, i: number) => (
                    <p key={i} className="text-xs text-blue-600 flex items-start gap-1 mb-1">
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
                      {sug}
                    </p>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-3 gap-2"
                    onClick={() => handleOptimizeDesc(product.id)}
                    disabled={optimizeDescMutation.isPending}
                  >
                    {optimizeDescMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Otimizar com IA
                  </Button>
                </CardContent>
              </Card>

              {/* Images */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-green-100 flex items-center justify-center">
                        <Image className="h-4 w-4 text-green-600" />
                      </div>
                      <CardTitle className="text-sm">Imagens</CardTitle>
                    </div>
                    <span className={`font-bold ${scoreColor((diagnostic.categories.images.score / diagnostic.categories.images.maxScore) * 100)}`}>
                      {diagnostic.categories.images.score}/{diagnostic.categories.images.maxScore}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={(diagnostic.categories.images.score / diagnostic.categories.images.maxScore) * 100}
                    className="h-2 mb-3"
                  />
                  <p className="text-xs text-muted-foreground mb-2">{(product.images || []).length} imagens</p>
                  {diagnostic.categories.images.issues.map((issue: string, i: number) => (
                    <p key={i} className="text-xs text-red-600 flex items-start gap-1 mb-1">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      {issue}
                    </p>
                  ))}
                  {diagnostic.categories.images.suggestions.map((sug: string, i: number) => (
                    <p key={i} className="text-xs text-blue-600 flex items-start gap-1 mb-1">
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
                      {sug}
                    </p>
                  ))}
                </CardContent>
              </Card>

              {/* Video */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-red-100 flex items-center justify-center">
                        <Video className="h-4 w-4 text-red-600" />
                      </div>
                      <CardTitle className="text-sm">Vídeo</CardTitle>
                    </div>
                    <span className={`font-bold ${scoreColor((diagnostic.categories.video.score / diagnostic.categories.video.maxScore) * 100)}`}>
                      {diagnostic.categories.video.score}/{diagnostic.categories.video.maxScore}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={(diagnostic.categories.video.score / diagnostic.categories.video.maxScore) * 100}
                    className="h-2 mb-3"
                  />
                  <p className="text-xs text-muted-foreground mb-2">{product.hasVideo ? "Presente" : "Ausente"}</p>
                  {diagnostic.categories.video.issues.map((issue: string, i: number) => (
                    <p key={i} className="text-xs text-red-600 flex items-start gap-1 mb-1">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      {issue}
                    </p>
                  ))}
                  {diagnostic.categories.video.suggestions.map((sug: string, i: number) => (
                    <p key={i} className="text-xs text-blue-600 flex items-start gap-1 mb-1">
                      <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
                      {sug}
                    </p>
                  ))}
                </CardContent>
              </Card>

              {/* Attributes */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-yellow-100 flex items-center justify-center">
                        <Tag className="h-4 w-4 text-yellow-600" />
                      </div>
                      <CardTitle className="text-sm">Atributos</CardTitle>
                    </div>
                    <span className={`font-bold ${scoreColor((diagnostic.categories.attributes.score / diagnostic.categories.attributes.maxScore) * 100)}`}>
                      {diagnostic.categories.attributes.score}/{diagnostic.categories.attributes.maxScore}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={(diagnostic.categories.attributes.score / diagnostic.categories.attributes.maxScore) * 100}
                    className="h-2 mb-3"
                  />
                  <p className="text-xs text-muted-foreground mb-2">
                    {product.attributesFilled}/{product.attributesTotal}
                  </p>
                  {diagnostic.categories.attributes.issues.map((issue: string, i: number) => (
                    <p key={i} className="text-xs text-red-600 flex items-start gap-1 mb-1">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      {issue}
                    </p>
                  ))}
                </CardContent>
              </Card>

              {/* Dimensions */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-cyan-100 flex items-center justify-center">
                        <Ruler className="h-4 w-4 text-cyan-600" />
                      </div>
                      <CardTitle className="text-sm">Dimensões</CardTitle>
                    </div>
                    <span className={`font-bold ${scoreColor((diagnostic.categories.dimensions.score / diagnostic.categories.dimensions.maxScore) * 100)}`}>
                      {diagnostic.categories.dimensions.score}/{diagnostic.categories.dimensions.maxScore}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <Progress
                    value={(diagnostic.categories.dimensions.score / diagnostic.categories.dimensions.maxScore) * 100}
                    className="h-2 mb-3"
                  />
                  <p className="text-xs text-muted-foreground mb-2">
                    {product.weight ? `${product.weight} kg` : "Sem peso"}
                  </p>
                  {diagnostic.categories.dimensions.issues.map((issue: string, i: number) => (
                    <p key={i} className="text-xs text-red-600 flex items-start gap-1 mb-1">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      {issue}
                    </p>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Suggestions Button */}
            <Button
              onClick={() => {
                console.log("[DEBUG] Button clicked!");
                handleGetSuggestions(product.id);
              }}
              disabled={getSuggestionsMutation.isPending}
              className="w-full gap-2"
            >
              {getSuggestionsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Ver Sugestões de Otimização
            </Button>
          </TabsContent>

          <TabsContent value="checklist" className="space-y-4">
            <Button
              onClick={() => handleGetChecklist(product.id)}
              disabled={getChecklistQuery.isLoading}
              className="w-full gap-2"
            >
              {getChecklistQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
              Gerar Checklist Perfeito
            </Button>
            {checklist && (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <span className="font-medium">{checklist.completedCount}/{checklist.totalCount} itens concluídos</span>
                  <span className={`text-lg font-bold ${scoreColor((checklist.completionPercent / 100) * 100)}`}>
                    {checklist.completionPercent}%
                  </span>
                </div>
                <Progress value={checklist.completionPercent} className="h-2" />
                <div className="space-y-2">
                  {checklist.items.map((item: any) => (
                    <Card key={item.id}>
                      <CardContent className="py-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-1">
                            {item.status === "done" ? (
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                            ) : item.status === "partial" ? (
                              <AlertTriangle className="h-5 w-5 text-yellow-600" />
                            ) : (
                              <XCircle className="h-5 w-5 text-red-600" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{item.label}</span>
                              <Badge variant="outline" className="text-xs">
                                {item.category}
                              </Badge>
                              <Badge className={
                                item.impact === "critical" ? "bg-red-100 text-red-800" :
                                item.impact === "high" ? "bg-orange-100 text-orange-800" :
                                item.impact === "medium" ? "bg-yellow-100 text-yellow-800" :
                                "bg-blue-100 text-blue-800"
                              }>
                                {item.impact}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">
                              Atual: {item.currentValue} → Alvo: {item.targetValue}
                            </p>
                            {item.actionRequired !== "OK" && (
                              <p className="text-xs text-blue-600 font-medium">{item.actionRequired}</p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // ========== MAIN LIST VIEW ==========
  return (
    <div className="space-y-6">
      {/* Header */}
      {selectedAccountId && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(v) => setSelectedAccountId(parseInt(v))}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Selecione uma conta" />
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((acc: any) => (
                  <SelectItem key={acc.id} value={acc.id.toString()}>
                    {acc.shopName || `Loja ${acc.shopId}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchDiag()}
              disabled={diagLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${diagLoading ? "animate-spin" : ""}`} />
              Atualizar Diagnóstico
            </Button>
          </div>
          {selectedProducts.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {selectedProducts.size} selecionado(s)
              </span>
              <Button
                size="sm"
                onClick={() => handleBatchOptimize("titles")}
                disabled={batchOptimizing}
                className="gap-2"
              >
                {batchOptimizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                Otimizar Títulos
              </Button>
              <Button
                size="sm"
                onClick={() => handleBatchOptimize("descriptions")}
                disabled={batchOptimizing}
                className="gap-2"
              >
                {batchOptimizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                Otimizar Descrições
              </Button>
            </div>
          )}
        </div>
      )}

      {!selectedAccountId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-16 w-16 rounded-full bg-orange-100 flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-orange-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Nenhuma conta selecionada</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Conecte uma loja Shopee na página de Contas e sincronize os produtos para começar a otimizar.
            </p>
          </CardContent>
        </Card>
      )}

      {diagLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Analisando produtos...</span>
        </div>
      )}

      {/* Summary Dashboard */}
      {diagnostics && !diagLoading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Average Score */}
            <Card className="border-l-4 border-l-orange-500">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-orange-100 flex items-center justify-center">
                    <Target className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Score Médio</p>
                    <p className={`text-3xl font-bold ${scoreColor(diagnostics.avgScore)}`}>
                      {diagnostics.avgScore}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Perfect Products */}
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-green-100 flex items-center justify-center">
                    <Star className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Anúncios Perfeitos</p>
                    <p className="text-3xl font-bold text-green-600">{perfectCount}</p>
                    <p className="text-xs text-muted-foreground">
                      {diagnostics.total > 0 ? Math.round((perfectCount / diagnostics.total) * 100) : 0}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Grade Cards */}
            {(["A", "B", "C", "D"] as const).map((grade) => {
              const count = diagnostics.gradeDistribution[grade];
              const pct = diagnostics.total > 0 ? Math.round((count / diagnostics.total) * 100) : 0;
              const icons: Record<string, any> = { A: Star, B: TrendingUp, C: AlertTriangle, D: TrendingDown };
              const colors: Record<string, string> = {
                A: "text-green-600 bg-green-100",
                B: "text-blue-600 bg-blue-100",
                C: "text-yellow-600 bg-yellow-100",
                D: "text-red-600 bg-red-100",
              };
              const Icon = icons[grade];
              return (
                <Card key={grade} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilterGrade(filterGrade === grade ? "all" : grade)}>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${colors[grade]}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Nota {grade}</p>
                        <p className="text-2xl font-bold">{count}</p>
                        <p className="text-xs text-muted-foreground">{pct}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Top Issues */}
          {diagnostics.topIssues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Problemas Mais Comuns
                </CardTitle>
                <CardDescription>Resolva estes problemas para melhorar o ranking de todos os produtos</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {diagnostics.topIssues.slice(0, 5).map((issue: any, i: number) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-sm">{issue.issue}</p>
                        <Progress value={issue.percent} className="h-1.5 mt-1" />
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {issue.count} ({issue.percent}%)
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterGrade} onValueChange={setFilterGrade}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as notas</SelectItem>
                <SelectItem value="A">Nota A</SelectItem>
                <SelectItem value="B">Nota B</SelectItem>
                <SelectItem value="C">Nota C</SelectItem>
                <SelectItem value="D">Nota D</SelectItem>
                <SelectItem value="F">Nota F</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterProblem} onValueChange={setFilterProblem}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filtrar por problema" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                <SelectItem value="vídeo">Sem vídeo</SelectItem>
                <SelectItem value="título">Título curto/longo</SelectItem>
                <SelectItem value="descrição">Descrição curta</SelectItem>
                <SelectItem value="imagens">Poucas imagens</SelectItem>
                <SelectItem value="atributos">Atributos incompletos</SelectItem>
                <SelectItem value="dimensões">Dimensões faltando</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {filteredProducts.length} de {diagnostics.total}
            </span>
          </div>

          {/* Products List */}
          <div className="space-y-2">
            {filteredProducts.map((product: any) => (
              <Card
                key={product.productId}
                className="cursor-pointer hover:shadow-md transition-all"
              >
                <CardContent className="py-3">
                  <div className="flex items-center gap-4">
                    <Checkbox
                      checked={selectedProducts.has(product.productId)}
                      onCheckedChange={(checked) => {
                        const newSelected = new Set(selectedProducts);
                        if (checked) {
                          newSelected.add(product.productId);
                        } else {
                          newSelected.delete(product.productId);
                        }
                        setSelectedProducts(newSelected);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.itemName} className="h-14 w-14 rounded-lg object-cover border" />
                    ) : (
                      <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center">
                        <Package className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => setSelectedProductId(product.productId)}
                    >
                      <p className="font-medium truncate">{product.itemName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">R$ {product.price}</span>
                        <span className="text-xs text-muted-foreground">Vendas: {product.sold}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Mini score bars */}
                      <div className="hidden md:flex items-center gap-1">
                        {Object.entries(product.categories).map(([key, cat]: [string, any]) => (
                          <div key={key} className="w-8" title={`${key}: ${cat.score}/${cat.maxScore}`}>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${progressColor(cat.score, cat.maxScore)}`}
                                style={{ width: `${cat.maxScore > 0 ? (cat.score / cat.maxScore) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <Badge className={`${gradeColor(product.grade)} font-bold min-w-[3rem] justify-center`}>
                        {product.grade}
                      </Badge>
                      <span className={`text-lg font-bold min-w-[3rem] text-right ${scoreColor(product.overallScore)}`}>
                        {product.overallScore}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredProducts.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {searchQuery || filterGrade !== "all" || filterProblem !== "all"
                    ? "Nenhum produto encontrado com os filtros selecionados."
                    : "Nenhum produto sincronizado. Sincronize os produtos na página de Contas Shopee."}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ========== DIALOGS ========== */}

      {/* Optimized Title Dialog */}
      <Dialog open={showTitleDialog} onOpenChange={setShowTitleDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-orange-500" />
              Título Otimizado por IA
            </DialogTitle>
            <DialogDescription>
              Copie o título otimizado e atualize no Seller Center da Shopee.
            </DialogDescription>
          </DialogHeader>
          {optimizedTitle && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Título Otimizado</label>
                <div className="relative">
                  <Textarea
                    value={optimizedTitle.optimizedTitle}
                    readOnly
                    className="pr-10 min-h-[80px]"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(optimizedTitle.optimizedTitle)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {optimizedTitle.optimizedTitle.length} caracteres
                </p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Palavras-chave</label>
                <div className="flex flex-wrap gap-1">
                  {optimizedTitle.keywords.map((kw: string, i: number) => (
                    <Badge key={i} variant="secondary">{kw}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Explicação</label>
                <p className="text-sm text-muted-foreground">{optimizedTitle.explanation}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Optimized Description Dialog */}
      <Dialog open={showDescDialog} onOpenChange={setShowDescDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-purple-500" />
              Descrição Otimizada por IA
            </DialogTitle>
            <DialogDescription>
              Copie a descrição otimizada e atualize no Seller Center da Shopee.
            </DialogDescription>
          </DialogHeader>
          {optimizedDesc && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Descrição Otimizada</label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(optimizedDesc.optimizedDescription)}
                    className="gap-1"
                  >
                    <Copy className="h-3 w-3" />
                    Copiar
                  </Button>
                </div>
                <Textarea
                  value={optimizedDesc.optimizedDescription}
                  readOnly
                  className="min-h-[300px] text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {optimizedDesc.wordCount} palavras
                </p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Explicação</label>
                <p className="text-sm text-muted-foreground">{optimizedDesc.explanation}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Suggestions Dialog */}
      <Dialog open={showSuggestionsDialog} onOpenChange={setShowSuggestionsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-orange-500" />
              Sugestões de Otimização
            </DialogTitle>
            <DialogDescription>
              Recomendações priorizadas para melhorar o ranking deste produto.
            </DialogDescription>
          </DialogHeader>
          {suggestions && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Prioridade:</span>
                <Badge className={
                  suggestions.priority === "alta" ? "bg-red-100 text-red-800" :
                  suggestions.priority === "média" ? "bg-yellow-100 text-yellow-800" :
                  "bg-green-100 text-green-800"
                }>
                  {suggestions.priority.charAt(0).toUpperCase() + suggestions.priority.slice(1)}
                </Badge>
              </div>

              {/* Quick Wins */}
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  Vitórias Rápidas
                </h3>
                <div className="space-y-2">
                  {suggestions.quickWins.map((win: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 p-2 bg-yellow-50 rounded-lg">
                      <CheckCircle2 className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                      <p className="text-sm">{win}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed Suggestions */}
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Target className="h-4 w-4 text-blue-500" />
                  Recomendações Detalhadas
                </h3>
                <div className="space-y-3">
                  {suggestions.detailedSuggestions.map((sug: any, i: number) => (
                    <Card key={i}>
                      <CardContent className="py-3">
                        <div className="flex items-start justify-between mb-1">
                          <Badge variant="outline">{sug.area}</Badge>
                          <Badge className={
                            sug.impact === "alto" ? "bg-red-100 text-red-800" :
                            sug.impact === "médio" ? "bg-yellow-100 text-yellow-800" :
                            "bg-blue-100 text-blue-800"
                          }>
                            Impacto {sug.impact}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Atual: {sug.currentStatus}</p>
                        <p className="text-sm mt-1 font-medium">{sug.recommendation}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Checklist Dialog */}
      <Dialog open={showChecklistDialog} onOpenChange={setShowChecklistDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-blue-500" />
              Checklist para Anúncio Perfeito
            </DialogTitle>
            <DialogDescription>
              Siga este checklist para atingir nota A (100/100)
            </DialogDescription>
          </DialogHeader>
          {checklist && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <span className="font-medium">{checklist.completedCount}/{checklist.totalCount} itens concluídos</span>
                <span className={`text-lg font-bold ${scoreColor((checklist.completionPercent / 100) * 100)}`}>
                  {checklist.completionPercent}%
                </span>
              </div>
              <Progress value={checklist.completionPercent} className="h-2" />
              <div className="space-y-2">
                {checklist.items.map((item: any) => (
                  <Card key={item.id}>
                    <CardContent className="py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-1">
                          {item.status === "done" ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          ) : item.status === "partial" ? (
                            <AlertTriangle className="h-5 w-5 text-yellow-600" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-600" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{item.label}</span>
                            <Badge variant="outline" className="text-xs">
                              {item.category}
                            </Badge>
                            <Badge className={
                              item.impact === "critical" ? "bg-red-100 text-red-800" :
                              item.impact === "high" ? "bg-orange-100 text-orange-800" :
                              item.impact === "medium" ? "bg-yellow-100 text-yellow-800" :
                              "bg-blue-100 text-blue-800"
                            }>
                              {item.impact}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mb-1">
                            Atual: {item.currentValue} → Alvo: {item.targetValue}
                          </p>
                          {item.actionRequired !== "OK" && (
                            <p className="text-xs text-blue-600 font-medium">{item.actionRequired}</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
