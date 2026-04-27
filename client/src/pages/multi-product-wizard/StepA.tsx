import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, ArrowUp, ArrowDown, Pencil, Trash2, Plus, Star, Package,
} from "lucide-react";
import { toast } from "sonner";
import {
  itemKey, formatPrice, SourceBadge,
  type Listing, type ListingItem,
} from "./types";
import { useResolvedProducts } from "./useResolvedProducts";

export function StepA({
  listing,
  items,
  onChange,
}: {
  listing: Listing;
  items: ListingItem[];
  onChange: () => void;
}) {
  const [, setLocation] = useLocation();
  const [editItem, setEditItem] = useState<ListingItem | null>(null);
  const [removeItem, setRemoveItem] = useState<ListingItem | null>(null);
  const [changePrincipalOpen, setChangePrincipalOpen] = useState(false);

  const { productMap, isResolving } = useResolvedProducts(listing, items);

  const reorderMutation = trpc.multiProduct.reorderListingItems.useMutation({
    onSuccess: () => onChange(),
    onError: (e) => toast.error(e.message),
  });
  const removeItemMutation = trpc.multiProduct.removeListingItem.useMutation({
    onSuccess: () => {
      onChange();
      setRemoveItem(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const updateListingMutation = trpc.multiProduct.updateMultiProductListing.useMutation({
    onSuccess: () => {
      onChange();
      setChangePrincipalOpen(false);
      toast.success("Produto principal atualizado.");
    },
    onError: (e) => toast.error(e.message),
  });

  function moveItem(idx: number, direction: -1 | 1) {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(newIdx, 0, moved);
    reorderMutation.mutate({
      listingId: listing.id,
      orderedIds: reordered.map((it) => it.id),
    });
  }

  const principalKey = itemKey(listing.mainProductSource, Number(listing.mainProductSourceId));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Produtos do anúncio</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "produto" : "produtos"} · principal marcado com ⭐
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setChangePrincipalOpen(true)}
            disabled={items.length === 0}
          >
            <Star className="h-4 w-4 mr-1" />
            Trocar principal
          </Button>
          <Button onClick={() => setLocation(`/multi-product?addToListing=${listing.id}`)}>
            <Plus className="h-4 w-4 mr-1" />
            Adicionar produtos
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          {items.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Nenhum produto neste anúncio. Clique em "Adicionar produtos".
            </div>
          ) : isResolving ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-20">Origem</TableHead>
                  <TableHead className="w-28">Preço</TableHead>
                  <TableHead className="w-32">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, idx) => {
                  const k = itemKey(it.source, Number(it.sourceId));
                  const resolved = productMap.get(k);
                  const isPrincipal = k === principalKey;
                  const displayPrice = it.customPrice ?? resolved?.price ?? null;
                  const displaySku = it.customSku ?? resolved?.sku ?? "";
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          {isPrincipal && (
                            <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />
                          )}
                          <span>{idx + 1}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {resolved?.imageUrl ? (
                          <img
                            src={resolved.imageUrl}
                            alt={resolved.name}
                            className="h-10 w-10 rounded object-cover border"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                            <Package className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm line-clamp-2">
                          {resolved?.name || `(produto ${it.sourceId})`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {displaySku || "—"}
                          {it.customSku && (
                            <Badge variant="outline" className="ml-2 text-[10px]">custom</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <SourceBadge source={it.source} />
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatPrice(displayPrice)}
                        {it.customPrice && (
                          <Badge variant="outline" className="ml-1 text-[10px]">custom</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={idx === 0 || reorderMutation.isPending}
                            onClick={() => moveItem(idx, -1)}
                            title="Mover para cima"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={idx === items.length - 1 || reorderMutation.isPending}
                            onClick={() => moveItem(idx, 1)}
                            title="Mover para baixo"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditItem(it)}
                            title="Editar custom price/SKU"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => setRemoveItem(it)}
                            title="Remover"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EditItemDialog
        item={editItem}
        onClose={() => setEditItem(null)}
        onSaved={() => {
          onChange();
          setEditItem(null);
        }}
      />

      <AlertDialog
        open={removeItem !== null}
        onOpenChange={(open) => !open && setRemoveItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover produto do anúncio?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove a variação do anúncio combinado. O produto original
              não é alterado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removeItem && removeItemMutation.mutate({ id: removeItem.id })
              }
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={changePrincipalOpen} onOpenChange={setChangePrincipalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir produto principal</DialogTitle>
            <DialogDescription>
              {listing.mode === "promote"
                ? "No modo promover, o principal precisa ser um anúncio Shopee existente."
                : "Selecione qual produto será o principal."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2 py-1">
            {items.map((it) => {
              const k = itemKey(it.source, Number(it.sourceId));
              const resolved = productMap.get(k);
              const isCurrent = k === principalKey;
              const disabled = listing.mode === "promote" && it.source !== "shopee";
              return (
                <button
                  key={it.id}
                  type="button"
                  disabled={disabled || updateListingMutation.isPending}
                  onClick={() =>
                    updateListingMutation.mutate({
                      id: listing.id,
                      mainProductSource: it.source,
                      mainProductSourceId: Number(it.sourceId),
                    })
                  }
                  className={`w-full text-left rounded border p-3 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed ${
                    isCurrent ? "bg-yellow-50 border-yellow-300" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isCurrent && <Star className="h-4 w-4 fill-yellow-400 text-yellow-500 shrink-0" />}
                    <SourceBadge source={it.source} />
                    <span className="text-sm font-medium line-clamp-1 flex-1">
                      {resolved?.name || `(produto ${it.sourceId})`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditItemDialog({
  item,
  onClose,
  onSaved,
}: {
  item: ListingItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customPrice, setCustomPrice] = useState("");
  const [customSku, setCustomSku] = useState("");

  useEffect(() => {
    if (item) {
      setCustomPrice(item.customPrice ?? "");
      setCustomSku(item.customSku ?? "");
    }
  }, [item?.id]);

  const updateMutation = trpc.multiProduct.updateListingItem.useMutation({
    onSuccess: () => {
      toast.success("Item atualizado.");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!item) return null;

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar variação</DialogTitle>
          <DialogDescription>
            Sobrescreva preço e/ou SKU para esta variação. Deixe vazio para usar
            o valor da origem.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="custom-price" className="text-xs">Preço custom (R$)</Label>
            <Input
              id="custom-price"
              type="text"
              inputMode="decimal"
              placeholder="ex: 49.90"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="custom-sku" className="text-xs">SKU custom</Label>
            <Input
              id="custom-sku"
              placeholder="(usa SKU original se vazio)"
              value={customSku}
              onChange={(e) => setCustomSku(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={updateMutation.isPending}
            onClick={() =>
              updateMutation.mutate({
                id: item.id,
                customPrice: customPrice.trim() || null,
                customSku: customSku.trim() || null,
              })
            }
          >
            {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
