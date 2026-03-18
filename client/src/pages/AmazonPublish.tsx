import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ShoppingCart, Search, Upload, CheckCircle2, XCircle, Loader2, AlertTriangle, Package, ArrowRight } from "lucide-react";

type ProductForExport = {
  productId: string;
  name: string;
  sku: string;
  ean: string;
  price: string;
  stock: number;
  description: string;
  images: string[];
  category?: string;
  brand?: string;
  selected: boolean;
};

export default function AmazonPublish() {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [products, setProducts] = useState<ProductForExport[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishResults, setPublishResults] = useState<any[]>([]);
  const [step, setStep] = useState<"select" | "review" | "publishing" | "done">("select");

  const { data: accounts } = trpc.amazon.getAccounts.useQuery();
  const [inventoryId, setInventoryId] = useState<number>(0);
  const { data: inventories } = trpc.baselinker.getInventories.useQuery();
  const { data: blProducts, isLoading: loadingProducts, refetch: refetchProducts } = trpc.baselinker.getProducts.useQuery({
    inventoryId: inventoryId || (inventories?.[0]?.inventory_id ?? 0),
    tagName: selectedTag !== "all" ? selectedTag : undefined,
    page: 1,
  }, { enabled: !!(inventoryId || inventories?.[0]?.inventory_id) });
  const { data: tags } = trpc.baselinker.getTags.useQuery({
    inventoryId: inventoryId || (inventories?.[0]?.inventory_id ?? 0),
  }, { enabled: !!(inventoryId || inventories?.[0]?.inventory_id) });

  const publishMutation = trpc.amazon.publishProduct.useMutation();

  const activeAccounts = useMemo(() => {
    return accounts?.filter(a => a.isActive) || [];
  }, [accounts]);

  const selectedAccount = useMemo(() => {
    return activeAccounts.find(a => a.id.toString() === selectedAccountId);
  }, [activeAccounts, selectedAccountId]);

  const selectedProducts = useMemo(() => {
    return products.filter(p => p.selected);
  }, [products]);

  // Load products from BaseLinker into local state
  const handleLoadProducts = () => {
    if (!blProducts?.products) return;
    const mapped: ProductForExport[] = blProducts.products.map((p: any) => ({
      productId: p.id?.toString() || p.productId?.toString() || "",
      name: p.name || "",
      sku: p.sku || "",
      ean: p.ean || "",
      price: p.price?.toString() || "0",
      stock: p.stock || 0,
      description: p.description || "",
      images: p.imageUrl ? [p.imageUrl] : [],
      category: p.category || "",
      brand: p.manufacturer || "",
      selected: false,
    }));
    setProducts(mapped);
  };

  const toggleAll = (checked: boolean) => {
    setProducts(prev => prev.map(p => ({ ...p, selected: checked })));
  };

  const toggleProduct = (productId: string) => {
    setProducts(prev => prev.map(p =>
      p.productId === productId ? { ...p, selected: !p.selected } : p
    ));
  };

  const handlePublish = async () => {
    if (!selectedAccountId || selectedProducts.length === 0) return;

    setStep("publishing");
    setIsPublishing(true);
    setPublishProgress(0);
    setPublishResults([]);

    const results: any[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < selectedProducts.length; i += BATCH_SIZE) {
      const batch = selectedProducts.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(product =>
          publishMutation.mutateAsync({
            accountId: parseInt(selectedAccountId),
            product: {
              productId: product.productId,
              name: product.name,
              sku: product.sku,
              ean: product.ean,
              price: product.price,
              stock: product.stock,
              description: product.description,
              images: product.images,
              category: product.category,
              brand: product.brand,
            },
          })
        )
      );

      batchResults.forEach((result, idx) => {
        const product = batch[idx];
        if (result.status === "fulfilled") {
          results.push({ ...result.value, productName: product.name });
        } else {
          results.push({
            success: false,
            sku: product.sku,
            productName: product.name,
            error: result.reason?.message || "Erro desconhecido",
          });
        }
      });

      setPublishProgress(Math.round(((i + batch.length) / selectedProducts.length) * 100));
      setPublishResults([...results]);

      if (i + BATCH_SIZE < selectedProducts.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    setIsPublishing(false);
    setStep("done");

    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    if (errorCount === 0) {
      toast.success(`${successCount} produto(s) publicado(s) com sucesso na Amazon!`);
    } else {
      toast.warning(`${successCount} sucesso, ${errorCount} erro(s)`);
    }
  };

  // Step: Select Products
  if (step === "select") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publicar na Amazon</h1>
          <p className="text-muted-foreground">Selecione produtos do BaseLinker para publicar na Amazon</p>
        </div>

        {/* Account Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Selecione a Conta Amazon</CardTitle>
          </CardHeader>
          <CardContent>
            {activeAccounts.length === 0 ? (
              <div className="text-center py-4">
                <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma conta Amazon conectada.{" "}
                  <a href="/amazon-accounts" className="text-primary underline">Conectar conta</a>
                </p>
              </div>
            ) : (
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma conta..." />
                </SelectTrigger>
                <SelectContent>
                  {activeAccounts.map(account => (
                    <SelectItem key={account.id} value={account.id.toString()}>
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-orange-500" />
                        {account.sellerName || account.sellerId} — {account.marketplaceName}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Product Selection */}
        {selectedAccountId && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">2. Selecione os Produtos</CardTitle>
                <div className="flex gap-2">
                  <Select value={selectedTag} onValueChange={setSelectedTag}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Tag..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as tags</SelectItem>
                      {tags?.map((tag: string) => (
                        <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Buscar produto..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-[250px]"
                  />
                  <Button onClick={handleLoadProducts} disabled={loadingProducts} className="gap-2">
                    {loadingProducts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Buscar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {products.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={products.every(p => p.selected)}
                        onCheckedChange={(checked) => toggleAll(!!checked)}
                      />
                      <span className="text-sm font-medium">
                        {selectedProducts.length} de {products.length} selecionado(s)
                      </span>
                    </div>
                    {selectedProducts.length > 0 && (
                      <Button onClick={() => setStep("review")} className="gap-2">
                        Revisar ({selectedProducts.length})
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="max-h-[500px] overflow-y-auto space-y-1">
                    {products.map((product) => (
                      <div
                        key={product.productId}
                        className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors ${
                          product.selected ? "bg-accent/30 border-primary/30" : ""
                        }`}
                        onClick={() => toggleProduct(product.productId)}
                      >
                        <Checkbox checked={product.selected} />
                        {product.images[0] ? (
                          <img src={product.images[0]} alt="" className="h-10 w-10 rounded object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                            <Package className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            SKU: {product.sku} | EAN: {product.ean || "—"} | R$ {product.price}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Est: {product.stock}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>Clique em "Buscar" para carregar os produtos do BaseLinker</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Step: Review
  if (step === "review") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Revisar Publicação</h1>
            <p className="text-muted-foreground">
              {selectedProducts.length} produto(s) para publicar em {selectedAccount?.sellerName || selectedAccount?.sellerId}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("select")}>
              ← Voltar
            </Button>
            <Button onClick={handlePublish} className="gap-2 bg-orange-600 hover:bg-orange-700">
              <Upload className="h-4 w-4" />
              Publicar {selectedProducts.length} produto(s) na Amazon
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {selectedProducts.map((product) => (
            <Card key={product.productId}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  {product.images[0] ? (
                    <img src={product.images[0]} alt="" className="h-12 w-12 rounded object-cover" />
                  ) : (
                    <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
                      <Package className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      SKU: {product.sku} | EAN: {product.ean || "sem EAN"} | R$ {product.price} | Estoque: {product.stock}
                    </p>
                  </div>
                  {!product.ean && (
                    <Badge variant="outline" className="text-amber-600 border-amber-200">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Sem EAN
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Step: Publishing / Done
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {isPublishing ? "Publicando na Amazon..." : "Publicação Concluída"}
        </h1>
        <p className="text-muted-foreground">
          {selectedAccount?.sellerName || selectedAccount?.sellerId}
        </p>
      </div>

      {isPublishing && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Progresso</span>
                <span>{publishProgress}%</span>
              </div>
              <Progress value={publishProgress} className="h-3" />
              <p className="text-xs text-muted-foreground text-center">
                {publishResults.length} de {selectedProducts.length} processado(s)
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Summary */}
      {publishResults.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{publishResults.length}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </CardContent>
            </Card>
            <Card className="border-green-200">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-600">
                  {publishResults.filter(r => r.success).length}
                </p>
                <p className="text-xs text-muted-foreground">Sucesso</p>
              </CardContent>
            </Card>
            <Card className="border-red-200">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-600">
                  {publishResults.filter(r => !r.success).length}
                </p>
                <p className="text-xs text-muted-foreground">Erros</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            {publishResults.map((result, idx) => (
              <Card key={idx} className={result.success ? "border-green-200" : "border-red-200"}>
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    {result.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{result.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        SKU: {result.sku}
                        {result.asin && ` | ASIN: ${result.asin}`}
                        {result.submissionId && ` | Submission: ${result.submissionId}`}
                      </p>
                      {result.error && (
                        <p className="text-xs text-red-600 mt-1">{result.error}</p>
                      )}
                      {result.issues?.length > 0 && (
                        <div className="mt-1">
                          {result.issues.map((issue: any, i: number) => (
                            <p key={i} className={`text-xs ${issue.severity === "ERROR" ? "text-red-600" : "text-amber-600"}`}>
                              [{issue.severity}] {issue.message}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {!isPublishing && (
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => { setStep("select"); setPublishResults([]); }}>
                Nova Publicação
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
