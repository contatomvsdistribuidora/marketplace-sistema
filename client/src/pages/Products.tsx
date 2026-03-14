import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Package, Filter, Loader2, ChevronLeft, ChevronRight, ArrowRight, RefreshCw, Search } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";

export default function ProductsPage() {
  const [, setLocation] = useLocation();
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [scanStarted, setScanStarted] = useState(false);

  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;

  const { data: tags, isLoading: tagsLoading } = trpc.baselinker.getTags.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!tokenData?.hasToken && !!inventoryId }
  );

  // Tag scan progress - poll every 3 seconds while scanning
  const { data: scanProgress, refetch: refetchProgress } = trpc.baselinker.getTagScanProgress.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!inventoryId && !!tokenData?.hasToken, refetchInterval: scanStarted ? 3000 : false }
  );

  // Start tag scan mutation
  const startScanMutation = trpc.baselinker.startTagScan.useMutation({
    onSuccess: () => {
      setScanStarted(true);
    },
  });

  // Use tagName (string) for filtering
  const tagName = selectedTag !== "all" ? selectedTag : undefined;

  const { data: productsData, isLoading: productsLoading, error: productsError, refetch: refetchProducts } = trpc.baselinker.getProducts.useQuery(
    {
      inventoryId: inventoryId!,
      tagName: tagName,
      page,
    },
    { enabled: !!tokenData?.hasToken && !!inventoryId }
  );

  // Auto-start scan when page loads and we have a token
  useEffect(() => {
    if (inventoryId && tokenData?.hasToken && !scanProgress?.isComplete && !scanProgress?.isScanning) {
      startScanMutation.mutate({ inventoryId });
    }
  }, [inventoryId, tokenData?.hasToken]);

  // Stop polling when scan is complete
  useEffect(() => {
    if (scanProgress?.isComplete) {
      setScanStarted(false);
      // Refetch products when scan completes
      refetchProducts();
    }
  }, [scanProgress?.isComplete]);

  const products = useMemo(() => {
    if (!productsData?.products) return [];
    return Object.entries(productsData.products).map(([id, data]: [string, any]) => ({
      id,
      ...data,
    }));
  }, [productsData]);

  const toggleProduct = (id: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedProducts.size === products.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(products.map((p) => p.id)));
    }
  };

  const handleStartScan = () => {
    if (inventoryId) {
      startScanMutation.mutate({ inventoryId });
    }
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
            <Button variant="outline" onClick={() => setLocation("/settings")}>
              Ir para Configurações
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isScanning = scanProgress?.isScanning;
  const scanPercent = scanProgress?.totalEstimatedPages
    ? Math.round((scanProgress.currentPage / Math.max(scanProgress.totalEstimatedPages, 1)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos</h1>
          <p className="text-muted-foreground mt-1">
            Visualize e selecione produtos do BaseLinker para exportação
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
              <span className="text-sm font-medium">
                Indexando produtos para filtro por tag...
              </span>
              <Badge variant="outline" className="ml-auto">
                {scanProgress?.productsScanned?.toLocaleString() || 0} produtos verificados
              </Badge>
            </div>
            <Progress value={scanPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">
              Página {scanProgress?.currentPage || 0} de ~{scanProgress?.totalEstimatedPages || "?"} 
              {" "}— {scanProgress?.productsWithTag || 0} produtos com tags encontrados
            </p>
          </CardContent>
        </Card>
      )}

      {scanProgress?.isComplete && (
        <Card className="border-green-500/30 bg-green-50">
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-700">
                Indexação completa: {scanProgress.productsScanned?.toLocaleString()} produtos verificados, 
                {" "}{scanProgress.productsWithTag?.toLocaleString()} com tags.
              </span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={handleStartScan}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Re-indexar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filtrar por Tag:</span>
            </div>
            <Select
              value={selectedTag}
              onValueChange={(val) => {
                setSelectedTag(val);
                setPage(1);
                setSelectedProducts(new Set());
              }}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Todas as tags" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as tags (sem filtro)</SelectItem>
                {(tags || []).map((tag: any, index: number) => (
                  <SelectItem key={`tag-${index}-${tag.name}`} value={tag.name}>
                    {tag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(tagsLoading || productsLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Badge variant="secondary" className="ml-auto">
              {(productsData as any)?.total ?? productsData?.total ?? 0} produto(s) encontrado(s)
            </Badge>
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
              {tagName && isScanning ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p>Indexação em andamento. Os produtos com a tag "{tagName}" aparecerão conforme o scan avança.</p>
                  <Button variant="outline" size="sm" onClick={() => refetchProducts()}>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Atualizar
                  </Button>
                </>
              ) : tagName ? (
                <>
                  <p>Nenhum produto encontrado com a tag "{tagName}".</p>
                  {!scanProgress?.isComplete && (
                    <Button variant="outline" size="sm" onClick={handleStartScan}>
                      <Search className="h-3 w-3 mr-1" />
                      Iniciar indexação de tags
                    </Button>
                  )}
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
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedProducts.size === products.length && products.length > 0}
                          onCheckedChange={toggleAll}
                        />
                      </TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>EAN</TableHead>
                      <TableHead>Tags</TableHead>
                      <TableHead className="text-right">Preço</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product: any) => (
                      <TableRow key={product.id} className={selectedProducts.has(product.id) ? "bg-primary/5" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={selectedProducts.has(product.id)}
                            onCheckedChange={() => toggleProduct(product.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{product.id}</TableCell>
                        <TableCell className="font-medium max-w-[250px] truncate">{product.name || "—"}</TableCell>
                        <TableCell className="text-xs">{product.sku || "—"}</TableCell>
                        <TableCell className="text-xs">{product.ean || "—"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {(product.tags || []).map((tag: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {product.prices ? `R$ ${Object.values(product.prices)[0] || "—"}` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  {selectedProducts.size} de {products.length} selecionado(s)
                  {(productsData as any)?.total > products.length && (
                    <span> (total: {(productsData as any).total})</span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {page}
                    {(productsData as any)?.totalPages > 0 && ` de ${(productsData as any).totalPages}`}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!(productsData as any)?.hasMore && products.length < 1000}
                    onClick={() => setPage((p) => p + 1)}
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
