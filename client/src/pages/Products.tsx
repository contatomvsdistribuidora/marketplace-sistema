import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, Filter, Loader2, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";

export default function ProductsPage() {
  const [, setLocation] = useLocation();
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;

  const { data: tags, isLoading: tagsLoading } = trpc.baselinker.getTags.useQuery(
    { inventoryId: inventoryId! },
    { enabled: !!tokenData?.hasToken && !!inventoryId }
  );

  // Only pass tagId when a specific tag is selected (not "all")
  const parsedTagId = selectedTag !== "all" ? Number(selectedTag) : undefined;
  const isValidTagId = parsedTagId !== undefined && !isNaN(parsedTagId);

  const { data: productsData, isLoading: productsLoading, error: productsError } = trpc.baselinker.getProducts.useQuery(
    {
      inventoryId: inventoryId!,
      tagId: isValidTagId ? parsedTagId : undefined,
      page,
    },
    { enabled: !!tokenData?.hasToken && !!inventoryId }
  );

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
                <SelectItem value="all">Todas as tags</SelectItem>
                {(tags || []).map((tag: any) => {
                  // BaseLinker API returns tags with tag_id (number)
                  const tagId = tag.tag_id ?? tag.id;
                  return (
                    <SelectItem key={tagId} value={String(tagId)}>
                      {tag.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {tagsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Badge variant="secondary" className="ml-auto">
              {productsData?.total ?? 0} produto(s) encontrado(s)
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
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando produtos...
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Nenhum produto encontrado com os filtros selecionados.
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
                      <TableHead className="text-right">Preço</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
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
                        <TableCell className="font-medium max-w-[300px] truncate">{product.name || "—"}</TableCell>
                        <TableCell className="text-xs">{product.sku || "—"}</TableCell>
                        <TableCell className="text-xs">{product.ean || "—"}</TableCell>
                        <TableCell className="text-right">
                          {product.prices ? `R$ ${Object.values(product.prices)[0] || "—"}` : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {product.stock ? Object.values(product.stock)[0]?.toString() || "—" : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  {selectedProducts.size} de {products.length} selecionado(s)
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">Página {page}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={products.length < 100}
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
