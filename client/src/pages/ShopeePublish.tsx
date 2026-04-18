import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Upload,
  Search,
  Package,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Store,
  Image as ImageIcon,
  Tag,
  Truck,
  Layers,
} from "lucide-react";

export default function ShopeePublish() {
  const { user } = useAuth();


  // Step state
  const [step, setStep] = useState(1);

  // Step 1: Select Shopee account
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  // Step 2: Select products from BaseLinker
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInventory, setSelectedInventory] = useState<number | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // Step 3: Configure category & options
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [categoryPath, setCategoryPath] = useState<Array<{ id: number; name: string }>>([]);
  const [createKits, setCreateKits] = useState(true);
  const [kitQuantities, setKitQuantities] = useState([2, 3, 4]);
  const [kitDiscounts, setKitDiscounts] = useState([5, 10, 15]);

  // Step 4: Publishing results
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<any>(null);

  // Queries
  const shopeeAccounts = trpc.shopee.getAccounts.useQuery(undefined, {
    enabled: !!user,
  });

  const inventories = trpc.baselinker.getInventories.useQuery(undefined, {
    enabled: !!user,
  });

  const products = trpc.baselinker.filterProducts.useQuery(
    {
      inventoryId: selectedInventory!,
      filters: {
        searchName: searchQuery || undefined,
      },
      page: 1,
      pageSize: 100,
    },
    { enabled: !!selectedInventory }
  );

  const categories = trpc.shopee.getCategories.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId && step >= 3 }
  );

  const publishMutation = trpc.shopee.publishProducts.useMutation({
    onSuccess: (data) => {
      setPublishResults(data);
      setIsPublishing(false);
      setStep(4);
      toast.success(`${data.success} de ${data.total} produtos publicados com sucesso.`);
    },
    onError: (error) => {
      setIsPublishing(false);
      toast.error(`Erro na publicação: ${error.message}`);
    },
  });

  // Active Shopee accounts
  const activeAccounts = useMemo(
    () => (shopeeAccounts.data || []).filter((a) => a.isActive),
    [shopeeAccounts.data]
  );

  // Filter categories by level
  const rootCategories = useMemo(() => {
    if (!categories.data) return [];
    return categories.data.filter((c: any) => c.parent_category_id === 0);
  }, [categories.data]);

  const getChildCategories = (parentId: number) => {
    if (!categories.data) return [];
    return categories.data.filter((c: any) => c.parent_category_id === parentId);
  };

  // Toggle product selection
  const toggleProduct = (id: number) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle select all
  useEffect(() => {
    if (selectAll && products.data?.products) {
      setSelectedProducts(new Set(products.data.products.map((p: any) => p.id)));
    } else if (!selectAll) {
      setSelectedProducts(new Set());
    }
  }, [selectAll]);

  // Handle publish
  const handlePublish = () => {
    if (!selectedAccountId || !selectedInventory || !selectedCategoryId || selectedProducts.size === 0) {
      toast.error("Selecione conta, produtos e categoria antes de publicar.");
      return;
    }

    setIsPublishing(true);
    publishMutation.mutate({
      accountId: selectedAccountId,
      inventoryId: selectedInventory,
      productIds: Array.from(selectedProducts),
      categoryId: selectedCategoryId,
      createKits,
      kitQuantities: createKits ? kitQuantities : undefined,
      kitDiscounts: createKits ? kitDiscounts : undefined,
    });
  };

  // Navigate category tree
  const selectCategory = (cat: any) => {
    const children = getChildCategories(cat.category_id);
    if (children.length > 0) {
      setCategoryPath((prev) => [
        ...prev,
        { id: cat.category_id, name: cat.display_category_name || cat.original_category_name },
      ]);
    } else {
      // Leaf category - select it
      setSelectedCategoryId(cat.category_id);
      setCategoryPath((prev) => [
        ...prev,
        { id: cat.category_id, name: cat.display_category_name || cat.original_category_name },
      ]);
    }
  };

  const goBackCategory = (index: number) => {
    setCategoryPath((prev) => prev.slice(0, index));
    setSelectedCategoryId(null);
  };

  const currentParentId = categoryPath.length > 0 ? categoryPath[categoryPath.length - 1].id : 0;
  const visibleCategories = categoryPath.length === 0 ? rootCategories : getChildCategories(currentParentId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Publicar na Shopee</h1>
        <p className="text-muted-foreground mt-1">
          Envie produtos do BaseLinker diretamente para sua loja Shopee via API
        </p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2">
        {[
          { n: 1, label: "Conta", icon: Store },
          { n: 2, label: "Produtos", icon: Package },
          { n: 3, label: "Configurar", icon: Tag },
          { n: 4, label: "Resultado", icon: CheckCircle2 },
        ].map(({ n, label, icon: Icon }) => (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                step === n
                  ? "bg-primary text-primary-foreground"
                  : step > n
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </div>
            {n < 4 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Shopee Account */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" />
              Selecione a Loja Shopee
            </CardTitle>
            <CardDescription>
              Escolha em qual loja Shopee os produtos serão publicados
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeAccounts.length === 0 ? (
              <div className="text-center py-8">
                <Store className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">
                  Nenhuma loja Shopee conectada. Conecte uma loja primeiro.
                </p>
                <Button onClick={() => (window.location.href = "/shopee-accounts")}>
                  Conectar Loja Shopee
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                {activeAccounts.map((account) => (
                  <div
                    key={account.id}
                    className={`flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-colors hover:bg-accent ${
                      selectedAccountId === account.id
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                    onClick={() => setSelectedAccountId(account.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                        <Store className="h-5 w-5 text-orange-600" />
                      </div>
                      <div>
                        <p className="font-medium">{account.shopName}</p>
                        <p className="text-sm text-muted-foreground">
                          Shop ID: {account.shopId} · {account.totalProducts || 0} produtos
                        </p>
                      </div>
                    </div>
                    {selectedAccountId === account.id && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                  </div>
                ))}
                <Button
                  className="mt-4"
                  disabled={!selectedAccountId}
                  onClick={() => setStep(2)}
                >
                  Continuar <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Select Products */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Selecione os Produtos
            </CardTitle>
            <CardDescription>
              Escolha os produtos do BaseLinker para publicar na Shopee
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Inventory selector */}
            <div className="flex gap-3">
              <div className="flex-1">
                <Label>Inventário BaseLinker</Label>
                <Select
                  value={selectedInventory?.toString() || ""}
                  onValueChange={(v) => {
                    setSelectedInventory(parseInt(v));
                    setSelectedProducts(new Set());
                    setSelectAll(false);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um inventário" />
                  </SelectTrigger>
                  <SelectContent>
                    {(inventories.data || []).map((inv: any) => (
                      <SelectItem key={inv.inventory_id} value={inv.inventory_id.toString()}>
                        {inv.name} ({inv.count || 0} produtos)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label>Buscar</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nome ou SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            {/* Product list */}
            {selectedInventory && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectAll}
                      onCheckedChange={(v) => setSelectAll(!!v)}
                    />
                    <span className="text-sm">Selecionar todos</span>
                  </div>
                  <Badge variant="secondary">
                    {selectedProducts.size} selecionados
                  </Badge>
                </div>

                <div className="max-h-[400px] overflow-y-auto border rounded-lg divide-y">
                  {products.isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    (products.data?.products || []).map((product: any) => (
                      <div
                        key={product.id}
                        className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-accent transition-colors ${
                          selectedProducts.has(product.id) ? "bg-primary/5" : ""
                        }`}
                        onClick={() => toggleProduct(product.id)}
                      >
                        <Checkbox checked={selectedProducts.has(product.id)} />
                        <div className="h-10 w-10 rounded bg-muted flex-shrink-0 overflow-hidden">
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="h-5 w-5 m-auto text-muted-foreground mt-2.5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {product.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            SKU: {product.sku || "—"} · R$ {product.price?.toFixed(2) || "0.00"}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Est: {product.stock || 0}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button
                disabled={selectedProducts.size === 0}
                onClick={() => setStep(3)}
              >
                Continuar ({selectedProducts.size} produtos) <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Configure */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Category Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                Categoria Shopee
              </CardTitle>
              <CardDescription>
                Selecione a categoria dos produtos na Shopee (navegue até a categoria final)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Breadcrumb */}
              {categoryPath.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap text-sm">
                  <button
                    className="text-primary hover:underline"
                    onClick={() => goBackCategory(0)}
                  >
                    Todas
                  </button>
                  {categoryPath.map((cp, i) => (
                    <span key={cp.id} className="flex items-center gap-1">
                      <span className="text-muted-foreground">/</span>
                      <button
                        className={`hover:underline ${
                          i === categoryPath.length - 1 ? "font-medium" : "text-primary"
                        }`}
                        onClick={() => goBackCategory(i + 1)}
                      >
                        {cp.name}
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {selectedCategoryId ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <span className="font-medium text-green-700 dark:text-green-400">
                    Categoria selecionada: {categoryPath.map((c) => c.name).join(" > ")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCategoryPath([]);
                      setSelectedCategoryId(null);
                    }}
                  >
                    Alterar
                  </Button>
                </div>
              ) : categories.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="ml-2 text-muted-foreground">Carregando categorias...</span>
                </div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto border rounded-lg divide-y">
                  {visibleCategories.map((cat: any) => {
                    const children = getChildCategories(cat.category_id);
                    return (
                      <div
                        key={cat.category_id}
                        className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => selectCategory(cat)}
                      >
                        <span className="text-sm">
                          {cat.display_category_name || cat.original_category_name}
                        </span>
                        {children.length > 0 ? (
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            Selecionar
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Kit Variations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Variações de Kit
              </CardTitle>
              <CardDescription>
                Crie variações automáticas (Kit 2, Kit 3, Kit 4) com descontos progressivos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch checked={createKits} onCheckedChange={setCreateKits} />
                <Label>Criar variações de kit automaticamente</Label>
              </div>

              {createKits && (
                <div className="grid grid-cols-3 gap-4 mt-3">
                  {kitQuantities.map((qty, i) => (
                    <div key={i} className="space-y-2 p-3 border rounded-lg">
                      <Label className="text-xs text-muted-foreground">
                        Kit {i + 1}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={qty}
                          onChange={(e) => {
                            const newQty = [...kitQuantities];
                            newQty[i] = parseInt(e.target.value) || 2;
                            setKitQuantities(newQty);
                          }}
                          className="w-20"
                          min={2}
                        />
                        <span className="text-sm text-muted-foreground">un.</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={kitDiscounts[i]}
                          onChange={(e) => {
                            const newDisc = [...kitDiscounts];
                            newDisc[i] = parseInt(e.target.value) || 0;
                            setKitDiscounts(newDisc);
                          }}
                          className="w-20"
                          min={0}
                          max={50}
                        />
                        <span className="text-sm text-muted-foreground">% desc.</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Button>
            <Button
              disabled={!selectedCategoryId || isPublishing}
              onClick={handlePublish}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Publicando {selectedProducts.size} produtos...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Publicar {selectedProducts.size} Produtos na Shopee
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Results */}
      {step === 4 && publishResults && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Resultado da Publicação
            </CardTitle>
            <CardDescription>
              {publishResults.success} de {publishResults.total} produtos publicados com sucesso
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                <p className="text-2xl font-bold text-green-600">{publishResults.success}</p>
                <p className="text-sm text-green-700 dark:text-green-400">Sucesso</p>
              </div>
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                <p className="text-2xl font-bold text-red-600">{publishResults.failed}</p>
                <p className="text-sm text-red-700 dark:text-red-400">Falhas</p>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                <p className="text-2xl font-bold text-blue-600">{publishResults.total}</p>
                <p className="text-sm text-blue-700 dark:text-blue-400">Total</p>
              </div>
            </div>

            {/* Detailed results */}
            <div className="max-h-[400px] overflow-y-auto border rounded-lg divide-y">
              {publishResults.results?.map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  {r.success ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      SKU: {r.sku}
                      {r.success && (
                        <>
                          {" "}· Item ID: {r.itemId} · {r.imagesUploaded} imagens
                          {r.hasVariations && " · Com variações de kit"}
                        </>
                      )}
                      {!r.success && r.error && (
                        <span className="text-red-600"> · {r.error}</span>
                      )}
                    </p>
                  </div>
                  {r.success && (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      Publicado
                    </Badge>
                  )}
                  {!r.success && (
                    <Badge variant="destructive">Erro</Badge>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setStep(1);
                  setPublishResults(null);
                  setSelectedProducts(new Set());
                }}
              >
                Publicar mais produtos
              </Button>
              <Button onClick={() => (window.location.href = "/shopee-products")}>
                Ver Produtos Shopee
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
