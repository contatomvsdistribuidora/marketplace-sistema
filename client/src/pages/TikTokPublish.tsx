import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import {
  Upload,
  Loader2,
  Package,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Store,
} from "lucide-react";

// Product type from filterProducts query
type Product = {
  id: number;
  name: string;
  ean: string;
  sku: string;
  tags: string[];
  categoryId: number;
  manufacturerId: number;
  weight: number;
  mainPrice: number;
  totalStock: number;
  description: string;
  imageUrl: string;
};

export default function TikTokPublish() {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishingProduct, setPublishingProduct] = useState<Product | null>(null);
  const [publishForm, setPublishForm] = useState({
    title: "",
    description: "",
    price: "",
    stock: 0,
    sku: "",
    packageWeight: "",
  });
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<Map<number, { status: "success" | "error"; message: string }>>(new Map());

  // Queries
  const { data: accounts } = trpc.tiktok.accounts.useQuery();
  const { data: settings } = trpc.settings.getInventoryId.useQuery();

  const inventoryId = settings?.inventoryId || 0;

  const { data: productsData, isLoading: productsLoading } = trpc.baselinker.filterProducts.useQuery(
    {
      inventoryId,
      filters: searchTerm ? { searchName: searchTerm } : {},
      page: 1,
      pageSize: 50,
    },
    { enabled: !!inventoryId }
  );

  const selectedAccount = useMemo(() => {
    if (!accounts || !selectedAccountId) return null;
    return accounts.find((a: any) => a.id === parseInt(selectedAccountId));
  }, [accounts, selectedAccountId]);

  const products = productsData?.products || [];

  const createProductMutation = trpc.tiktok.createProduct.useMutation();

  const toggleProduct = (productId: number) => {
    const newSet = new Set(selectedProducts);
    if (newSet.has(productId)) {
      newSet.delete(productId);
    } else {
      newSet.add(productId);
    }
    setSelectedProducts(newSet);
  };

  const toggleAll = () => {
    if (selectedProducts.size === products.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(products.map((p: Product) => p.id)));
    }
  };

  const openPublishDialog = (product: Product) => {
    setPublishingProduct(product);
    // Parse description - remove HTML tags
    const cleanDesc = (product.description || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    setPublishForm({
      title: product.name || "",
      description: cleanDesc.substring(0, 5000),
      price: String(product.mainPrice || "0"),
      stock: product.totalStock || 0,
      sku: product.sku || "",
      packageWeight: product.weight ? String(product.weight) : "0.5",
    });
    setPublishDialogOpen(true);
  };

  const handlePublish = async () => {
    if (!publishingProduct || !selectedAccountId || !selectedAccount) {
      toast.error("Selecione uma conta do TikTok Shop primeiro");
      return;
    }

    if (!(selectedAccount as any).shopCipher) {
      toast.error("A conta selecionada não tem uma loja vinculada. Reconecte a conta.");
      return;
    }

    setIsPublishing(true);
    try {
      // Get image URLs
      const imageUrl = publishingProduct.imageUrl || "";
      const imageUrls = imageUrl ? [imageUrl] : [];

      const result = await createProductMutation.mutateAsync({
        accountId: parseInt(selectedAccountId),
        shopCipher: (selectedAccount as any).shopCipher || "",
        product: {
          title: publishForm.title,
          description: publishForm.description,
          categoryId: "0", // Will need category selection in production
          images: imageUrls.slice(0, 9),
          skus: [
            {
              sellerSku: publishForm.sku,
              price: publishForm.price,
              stock: publishForm.stock,
            },
          ],
          packageWeight: publishForm.packageWeight,
        },
        blProductId: String(publishingProduct.id),
        blProductName: publishingProduct.name,
      });

      setPublishResults(new Map(publishResults.set(publishingProduct.id, {
        status: "success",
        message: `Produto criado! ID: ${result.productId}`,
      })));
      toast.success("Produto publicado no TikTok Shop com sucesso!");
      setPublishDialogOpen(false);
    } catch (error: any) {
      setPublishResults(new Map(publishResults.set(publishingProduct.id, {
        status: "error",
        message: error.message,
      })));
      toast.error(`Erro ao publicar: ${error.message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Publicar no TikTok Shop</h1>
        <p className="text-muted-foreground mt-1">
          Selecione produtos do BaseLinker e publique diretamente no TikTok Shop via API.
        </p>
      </div>

      {/* Account Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="h-4 w-4" />
            Conta do TikTok Shop
          </CardTitle>
          <CardDescription>Selecione a conta onde os produtos serão publicados</CardDescription>
        </CardHeader>
        <CardContent>
          {!accounts || accounts.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-3">Nenhuma conta do TikTok Shop conectada</p>
              <Button variant="outline" onClick={() => window.location.href = "/tiktok-accounts"}>
                Conectar Conta
              </Button>
            </div>
          ) : (
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder="Selecione uma conta..." />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account: any) => (
                  <SelectItem key={account.id} value={String(account.id)}>
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded bg-gradient-to-br from-pink-500 to-red-500 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-white">TT</span>
                      </div>
                      {account.sellerName || account.shopName || `TikTok ${account.ttOpenId.substring(0, 8)}...`}
                      {account.shopName && (
                        <Badge variant="secondary" className="text-xs">{account.shopRegion}</Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* Products */}
      {selectedAccountId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Produtos do BaseLinker
                </CardTitle>
                <CardDescription>
                  {selectedProducts.size > 0
                    ? `${selectedProducts.size} produto(s) selecionado(s)`
                    : "Selecione os produtos para publicar"}
                </CardDescription>
              </div>
            </div>
            {/* Search */}
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produtos por nome..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {productsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {inventoryId
                  ? "Nenhum produto encontrado. Sincronize os produtos primeiro."
                  : "Configure o inventário padrão nas Configurações primeiro."}
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedProducts.size === products.length && products.length > 0}
                          onCheckedChange={toggleAll}
                        />
                      </TableHead>
                      <TableHead className="w-16">Imagem</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="w-24">SKU</TableHead>
                      <TableHead className="w-24 text-right">Preço</TableHead>
                      <TableHead className="w-20 text-right">Estoque</TableHead>
                      <TableHead className="w-28 text-center">Status</TableHead>
                      <TableHead className="w-28 text-center">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product: Product) => {
                      const result = publishResults.get(product.id);
                      const imageUrl = product.imageUrl || "";
                      return (
                        <TableRow key={product.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedProducts.has(product.id)}
                              onCheckedChange={() => toggleProduct(product.id)}
                            />
                          </TableCell>
                          <TableCell>
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt=""
                                className="h-10 w-10 rounded object-cover"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                                <Package className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-sm line-clamp-2">{product.name}</p>
                            {product.ean && (
                              <p className="text-xs text-muted-foreground">EAN: {product.ean}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{product.sku || "-"}</TableCell>
                          <TableCell className="text-right font-medium">
                            R$ {Number(product.mainPrice || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">{product.totalStock || 0}</TableCell>
                          <TableCell className="text-center">
                            {result ? (
                              result.status === "success" ? (
                                <Badge className="bg-green-100 text-green-800">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Publicado
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Erro
                                </Badge>
                              )
                            ) : (
                              <Badge variant="secondary">Pendente</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPublishDialog(product)}
                              disabled={result?.status === "success"}
                            >
                              <Upload className="h-3 w-3 mr-1" />
                              Publicar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Publish Dialog */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Publicar no TikTok Shop</DialogTitle>
            <DialogDescription>
              Revise e ajuste os dados do produto antes de publicar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">
                  A categoria será detectada automaticamente pelo TikTok Shop com base no título do produto.
                  Certifique-se de que o título é descritivo.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Título do Produto</Label>
              <Input
                value={publishForm.title}
                onChange={(e) => setPublishForm({ ...publishForm, title: e.target.value })}
                maxLength={255}
              />
              <p className="text-xs text-muted-foreground">{publishForm.title.length}/255 caracteres</p>
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={publishForm.description}
                onChange={(e) => setPublishForm({ ...publishForm, description: e.target.value })}
                rows={6}
                maxLength={5000}
              />
              <p className="text-xs text-muted-foreground">{publishForm.description.length}/5000 caracteres</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Preço (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={publishForm.price}
                  onChange={(e) => setPublishForm({ ...publishForm, price: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Estoque</Label>
                <Input
                  type="number"
                  value={publishForm.stock}
                  onChange={(e) => setPublishForm({ ...publishForm, stock: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  value={publishForm.sku}
                  onChange={(e) => setPublishForm({ ...publishForm, sku: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Peso (kg)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={publishForm.packageWeight}
                  onChange={(e) => setPublishForm({ ...publishForm, packageWeight: e.target.value })}
                />
              </div>
            </div>

            {/* Image Preview */}
            {publishingProduct?.imageUrl && (
              <div className="space-y-2">
                <Label>Imagem</Label>
                <div className="flex gap-2 flex-wrap">
                  <img
                    src={publishingProduct.imageUrl}
                    alt="Imagem do produto"
                    className="h-16 w-16 rounded object-cover border"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handlePublish}
              disabled={isPublishing || !publishForm.title || !publishForm.price}
              className="bg-gradient-to-r from-pink-500 to-red-500 hover:from-pink-600 hover:to-red-600"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Publicando...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Publicar no TikTok Shop
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
