import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileSpreadsheet, Loader2, Package, Download, CheckCircle, XCircle,
  ChevronLeft, ChevronRight, Search, Filter, SquareCheck, Square,
  Settings2, ShoppingCart, Box, Layers
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type ExportStep = "select" | "configure" | "generating" | "done";

export default function ShopeeSpreadsheet() {
  const [step, setStep] = useState<ExportStep>("select");
  const [selectedInventoryId, setSelectedInventoryId] = useState<number | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectAll, setSelectAll] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>("");
  const [exportStats, setExportStats] = useState<{ productCount: number; rowCount: number } | null>(null);

  // Kit variation options
  const [createKitVariations, setCreateKitVariations] = useState(true);
  const [kitQuantities, setKitQuantities] = useState([2, 3, 4]);
  const [kitDiscounts, setKitDiscounts] = useState([5, 10, 15]);
  const [enableShopeeXpress, setEnableShopeeXpress] = useState(true);
  const [enableDirectDelivery, setEnableDirectDelivery] = useState(false);
  const [defaultNcm, setDefaultNcm] = useState("");

  // Fetch inventories
  const inventoriesQuery = trpc.baselinker.getInventories.useQuery(undefined, {
    retry: 1,
  });

  // Fetch products from cache
  const productsQuery = trpc.baselinker.filterProducts.useQuery(
    {
      inventoryId: selectedInventoryId!,
      filters: {
        searchName: searchTerm || undefined,
      },
      page: currentPage,
      pageSize: 50,
    },
    { enabled: !!selectedInventoryId }
  );

  // Cache stats
  const cacheStatsQuery = trpc.baselinker.getCacheStats.useQuery(
    { inventoryId: selectedInventoryId! },
    { enabled: !!selectedInventoryId }
  );

  // Generate spreadsheet mutation
  const generateMutation = trpc.shopee.generateSpreadsheet.useMutation({
    onSuccess: (data) => {
      setDownloadUrl(data.url);
      setDownloadFilename(data.filename);
      setExportStats({ productCount: data.productCount, rowCount: data.rowCount });
      setStep("done");
      toast.success(`Planilha gerada com ${data.rowCount} linhas!`);
    },
    onError: (err) => {
      toast.error(`Erro ao gerar planilha: ${err.message}`);
      setStep("configure");
    },
  });

  // Auto-select first inventory
  useEffect(() => {
    if (inventoriesQuery.data && inventoriesQuery.data.length > 0 && !selectedInventoryId) {
      setSelectedInventoryId(inventoriesQuery.data[0].inventory_id);
    }
  }, [inventoriesQuery.data, selectedInventoryId]);

  const products = productsQuery.data?.products || [];
  const totalProducts = productsQuery.data?.total || 0;
  const totalPages = Math.ceil(totalProducts / 50);

  // Handle select all on current page
  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      const newSet = new Set(selectedProductIds);
      products.forEach((p: any) => newSet.delete(p.id));
      setSelectedProductIds(newSet);
      setSelectAll(false);
    } else {
      const newSet = new Set(selectedProductIds);
      products.forEach((p: any) => newSet.add(p.id));
      setSelectedProductIds(newSet);
      setSelectAll(true);
    }
  }, [selectAll, products, selectedProductIds]);

  // Toggle single product
  const toggleProduct = useCallback((id: number) => {
    setSelectedProductIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Check if all current page products are selected
  useEffect(() => {
    if (products.length > 0) {
      const allSelected = products.every((p: any) => selectedProductIds.has(p.id));
      setSelectAll(allSelected);
    }
  }, [products, selectedProductIds]);

  // Handle generate
  const handleGenerate = () => {
    if (selectedProductIds.size === 0) {
      toast.error("Selecione pelo menos um produto");
      return;
    }
    if (!selectedInventoryId) {
      toast.error("Selecione um inventário");
      return;
    }

    setStep("generating");
    generateMutation.mutate({
      inventoryId: selectedInventoryId,
      productIds: Array.from(selectedProductIds),
      options: {
        createKitVariations,
        kitQuantities: createKitVariations ? kitQuantities : undefined,
        kitDiscountPercent: createKitVariations ? kitDiscounts : undefined,
        enableShopeeXpress,
        enableDirectDelivery,
        defaultNcm: defaultNcm || undefined,
      },
    });
  };

  // tRPC utils for refetching
  const utils = trpc.useUtils();

  // Select all products (all pages)
  const handleSelectAllProducts = async () => {
    if (!selectedInventoryId) return;
    // Get total count from cache stats
    const total = cacheStatsQuery.data?.totalProducts || totalProducts;
    if (total > 5000) {
      toast.error("Máximo de 5000 produtos por planilha. Use filtros para reduzir.");
      return;
    }
    // Fetch all product IDs
    toast.info(`Selecionando todos os ${total} produtos...`);
    try {
      // We need to get all IDs - fetch page by page
      const allIds = new Set<number>();
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.baselinker.filterProducts.fetch({
          inventoryId: selectedInventoryId,
          filters: { searchName: searchTerm || undefined },
          page,
          pageSize: 1000,
        });
        result.products.forEach((p: any) => allIds.add(p.id));
        hasMore = result.products.length === 1000;
        page++;
      }
      setSelectedProductIds(allIds);
      toast.success(`${allIds.size} produtos selecionados`);
    } catch (e) {
      toast.error("Erro ao selecionar todos os produtos");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 text-orange-500" />
            Exportar Planilha Shopee
          </h1>
          <p className="text-muted-foreground mt-1">
            Gere uma planilha no formato Shopee Mass Upload com seus produtos do BaseLinker
          </p>
        </div>
        {selectedProductIds.size > 0 && step === "select" && (
          <Button onClick={() => setStep("configure")} className="bg-orange-500 hover:bg-orange-600">
            <Settings2 className="h-4 w-4 mr-2" />
            Configurar Exportação ({selectedProductIds.size} produtos)
          </Button>
        )}
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {[
          { key: "select", label: "Selecionar Produtos", icon: Package },
          { key: "configure", label: "Configurar", icon: Settings2 },
          { key: "generating", label: "Gerando", icon: Loader2 },
          { key: "done", label: "Download", icon: Download },
        ].map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                step === s.key
                  ? "bg-orange-500 text-white"
                  : ["select", "configure", "generating", "done"].indexOf(step) > i
                  ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <s.icon className={`h-4 w-4 ${step === "generating" && s.key === "generating" ? "animate-spin" : ""}`} />
              {s.label}
            </div>
            {i < 3 && <div className="w-8 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Products */}
      {step === "select" && (
        <div className="space-y-4">
          {/* Inventory Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Inventário BaseLinker</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Select
                  value={selectedInventoryId?.toString() || ""}
                  onValueChange={(v) => {
                    setSelectedInventoryId(parseInt(v));
                    setSelectedProductIds(new Set());
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[300px]">
                    <SelectValue placeholder="Selecione o inventário" />
                  </SelectTrigger>
                  <SelectContent>
                    {inventoriesQuery.data?.map((inv: any) => (
                      <SelectItem key={inv.inventory_id} value={inv.inventory_id.toString()}>
                        {inv.name} ({inv.inventory_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {cacheStatsQuery.data && (
                  <Badge variant="outline" className="text-sm">
                    {cacheStatsQuery.data.totalProducts} produtos no cache
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Search & Selection */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Produtos</CardTitle>
                  <CardDescription>
                    {selectedProductIds.size > 0
                      ? `${selectedProductIds.size} produto(s) selecionado(s)`
                      : "Selecione os produtos para exportar"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectAll}>
                    {selectAll ? <SquareCheck className="h-4 w-4 mr-1" /> : <Square className="h-4 w-4 mr-1" />}
                    {selectAll ? "Desmarcar página" : "Selecionar página"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSelectAllProducts}>
                    <Layers className="h-4 w-4 mr-1" />
                    Selecionar todos
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Search */}
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nome..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Products Table */}
              {productsQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : products.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Nenhum produto encontrado</p>
                  <p className="text-sm mt-1">Sincronize os produtos na página de Produtos primeiro</p>
                </div>
              ) : (
                <>
                  <ScrollArea className="h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[40px]">
                            <Checkbox
                              checked={selectAll}
                              onCheckedChange={handleSelectAll}
                            />
                          </TableHead>
                          <TableHead className="w-[60px]">Img</TableHead>
                          <TableHead>Nome</TableHead>
                          <TableHead className="w-[100px]">SKU</TableHead>
                          <TableHead className="w-[100px]">EAN</TableHead>
                          <TableHead className="w-[80px] text-right">Preço</TableHead>
                          <TableHead className="w-[80px] text-right">Estoque</TableHead>
                          <TableHead className="w-[80px] text-right">Peso</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products.map((product: any) => (
                          <TableRow
                            key={product.id}
                            className={`cursor-pointer hover:bg-muted/50 ${
                              selectedProductIds.has(product.id) ? "bg-orange-50 dark:bg-orange-900/10" : ""
                            }`}
                            onClick={() => toggleProduct(product.id)}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedProductIds.has(product.id)}
                                onCheckedChange={() => toggleProduct(product.id)}
                              />
                            </TableCell>
                            <TableCell>
                              {product.imageUrl ? (
                                <img
                                  src={product.imageUrl}
                                  alt=""
                                  className="w-10 h-10 object-cover rounded border"
                                />
                              ) : (
                                <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                                  <Package className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-medium max-w-[300px] truncate">
                              {product.name}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {product.sku || "-"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {product.ean || "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              R$ {(product.mainPrice || 0).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              {product.totalStock || 0}
                            </TableCell>
                            <TableCell className="text-right">
                              {product.weight ? `${product.weight}kg` : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-muted-foreground">
                      Página {currentPage} de {totalPages} ({totalProducts} produtos)
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage(p => p - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage(p => p + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 2: Configure Export */}
      {step === "configure" && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setStep("select")}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Voltar à seleção
          </Button>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Kit Variations */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-orange-500" />
                  Variações de Kit
                </CardTitle>
                <CardDescription>
                  Crie variações automáticas (Kit 2, Kit 3, Kit 4) para cada produto
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="kit-switch">Criar variações de kit</Label>
                  <Switch
                    id="kit-switch"
                    checked={createKitVariations}
                    onCheckedChange={setCreateKitVariations}
                  />
                </div>

                {createKitVariations && (
                  <div className="space-y-3 pt-2 border-t">
                    <p className="text-sm text-muted-foreground">
                      Para cada produto, serão criadas linhas adicionais com as quantidades e descontos abaixo:
                    </p>
                    {kitQuantities.map((qty, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="flex items-center gap-2 flex-1">
                          <Label className="w-20 text-sm">Kit {qty} un</Label>
                          <Input
                            type="number"
                            value={kitDiscounts[i]}
                            onChange={(e) => {
                              const newDiscounts = [...kitDiscounts];
                              newDiscounts[i] = parseInt(e.target.value) || 0;
                              setKitDiscounts(newDiscounts);
                            }}
                            className="w-20"
                            min={0}
                            max={50}
                          />
                          <span className="text-sm text-muted-foreground">% desconto</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Preço = unit × {qty} × {((100 - kitDiscounts[i]) / 100).toFixed(2)}
                        </Badge>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground mt-2">
                      O SKU do kit terá o sufixo VIRT-KIT seguido da quantidade (ex: SKU123VIRT-KIT2)
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Shipping & Fiscal */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Box className="h-5 w-5 text-orange-500" />
                  Envio e Fiscal
                </CardTitle>
                <CardDescription>
                  Configure canais de envio e dados fiscais padrão
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="xpress-switch">Shopee Xpress</Label>
                  <Switch
                    id="xpress-switch"
                    checked={enableShopeeXpress}
                    onCheckedChange={setEnableShopeeXpress}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="direct-switch">Entrega Direta</Label>
                  <Switch
                    id="direct-switch"
                    checked={enableDirectDelivery}
                    onCheckedChange={setEnableDirectDelivery}
                  />
                </div>
                <div className="space-y-2 pt-2 border-t">
                  <Label htmlFor="ncm-input">NCM Padrão (opcional)</Label>
                  <Input
                    id="ncm-input"
                    placeholder="Ex: 8544.42.00"
                    value={defaultNcm}
                    onChange={(e) => setDefaultNcm(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Código NCM aplicado a todos os produtos. Deixe vazio para preencher manualmente.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Summary & Generate */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="font-medium">Resumo da Exportação</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedProductIds.size} produtos selecionados
                    {createKitVariations && (
                      <> → {selectedProductIds.size * (1 + kitQuantities.length)} linhas na planilha
                        (1 unidade + {kitQuantities.length} kits por produto)</>
                    )}
                  </p>
                </div>
                <Button
                  onClick={handleGenerate}
                  className="bg-orange-500 hover:bg-orange-600"
                  size="lg"
                >
                  <FileSpreadsheet className="h-5 w-5 mr-2" />
                  Gerar Planilha Shopee
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3: Generating */}
      {step === "generating" && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader2 className="h-12 w-12 text-orange-500 animate-spin" />
              <p className="text-lg font-medium">Gerando planilha Shopee...</p>
              <p className="text-sm text-muted-foreground">
                Buscando dados de {selectedProductIds.size} produtos e preenchendo a planilha
              </p>
              <Progress value={50} className="w-64" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Done */}
      {step === "done" && downloadUrl && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <CheckCircle className="h-16 w-16 text-green-500" />
              <p className="text-xl font-bold">Planilha Gerada com Sucesso!</p>
              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">
                  {exportStats?.productCount} produtos → {exportStats?.rowCount} linhas na planilha
                </p>
                <p className="text-sm text-muted-foreground">
                  Arquivo: {downloadFilename}
                </p>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <Button
                  onClick={() => window.open(downloadUrl, "_blank")}
                  className="bg-orange-500 hover:bg-orange-600"
                  size="lg"
                >
                  <Download className="h-5 w-5 mr-2" />
                  Baixar Planilha
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("select");
                    setSelectedProductIds(new Set());
                    setDownloadUrl(null);
                  }}
                >
                  Exportar Novamente
                </Button>
              </div>
              <div className="mt-6 p-4 bg-muted rounded-lg max-w-lg text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-2">Como importar na Shopee:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Acesse o Seller Centre da Shopee</li>
                  <li>Vá em Meus Produtos → Importação em Massa</li>
                  <li>Faça upload da planilha gerada</li>
                  <li>Revise e confirme os produtos</li>
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
