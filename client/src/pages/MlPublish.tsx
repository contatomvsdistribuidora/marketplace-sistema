import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Search,
  Upload,
  CheckCircle2,
  XCircle,
  ExternalLink,
  AlertTriangle,
  ArrowRight,
  Package,
  Filter,
} from "lucide-react";

type PublishResult = {
  productId: string;
  productName: string;
  success: boolean;
  mlItemId?: string;
  permalink?: string;
  error?: string;
};

export default function MlPublish() {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<PublishResult[]>([]);
  const [publishProgress, setPublishProgress] = useState({ current: 0, total: 0 });

  // Fetch ML accounts
  const { data: accounts, isLoading: accountsLoading } = trpc.ml.accounts.useQuery();
  const activeAccounts = useMemo(
    () => (accounts || []).filter((a: any) => a.isActive),
    [accounts]
  );

  // Fetch BaseLinker inventories
  const { data: inventories } = trpc.baselinker.getInventories.useQuery(undefined, {
    retry: false,
  });

  // Fetch products from cache
  const { data: productsData, isLoading: productsLoading } = trpc.baselinker.filterProducts.useQuery(
    {
      inventoryId: parseInt(selectedInventoryId) || 0,
      filters: {
        searchName: searchTerm || undefined,
      },
      page: 1,
      pageSize: 100,
    },
    {
      enabled: !!selectedInventoryId,
    }
  );

  const publishMutation = trpc.ml.publishProduct.useMutation();

  const products = productsData?.products || [];
  const allSelected = products.length > 0 && selectedProductIds.size === products.length;

  const toggleProduct = (productId: number) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedProductIds(new Set());
    } else {
      setSelectedProductIds(new Set(products.map((p: any) => p.id)));
    }
  };

  const handlePublish = async () => {
    if (!selectedAccountId || selectedProductIds.size === 0) {
      toast.error("Selecione uma conta e pelo menos um produto");
      return;
    }

    setIsPublishing(true);
    setPublishResults([]);
    setPublishProgress({ current: 0, total: selectedProductIds.size });

    const selectedProducts = products.filter((p: any) => selectedProductIds.has(p.id));
    const results: PublishResult[] = [];

    for (let i = 0; i < selectedProducts.length; i++) {
      const product = selectedProducts[i];
      setPublishProgress({ current: i + 1, total: selectedProducts.length });

      try {
        const result = await publishMutation.mutateAsync({
          accountId: parseInt(selectedAccountId),
          productId: String(product.id),
          name: product.name || "Produto sem nome",
          description: product.description || undefined,
          price: Number(product.mainPrice) || 0,
          stock: product.totalStock || 1,
          ean: product.ean || undefined,
          sku: product.sku || undefined,
          images: product.imageUrl ? [product.imageUrl] : undefined,
        });

        results.push({
          productId: String(product.id),
          productName: product.name || "Produto sem nome",
          success: result.success,
          mlItemId: result.mlItemId,
          permalink: result.permalink,
          error: result.error,
        });
      } catch (error: any) {
        results.push({
          productId: String(product.id),
          productName: product.name || "Produto sem nome",
          success: false,
          error: error.message,
        });
      }

      setPublishResults([...results]);
    }

    setIsPublishing(false);

    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;

    if (successCount > 0 && errorCount === 0) {
      toast.success(`${successCount} produto(s) publicado(s) com sucesso!`);
    } else if (successCount > 0) {
      toast.warning(`${successCount} sucesso(s), ${errorCount} erro(s)`);
    } else {
      toast.error(`Todos os ${errorCount} produto(s) falharam`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Publicar no Mercado Livre</h1>
        <p className="text-muted-foreground mt-1">
          Selecione produtos do BaseLinker e publique diretamente no Mercado Livre via API.
        </p>
      </div>

      {/* Step 1: Select Account */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              1
            </span>
            Selecionar Conta do Mercado Livre
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accountsLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : activeAccounts.length === 0 ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-orange-50 border border-orange-200">
              <AlertTriangle className="h-5 w-5 text-orange-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-orange-800">Nenhuma conta conectada</p>
                <p className="text-sm text-orange-700">
                  Vá para{" "}
                  <a href="/ml-accounts" className="underline font-medium">
                    Contas ML
                  </a>{" "}
                  para conectar uma conta primeiro.
                </p>
              </div>
            </div>
          ) : (
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder="Selecione uma conta..." />
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((account: any) => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    {account.nickname || `ML User ${account.mlUserId}`} ({account.email || account.mlUserId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Select Inventory */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              2
            </span>
            Selecionar Inventário do BaseLinker
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inventories ? (
            <Select value={selectedInventoryId} onValueChange={(v) => {
              setSelectedInventoryId(v);
              setSelectedProductIds(new Set());
            }}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder="Selecione um inventário..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(inventories).map(([id, inv]: [string, any]) => (
                  <SelectItem key={id} value={id}>
                    {inv.name} (ID: {id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">Configure o token do BaseLinker primeiro.</p>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Select Products */}
      {selectedInventoryId && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                  3
                </span>
                Selecionar Produtos
                {selectedProductIds.size > 0 && (
                  <Badge variant="secondary">{selectedProductIds.size} selecionado(s)</Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar produto..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 w-64"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {productsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-muted-foreground">
                <Package className="h-8 w-8 mb-2" />
                <p>Nenhum produto encontrado. Sincronize os produtos primeiro.</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                      </TableHead>
                      <TableHead className="w-16">Imagem</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead className="w-24">SKU</TableHead>
                      <TableHead className="w-24">EAN</TableHead>
                      <TableHead className="w-24 text-right">Preço</TableHead>
                      <TableHead className="w-20 text-right">Estoque</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product: any) => (
                      <TableRow
                        key={product.id}
                        className={`cursor-pointer ${selectedProductIds.has(product.id) ? "bg-primary/5" : ""}`}
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
                              className="h-10 w-10 rounded object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                              <Package className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium max-w-xs truncate">
                          {product.name || "Sem nome"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {product.sku || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {product.ean || "-"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          R$ {parseFloat(product.mainPrice || "0").toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">{product.totalStock || 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 4: Publish */}
      {selectedProductIds.size > 0 && selectedAccountId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                4
              </span>
              Publicar
            </CardTitle>
            <CardDescription>
              {selectedProductIds.size} produto(s) selecionado(s) para publicação na conta{" "}
              {activeAccounts.find((a: any) => String(a.id) === selectedAccountId)?.nickname || "selecionada"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handlePublish}
              disabled={isPublishing}
              size="lg"
              className="w-full md:w-auto"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Publicando... ({publishProgress.current}/{publishProgress.total})
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Publicar {selectedProductIds.size} Produto(s) no Mercado Livre
                </>
              )}
            </Button>

            {isPublishing && (
              <Progress
                value={(publishProgress.current / publishProgress.total) * 100}
                className="h-2"
              />
            )}

            {/* Results */}
            {publishResults.length > 0 && (
              <div className="space-y-2 mt-4">
                <h4 className="font-medium text-sm">Resultados:</h4>
                <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                  {publishResults.map((result, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between p-3 text-sm ${
                        result.success ? "bg-green-50/50" : "bg-red-50/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {result.success ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                        )}
                        <span className="truncate">{result.productName}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {result.success && result.mlItemId && (
                          <Badge variant="outline" className="text-green-700">
                            {result.mlItemId}
                          </Badge>
                        )}
                        {result.success && result.permalink && (
                          <a
                            href={result.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        {!result.success && (
                          <span className="text-xs text-red-600 max-w-48 truncate">
                            {result.error}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
