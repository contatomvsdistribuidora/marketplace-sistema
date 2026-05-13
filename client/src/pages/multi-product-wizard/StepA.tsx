import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Loader2, ArrowUp, ArrowDown, Pencil, Trash2, Plus, Star, Package, Store,
  Settings2,
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
  onContinue,
}: {
  listing: Listing;
  items: ListingItem[];
  onChange: () => void;
  onContinue?: () => void;
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
      <MultiStoreAccountPicker listing={listing} />

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

/**
 * Multi-store: checkbox list das contas Shopee ativas do usuário. Marcar/
 * desmarcar dispara savePublications imediatamente (autosave on-toggle).
 *
 * Hidratação: listPublications faz auto-seed pra listings antigos (cria 1 row
 * com a conta principal se ainda não houver nenhuma).
 *
 * Esta fase só persiste a seleção em shopee_listing_publications. A publicação
 * real continua usando listing.shopeeAccountId (a conta marcada como
 * "principal"). Multi-loja publica de verdade na Fase 6.
 */
function MultiStoreAccountPicker({ listing }: { listing: Listing }) {
  const accountsQuery = trpc.shopee.listActiveAccounts.useQuery();
  const publicationsQuery = trpc.multiProduct.listPublications.useQuery(
    { listingId: listing.id },
  );
  const utils = trpc.useUtils();
  const saveMutation = trpc.multiProduct.savePublications.useMutation({
    onSuccess: () => {
      utils.multiProduct.listPublications.invalidate({ listingId: listing.id });
    },
    onError: (e) => toast.error(e.message),
  });

  // Defaults do anúncio pra usar como placeholder nos overrides — vêm do
  // wizard JSON (CombinedWizard armazena tudo em wizardStateJson.pricing).
  // Se o JSON ainda não existe (anúncio sem variações configuradas), cai pros
  // defaults hardcoded do CombinedWizard.
  const wizardDefaults = useMemo(() => {
    try {
      const ws = listing.wizardStateJson ? JSON.parse(listing.wizardStateJson) : null;
      return {
        multiplier: String(ws?.pricing?.marginMultiplier ?? "2.5"),
        minMargin: String(ws?.pricing?.minMarginPct ?? "15"),
      };
    } catch {
      return { multiplier: "2.5", minMargin: "15" };
    }
  }, [listing.wizardStateJson]);

  const accounts = accountsQuery.data ?? [];
  const publications = publicationsQuery.data ?? [];
  const pubsByAccountId = new Map(publications.map((p) => [p.shopeeAccountId, p]));
  const selectedIds = new Set(publications.map((p) => p.shopeeAccountId));

  function toggle(accountId: number, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(accountId);
    else next.delete(accountId);

    if (next.size === 0) {
      toast.error("Selecione pelo menos 1 conta.");
      return;
    }
    saveMutation.mutate({
      listingId: listing.id,
      accountIds: Array.from(next),
    });
  }

  const isLoading = accountsQuery.isLoading || publicationsQuery.isLoading;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Contas Shopee</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            {selectedIds.size} {selectedIds.size === 1 ? "conta selecionada" : "contas selecionadas"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Marque as contas onde este anúncio será publicado. Cada conta pode ter multiplicador e
          piso de margem próprios — vazio = herda do anúncio. Publicação multi-loja real chega na Fase 6.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Nenhuma conta Shopee ativa.
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => {
              const checked = selectedIds.has(acc.id);
              const isPrincipal = acc.id === listing.shopeeAccountId;
              const pub = pubsByAccountId.get(acc.id);
              const hasOverride = pub && (pub.priceMultiplier != null || pub.minMarginPct != null);
              // Fase 6.0.4: publication já publicada NÃO pode ser
              // desmarcada — perderia referência ao shopee_item_id na Shopee.
              const isLocked = pub?.publishStatus === "published";
              return (
                <div key={acc.id} className="rounded border border-gray-200">
                  <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted">
                    <Checkbox
                      checked={checked}
                      disabled={saveMutation.isPending || isLocked}
                      onCheckedChange={(v) => {
                        if (isLocked && v === false) {
                          toast.error("Conta já publicada na Shopee. Despublique manualmente na seller.shopee.com.br primeiro.");
                          return;
                        }
                        toggle(acc.id, v === true);
                      }}
                    />
                    <span className="text-sm font-medium flex-1">{acc.shopName ?? `Conta #${acc.shopId}`}</span>
                    <span className="text-xs text-muted-foreground">#{acc.shopId}</span>
                    {isPrincipal && (
                      <Badge variant="outline" className="text-[10px] gap-1 border-yellow-300 bg-yellow-50 text-yellow-700">
                        <Star className="h-3 w-3 fill-yellow-400" />
                        principal
                      </Badge>
                    )}
                    {isLocked && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1 border-green-300 bg-green-50 text-green-700"
                        title="Conta já publicada — não pode ser removida da seleção"
                      >
                        🔒 publicado
                      </Badge>
                    )}
                    {hasOverride && (
                      <Badge variant="outline" className="text-[10px] gap-1 border-orange-300 bg-orange-50 text-orange-700">
                        <Settings2 className="h-3 w-3" />
                        {pub.priceMultiplier != null && `×${Number(pub.priceMultiplier)}`}
                        {pub.priceMultiplier != null && pub.minMarginPct != null && " / "}
                        {pub.minMarginPct != null && `${Number(pub.minMarginPct)}%`}
                      </Badge>
                    )}
                  </div>
                  {checked && pub && (
                    <PublicationPricingPanel
                      publication={pub}
                      defaults={wizardDefaults}
                      onSaved={() => utils.multiProduct.listPublications.invalidate({ listingId: listing.id })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Painel inline de pricing override pra uma publicação (multi-store, Fase 3).
 *
 * Inputs vazios = NULL no banco = herda do anúncio (placeholder mostra o valor
 * herdado). Edição de conteúdo (título/descrição) por conta fica no Step 3
 * (StepB.tsx, Fase 4.1 — movido pra junto do template global).
 */
function PublicationPricingPanel({
  publication,
  defaults,
  onSaved,
}: {
  publication: { id: number; priceMultiplier: string | null; minMarginPct: string | null };
  defaults: { multiplier: string; minMargin: string };
  onSaved: () => void;
}) {
  return (
    <div className="border-t bg-gray-50/50">
      <PricingSection publication={publication} defaults={defaults} onSaved={onSaved} />
    </div>
  );
}

function PricingSection({
  publication,
  defaults,
  onSaved,
}: {
  publication: { id: number; priceMultiplier: string | null; minMarginPct: string | null };
  defaults: { multiplier: string; minMargin: string };
  onSaved: () => void;
}) {
  const [multiplier, setMultiplier] = useState(publication.priceMultiplier ?? "");
  const [minMargin, setMinMargin] = useState(publication.minMarginPct ?? "");

  useEffect(() => {
    setMultiplier(publication.priceMultiplier ?? "");
    setMinMargin(publication.minMarginPct ?? "");
  }, [publication.id, publication.priceMultiplier, publication.minMarginPct]);

  const updateMut = trpc.multiProduct.updatePublicationPricing.useMutation({
    onSuccess: () => {
      toast.success("Pricing atualizado.");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  function save() {
    updateMut.mutate({
      publicationId: publication.id,
      priceMultiplier: multiplier.trim() === "" ? null : multiplier.trim(),
      minMarginPct: minMargin.trim() === "" ? null : minMargin.trim(),
    });
  }
  function clear() {
    setMultiplier("");
    setMinMargin("");
    updateMut.mutate({ publicationId: publication.id, priceMultiplier: null, minMarginPct: null });
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pricing</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`mult-${publication.id}`} className="text-[11px] text-muted-foreground">
            Multiplicador
          </Label>
          <Input
            id={`mult-${publication.id}`}
            type="text"
            inputMode="decimal"
            value={multiplier}
            placeholder={defaults.multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label htmlFor={`mm-${publication.id}`} className="text-[11px] text-muted-foreground flex items-center gap-1">
            Margem mín %
            <span
              className="text-[9px] text-yellow-700 bg-yellow-50 border border-yellow-300 rounded px-1 py-0.5"
              title="Salvo no banco mas ainda não aplicado no cálculo do preço final. Será ativado quando motor de pricing migrar pro servidor (fase futura)."
            >
              inerte
            </span>
          </Label>
          <Input
            id={`mm-${publication.id}`}
            type="text"
            inputMode="decimal"
            value={minMargin}
            placeholder={defaults.minMargin}
            onChange={(e) => setMinMargin(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground italic">
        Multiplicador ATIVO — aplica fator (pub / global do anúncio) sobre o preço calculado.
        Margem mín ainda não aplica no preço final (em desenvolvimento).
      </p>
      <div className="flex items-center gap-2 justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={updateMut.isPending || (multiplier === "" && minMargin === "")}
          className="h-7 text-xs"
        >
          Limpar (herdar)
        </Button>
        <Button size="sm" onClick={save} disabled={updateMut.isPending} className="h-7 text-xs">
          {updateMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Salvar pricing
        </Button>
      </div>
    </div>
  );
}

