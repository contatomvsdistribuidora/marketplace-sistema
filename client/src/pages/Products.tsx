import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Package, Filter, Loader2, ChevronLeft, ChevronRight, ArrowRight,
  RefreshCw, Search, ChevronDown, ChevronUp, X, SlidersHorizontal
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useLocation } from "wouter";

type Filters = {
  tagName?: string;
  tags?: string[];
  categoryId?: number;
  manufacturerId?: number;
  searchName?: string;
  searchEan?: string;
  searchSku?: string;
  priceMin?: number;
  priceMax?: number;
  stockMin?: number;
  stockMax?: number;
  weightMin?: number;
  weightMax?: number;
};

const EMPTY_FILTERS: Filters = {};

export default function ProductsPage() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [scanStarted, setScanStarted] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Filter state
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftName, setDraftName] = useState("");
  const [draftEan, setDraftEan] = useState("");
  const [draftSku, setDraftSku] = useState("");
  const [draftPriceMin, setDraftPriceMin] = useState("");
  const [draftPriceMax, setDraftPriceMax] = useState("");
  const [draftStockMin, setDraftStockMin] = useState("");
  const [draftStockMax, setDraftStockMax] = useState("");
  const [draftWeightMin, setDraftWeightMin] = useState("");
  const [draftWeightMax, setDraftWeightMax] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedManufacturer, setSelectedManufacturer] = useState("all");

  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;

  const { data: tags } = trpc.baselinker.getTags.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!tokenData?.hasToken && !!inventoryId }
  );

  const { data: categories } = trpc.baselinker.getCategories.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!tokenData?.hasToken && !!inventoryId }
  );

  const { data: manufacturers } = trpc.baselinker.getManufacturers.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!tokenData?.hasToken && !!inventoryId }
  );

  const { data: scanProgress, refetch: refetchProgress } = trpc.baselinker.getTagScanProgress.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!inventoryId && !!tokenData?.hasToken, refetchInterval: scanStarted ? 3000 : false }
  );

  const { data: indexStats } = trpc.baselinker.getIndexStats.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!inventoryId && !!tokenData?.hasToken && !!scanProgress?.isComplete }
  );

  const startScanMutation = trpc.baselinker.startTagScan.useMutation({
    onSuccess: () => setScanStarted(true),
  });

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return selectedTag !== "all" || selectedCategory !== "all" || selectedManufacturer !== "all" ||
      draftName || draftEan || draftSku || draftPriceMin || draftPriceMax ||
      draftStockMin || draftStockMax || draftWeightMin || draftWeightMax;
  }, [selectedTag, selectedCategory, selectedManufacturer, draftName, draftEan, draftSku,
    draftPriceMin, draftPriceMax, draftStockMin, draftStockMax, draftWeightMin, draftWeightMax]);

  // Build filters object
  const activeFilters = useMemo((): Filters => {
    const f: Filters = {};
    if (selectedTag !== "all") f.tagName = selectedTag;
    if (selectedCategory !== "all") f.categoryId = Number(selectedCategory);
    if (selectedManufacturer !== "all") f.manufacturerId = Number(selectedManufacturer);
    if (draftName.trim()) f.searchName = draftName.trim();
    if (draftEan.trim()) f.searchEan = draftEan.trim();
    if (draftSku.trim()) f.searchSku = draftSku.trim();
    if (draftPriceMin) f.priceMin = Number(draftPriceMin);
    if (draftPriceMax) f.priceMax = Number(draftPriceMax);
    if (draftStockMin) f.stockMin = Number(draftStockMin);
    if (draftStockMax) f.stockMax = Number(draftStockMax);
    if (draftWeightMin) f.weightMin = Number(draftWeightMin);
    if (draftWeightMax) f.weightMax = Number(draftWeightMax);
    return f;
  }, [selectedTag, selectedCategory, selectedManufacturer, draftName, draftEan, draftSku,
    draftPriceMin, draftPriceMax, draftStockMin, draftStockMax, draftWeightMin, draftWeightMax]);

  // Use the advanced filter endpoint
  const { data: productsData, isLoading: productsLoading, error: productsError, refetch: refetchProducts } =
    trpc.baselinker.filterProducts.useQuery(
      {
        inventoryId: inventoryId!,
        filters: activeFilters,
        page,
        pageSize,
      },
      { enabled: !!tokenData?.hasToken && !!inventoryId }
    );

  // Auto-start scan
  useEffect(() => {
    if (inventoryId && tokenData?.hasToken && !scanProgress?.isComplete && !scanProgress?.isScanning) {
      startScanMutation.mutate({ inventoryId });
    }
  }, [inventoryId, tokenData?.hasToken]);

  useEffect(() => {
    if (scanProgress?.isComplete) {
      setScanStarted(false);
      refetchProducts();
    }
  }, [scanProgress?.isComplete]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
    setSelectedProducts(new Set());
  }, [selectedTag, selectedCategory, selectedManufacturer, draftName, draftEan, draftSku,
    draftPriceMin, draftPriceMax, draftStockMin, draftStockMax, draftWeightMin, draftWeightMax, pageSize]);

  const products = productsData?.products || [];

  const toggleProduct = (id: string) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedProducts.size === products.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(products.map((p: any) => String(p.id))));
    }
  };

  const clearAllFilters = () => {
    setSelectedTag("all");
    setSelectedCategory("all");
    setSelectedManufacturer("all");
    setDraftName("");
    setDraftEan("");
    setDraftSku("");
    setDraftPriceMin("");
    setDraftPriceMax("");
    setDraftStockMin("");
    setDraftStockMax("");
    setDraftWeightMin("");
    setDraftWeightMax("");
  };

  const handleStartScan = () => {
    if (inventoryId) startScanMutation.mutate({ inventoryId });
  };

  if (!tokenData?.hasToken || !inventoryId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos</h1>
          <p className="text-muted-foreground mt-1">Visualize e selecione produtos do BaseLinker</p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <Package className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm text-center">
              {!tokenData?.hasToken
                ? "Configure seu token do BaseLinker nas configurações."
                : "Selecione um inventário padrão nas configurações."}
            </p>
            <Button variant="outline" onClick={() => setLocation("/settings")}>Ir para Configurações</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isScanning = scanProgress?.isScanning;
  const scanPercent = scanProgress?.totalEstimatedPages
    ? Math.round((scanProgress.currentPage / Math.max(scanProgress.totalEstimatedPages, 1)) * 100)
    : 0;

  const activeFilterCount = Object.keys(activeFilters).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos</h1>
          <p className="text-muted-foreground mt-1">
            {indexStats
              ? `${indexStats.totalProducts.toLocaleString()} produtos indexados — ${indexStats.uniqueTags} tags — ${indexStats.uniqueCategories} categorias`
              : "Visualize e selecione produtos do BaseLinker para exportação"}
          </p>
        </div>
        {selectedProducts.size > 0 && (
          <Button onClick={() => {
            const ids = Array.from(selectedProducts);
            sessionStorage.setItem("export_product_ids", JSON.stringify(ids));
            sessionStorage.setItem("export_tag", selectedTag);
            setLocation("/export");
          }}>
            Exportar {selectedProducts.size} produto(s)
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Scan Progress Banner */}
      {isScanning && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3 mb-2">
              <Search className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-sm font-medium">Indexando produtos para filtros avançados...</span>
              <Badge variant="outline" className="ml-auto">
                {scanProgress?.productsScanned?.toLocaleString() || 0} produtos verificados
              </Badge>
            </div>
            <Progress value={scanPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">
              Página {scanProgress?.currentPage || 0} de ~{scanProgress?.totalEstimatedPages || "?"}
              {" "}— {scanProgress?.uniqueTags || 0} tags encontradas
            </p>
          </CardContent>
        </Card>
      )}

      {scanProgress?.isComplete && !isScanning && (
        <Card className="border-green-500/30 bg-green-50">
          <CardContent className="py-2.5">
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-700">
                Indexação completa: {scanProgress.productsScanned?.toLocaleString()} produtos,
                {" "}{scanProgress.uniqueTags} tags.
              </span>
              <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={handleStartScan}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Re-indexar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter Panel */}
      <Card>
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Filtros Avançados</span>
                  {activeFilterCount > 0 && (
                    <Badge variant="default" className="text-xs">{activeFilterCount} ativo(s)</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); clearAllFilters(); }}>
                      <X className="h-3 w-3 mr-1" />
                      Limpar filtros
                    </Button>
                  )}
                  {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Row 1: Tags, Category, Manufacturer, Name */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Tags</Label>
                  <Select value={selectedTag} onValueChange={setSelectedTag}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as tags</SelectItem>
                      {(tags || []).map((tag: any, i: number) => (
                        <SelectItem key={`tag-${i}-${tag.name}`} value={tag.name}>
                          {tag.name}
                          {indexStats?.tagStats?.find((t: any) => t.tag === tag.name) && (
                            <span className="text-muted-foreground ml-1">
                              ({indexStats.tagStats.find((t: any) => t.tag === tag.name)?.count})
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Categoria</Label>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as categorias</SelectItem>
                      {(categories || []).map((cat: any) => (
                        <SelectItem key={cat.category_id} value={String(cat.category_id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Fabricante</Label>
                  <Select value={selectedManufacturer} onValueChange={setSelectedManufacturer}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os fabricantes</SelectItem>
                      {(manufacturers || []).map((man: any) => (
                        <SelectItem key={man.manufacturer_id} value={String(man.manufacturer_id)}>
                          {man.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Nome do produto</Label>
                  <Input
                    className="h-9"
                    placeholder="Buscar por nome..."
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                  />
                </div>

                {/* Row 2: EAN, SKU, Price range */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">EAN</Label>
                  <Input
                    className="h-9"
                    placeholder="Buscar por EAN..."
                    value={draftEan}
                    onChange={e => setDraftEan(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">SKU</Label>
                  <Input
                    className="h-9"
                    placeholder="Buscar por SKU..."
                    value={draftSku}
                    onChange={e => setDraftSku(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Preço (R$)</Label>
                  <div className="flex gap-2">
                    <Input
                      className="h-9"
                      type="number"
                      placeholder="De"
                      value={draftPriceMin}
                      onChange={e => setDraftPriceMin(e.target.value)}
                    />
                    <Input
                      className="h-9"
                      type="number"
                      placeholder="Até"
                      value={draftPriceMax}
                      onChange={e => setDraftPriceMax(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Estoque</Label>
                  <div className="flex gap-2">
                    <Input
                      className="h-9"
                      type="number"
                      placeholder="De"
                      value={draftStockMin}
                      onChange={e => setDraftStockMin(e.target.value)}
                    />
                    <Input
                      className="h-9"
                      type="number"
                      placeholder="Até"
                      value={draftStockMax}
                      onChange={e => setDraftStockMax(e.target.value)}
                    />
                  </div>
                </div>

                {/* Row 3: Weight */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Peso (kg)</Label>
                  <div className="flex gap-2">
                    <Input
                      className="h-9"
                      type="number"
                      placeholder="De"
                      value={draftWeightMin}
                      onChange={e => setDraftWeightMin(e.target.value)}
                    />
                    <Input
                      className="h-9"
                      type="number"
                      placeholder="Até"
                      value={draftWeightMax}
                      onChange={e => setDraftWeightMax(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {productsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Badge variant="secondary">
                {productsData?.total?.toLocaleString() || 0} produto(s) encontrado(s)
              </Badge>
              {hasActiveFilters && (
                <span className="text-xs text-muted-foreground">
                  (filtrado de {indexStats?.totalProducts?.toLocaleString() || "?"} total)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Por página:</Label>
              <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {productsError ? (
            <div className="text-center py-12 text-destructive">
              <p className="font-medium">Erro ao carregar produtos</p>
              <p className="text-sm mt-1">{productsError.message}</p>
            </div>
          ) : productsLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p>Carregando produtos...</p>
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              {isScanning ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p>Indexação em andamento. Os produtos aparecerão conforme o scan avança.</p>
                  <Button variant="outline" size="sm" onClick={() => refetchProducts()}>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Atualizar
                  </Button>
                </>
              ) : hasActiveFilters ? (
                <>
                  <Filter className="h-8 w-8 text-muted-foreground/50" />
                  <p>Nenhum produto encontrado com os filtros aplicados.</p>
                  <Button variant="outline" size="sm" onClick={clearAllFilters}>
                    <X className="h-3 w-3 mr-1" />
                    Limpar filtros
                  </Button>
                </>
              ) : !scanProgress?.isComplete ? (
                <>
                  <p>Aguardando indexação dos produtos...</p>
                  <Button variant="outline" size="sm" onClick={handleStartScan}>
                    <Search className="h-3 w-3 mr-1" />
                    Iniciar indexação
                  </Button>
                </>
              ) : (
                <p>Nenhum produto encontrado.</p>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedProducts.size === products.length && products.length > 0}
                          onCheckedChange={toggleAll}
                        />
                      </TableHead>
                      <TableHead className="w-24">ID</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead className="w-32">SKU</TableHead>
                      <TableHead className="w-36">EAN</TableHead>
                      <TableHead className="w-40">Tags</TableHead>
                      <TableHead className="w-20 text-right">Estoque</TableHead>
                      <TableHead className="w-24 text-right">Preço</TableHead>
                      <TableHead className="w-20 text-right">Peso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product: any) => (
                      <TableRow
                        key={product.id}
                        className={selectedProducts.has(String(product.id)) ? "bg-primary/5" : ""}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedProducts.has(String(product.id))}
                            onCheckedChange={() => toggleProduct(String(product.id))}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{product.id}</TableCell>
                        <TableCell className="font-medium max-w-[300px] truncate" title={product.name}>
                          {product.name || "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{product.sku || "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{product.ean || "—"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {(product.tags || []).slice(0, 3).map((tag: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs py-0">
                                {tag}
                              </Badge>
                            ))}
                            {(product.tags || []).length > 3 && (
                              <Badge variant="secondary" className="text-xs py-0">
                                +{product.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {product.totalStock != null ? product.totalStock : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">
                          {product.mainPrice ? `R$ ${Number(product.mainPrice).toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {product.weight ? `${product.weight} kg` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  {selectedProducts.size > 0 && (
                    <span className="font-medium">{selectedProducts.size} selecionado(s) — </span>
                  )}
                  Mostrando {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, productsData?.total || 0)} de {productsData?.total?.toLocaleString() || 0}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {page} de {productsData?.totalPages || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!productsData?.hasMore}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
