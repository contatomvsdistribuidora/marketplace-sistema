import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search, Loader2, ChevronLeft, ChevronRight, Star, X,
  Package, Store, AlertTriangle, ArrowRight, Trash2,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { toast } from "sonner";

const PAGE_SIZE = 25;
const MAX_SELECTION = 50;
const WARN_SELECTION = 40;

type SourceKind = "baselinker" | "shopee";

type SelectedItem = {
  key: string;        // "baselinker:123" | "shopee:456"
  source: SourceKind;
  sourceId: number;   // BL: productCache.productId | Shopee: shopeeProducts.itemId
  name: string;
  sku: string;
  price: string;
  imageUrl: string | null;
};

type SourceFilter = "all" | "baselinker" | "shopee";

function formatPrice(p: string | number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n)) return String(p);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function ProductRow({
  item,
  isSelected,
  isPrincipal,
  onToggle,
  onSetPrincipal,
  disabled,
}: {
  item: SelectedItem;
  isSelected: boolean;
  isPrincipal: boolean;
  onToggle: () => void;
  onSetPrincipal: () => void;
  disabled: boolean;
}) {
  return (
    <TableRow data-key={item.key}>
      <TableCell className="w-10">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          disabled={disabled && !isSelected}
        />
      </TableCell>
      <TableCell className="w-14">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
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
        <div className="font-medium text-sm line-clamp-2">{item.name}</div>
        <div className="text-xs text-muted-foreground">{item.sku || "—"}</div>
      </TableCell>
      <TableCell>
        {item.source === "baselinker" ? (
          <Badge variant="outline" className="text-xs gap-1 border-orange-300 bg-orange-50 text-orange-700">
            <Package className="h-3 w-3" />
            BaseLinker
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs gap-1 border-pink-300 bg-pink-50 text-pink-700">
            <Store className="h-3 w-3" />
            Shopee
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">{formatPrice(item.price)}</TableCell>
      <TableCell className="w-10">
        {isSelected && (
          <Button
            type="button"
            variant={isPrincipal ? "default" : "ghost"}
            size="sm"
            onClick={onSetPrincipal}
            title={isPrincipal ? "Produto principal" : "Definir como principal"}
            className="h-8 w-8 p-0"
          >
            <Star className={`h-4 w-4 ${isPrincipal ? "fill-current" : ""}`} />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function SelectionSidebar({
  selected,
  principalKey,
  onRemove,
  onSetPrincipal,
  onClear,
  onSubmit,
  isSubmitting,
  canSubmit,
  blockingReason,
  submitLabel,
}: {
  selected: Map<string, SelectedItem>;
  principalKey: string | null;
  onRemove: (key: string) => void;
  onSetPrincipal: (key: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  canSubmit: boolean;
  blockingReason: string | null;
  submitLabel: string;
}) {
  const items = Array.from(selected.values());
  const count = items.length;
  const overWarn = count >= WARN_SELECTION && count < MAX_SELECTION;
  const overMax = count >= MAX_SELECTION;

  return (
    <Card className="sticky top-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Selecionados</CardTitle>
          <Badge variant="outline" className={overMax ? "border-red-300 bg-red-50 text-red-700" : overWarn ? "border-yellow-300 bg-yellow-50 text-yellow-700" : ""}>
            {count} / {MAX_SELECTION}
          </Badge>
        </div>
        <CardDescription>
          Marque um item como ⭐ principal antes de prosseguir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {overWarn && !overMax && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Aproximando do limite de {MAX_SELECTION} variações por anúncio Shopee.
            </AlertDescription>
          </Alert>
        )}
        {overMax && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Limite máximo atingido. Remova itens para adicionar outros.
            </AlertDescription>
          </Alert>
        )}

        {count === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            Nenhum produto selecionado.
          </div>
        ) : (
          <ScrollArea className="h-72 pr-2">
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.key}
                  className={`flex items-start gap-2 rounded border p-2 ${principalKey === it.key ? "bg-yellow-50 border-yellow-300" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => onSetPrincipal(it.key)}
                    className="shrink-0 mt-0.5"
                    title={principalKey === it.key ? "Produto principal" : "Definir como principal"}
                  >
                    <Star className={`h-4 w-4 ${principalKey === it.key ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground"}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium line-clamp-2">{it.name}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <span>{it.source === "baselinker" ? "BL" : "Shopee"}</span>
                      <span>·</span>
                      <span>{it.sku || "—"}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(it.key)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title="Remover"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

        {blockingReason && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{blockingReason}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Button
            onClick={onSubmit}
            disabled={!canSubmit || isSubmitting}
            className="w-full"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
            {submitLabel}
          </Button>
          {count > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} disabled={isSubmitting}>
              <Trash2 className="h-4 w-4 mr-2" />
              Limpar seleção
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MultiProductPage() {
  const urlSearch = useSearch();
  const [, setLocation] = useLocation();

  // ?addToListing=N → modo "adicionar produtos a listing existente"
  const addToListingId = useMemo(() => {
    const p = new URLSearchParams(urlSearch).get("addToListing");
    const n = p ? Number(p) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [urlSearch]);

  const [shopeeAccountId, setShopeeAccountId] = useState<number | null>(null);
  const [mode, setMode] = useState<"new" | "promote">("new");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());
  const [principalKey, setPrincipalKey] = useState<string | null>(null);

  const utils = trpc.useUtils();

  // Em modo "adicionar", buscamos o listing existente para travar shopeeAccountId
  // e contar itens já adicionados (limite 50 global).
  const existingListingQuery = trpc.multiProduct.getMultiProductListing.useQuery(
    { id: addToListingId! },
    { enabled: addToListingId !== null, retry: false },
  );

  useEffect(() => {
    if (addToListingId !== null && existingListingQuery.error) {
      toast.error(existingListingQuery.error.message || "Anúncio combinado não encontrado.");
      setLocation("/multi-product");
    }
  }, [addToListingId, existingListingQuery.error]);

  // Sincroniza shopeeAccountId/mode com listing existente quando em modo addTo
  useEffect(() => {
    if (addToListingId !== null && existingListingQuery.data) {
      const l = existingListingQuery.data.listing as any;
      setShopeeAccountId(l.shopeeAccountId);
      setMode(l.mode);
    }
  }, [addToListingId, existingListingQuery.data]);

  const existingItemCount = addToListingId !== null
    ? existingListingQuery.data?.items.length ?? 0
    : 0;

  const remainingSlots = MAX_SELECTION - existingItemCount;
  const isLoadingAddToListing = addToListingId !== null && existingListingQuery.isLoading;

  // Pré-requisitos
  const { data: accounts, isLoading: accountsLoading } = trpc.shopee.getAccounts.useQuery();
  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;
  const blAvailable = !!tokenData?.hasToken && !!inventoryId;

  // Auto-selecionar primeira conta ativa
  useEffect(() => {
    if (!shopeeAccountId && accounts && accounts.length > 0) {
      const active = (accounts as any[]).find((a) => a.isActive);
      if (active) setShopeeAccountId(active.id);
    }
  }, [accounts, shopeeAccountId]);

  // Reset página quando filtros mudam
  useEffect(() => {
    setPage(1);
  }, [sourceFilter, search, shopeeAccountId]);

  // BL filters: o input "search" filtra nome/SKU/EAN simultaneamente.
  // O endpoint BL não tem campo "any" — montamos filtros por nome quando há
  // texto. Para EAN/SKU fazemos OR no client filtrando o resultado, ou só
  // pelo nome (mais comum). Aqui optamos por: searchName=texto.
  const blFilters = useMemo(() => {
    const f: any = {};
    if (search.trim()) f.searchName = search.trim();
    return f;
  }, [search]);

  const blQueryEnabled = blAvailable && (sourceFilter === "all" || sourceFilter === "baselinker");
  const { data: blData, isLoading: blLoading } = trpc.baselinker.filterProducts.useQuery(
    {
      inventoryId: inventoryId!,
      filters: blFilters,
      page: sourceFilter === "baselinker" ? page : 1,
      pageSize: sourceFilter === "baselinker" ? PAGE_SIZE : 10,
    },
    { enabled: blQueryEnabled },
  );

  const shopeeQueryEnabled = !!shopeeAccountId && (sourceFilter === "all" || sourceFilter === "shopee");
  const { data: shopeeData, isLoading: shopeeLoading } = trpc.shopee.getProducts.useQuery(
    {
      accountId: shopeeAccountId!,
      offset: sourceFilter === "shopee" ? (page - 1) * PAGE_SIZE : 0,
      limit: sourceFilter === "shopee" ? PAGE_SIZE : 10,
      search: search.trim() || undefined,
      hasVariation: false,
    },
    { enabled: shopeeQueryEnabled },
  );

  const isLoading =
    (blQueryEnabled && blLoading) || (shopeeQueryEnabled && shopeeLoading);

  // Normalização para tipo interno comum
  const normalizedItems: SelectedItem[] = useMemo(() => {
    const out: SelectedItem[] = [];

    if (sourceFilter !== "shopee" && blData?.products) {
      for (const p of (blData.products as any[])) {
        const sourceId = Number(p.productId);
        if (!sourceId) continue;
        out.push({
          key: `baselinker:${sourceId}`,
          source: "baselinker",
          sourceId,
          name: p.name ?? "",
          sku: p.sku ?? "",
          price: String(p.mainPrice ?? "0"),
          imageUrl: p.imageUrl ?? null,
        });
      }
    }

    if (sourceFilter !== "baselinker" && shopeeData?.products) {
      for (const p of (shopeeData.products as any[])) {
        const sourceId = Number(p.itemId);
        if (!sourceId) continue;
        out.push({
          key: `shopee:${sourceId}`,
          source: "shopee",
          sourceId,
          name: p.itemName ?? "",
          sku: p.itemSku ?? "",
          price: String(p.price ?? "0"),
          imageUrl: p.imageUrl ?? null,
        });
      }
    }

    return out;
  }, [blData, shopeeData, sourceFilter]);

  const totalCount = useMemo(() => {
    if (sourceFilter === "baselinker") return (blData as any)?.total ?? normalizedItems.length;
    if (sourceFilter === "shopee") return (shopeeData as any)?.total ?? normalizedItems.length;
    return normalizedItems.length;
  }, [blData, shopeeData, sourceFilter, normalizedItems.length]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Seleção
  const isMaxed = selected.size >= remainingSlots;

  function toggleItem(item: SelectedItem) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.key)) {
        next.delete(item.key);
        if (principalKey === item.key) setPrincipalKey(null);
      } else {
        if (next.size >= remainingSlots) {
          toast.error(
            addToListingId !== null
              ? `Limite total de ${MAX_SELECTION} atingido (${existingItemCount} já no anúncio).`
              : `Limite de ${MAX_SELECTION} produtos atingido.`
          );
          return prev;
        }
        next.set(item.key, item);
      }
      return next;
    });
  }

  function setPrincipal(key: string) {
    setPrincipalKey((current) => (current === key ? null : key));
  }

  function removeFromSelection(key: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    if (principalKey === key) setPrincipalKey(null);
  }

  function clearSelection() {
    setSelected(new Map());
    setPrincipalKey(null);
  }

  // Mutations
  const createListing = trpc.multiProduct.createMultiProductListing.useMutation();
  const addItem = trpc.multiProduct.addItemToListing.useMutation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const principal = principalKey ? selected.get(principalKey) ?? null : null;

  const blockingReason: string | null = useMemo(() => {
    if (!shopeeAccountId) return "Selecione uma conta Shopee.";
    if (selected.size === 0) return "Selecione pelo menos 1 produto.";
    // Em modo addToListing, principal já existe no listing — sem validação
    if (addToListingId !== null) return null;
    if (!principal) return "Defina o produto principal (⭐).";
    if (mode === "promote" && principal.source !== "shopee") {
      return "No modo promover, o produto principal precisa ser um anúncio Shopee existente.";
    }
    return null;
  }, [shopeeAccountId, selected.size, principal, mode, addToListingId]);

  const canSubmit = blockingReason === null && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit || !shopeeAccountId) return;
    setIsSubmitting(true);
    try {
      // Modo "adicionar a listing existente"
      if (addToListingId !== null) {
        const itemsToAdd = Array.from(selected.values());
        for (let i = 0; i < itemsToAdd.length; i++) {
          const it = itemsToAdd[i];
          await addItem.mutateAsync({
            listingId: addToListingId,
            source: it.source,
            sourceId: it.sourceId,
            position: existingItemCount + i,
          });
        }
        toast.success(`${itemsToAdd.length} produto(s) adicionado(s) ao anúncio #${addToListingId}.`);
        utils.multiProduct.getMultiProductListing.invalidate({ id: addToListingId });
        clearSelection();
        setLocation(`/multi-product-wizard?id=${addToListingId}`);
        return;
      }

      // Modo "criar novo listing"
      if (!principal) return;
      const created = await createListing.mutateAsync({
        shopeeAccountId,
        mode,
        mainProductSource: principal.source,
        mainProductSourceId: principal.sourceId,
        existingShopeeItemId:
          mode === "promote" ? principal.sourceId : undefined,
      });

      const listingId = created.id;
      // Insere os itens em sequência. Position: principal primeiro, demais
      // na ordem em que foram selecionados.
      const ordered = [
        principal,
        ...Array.from(selected.values()).filter((it) => it.key !== principal.key),
      ];

      for (let i = 0; i < ordered.length; i++) {
        const it = ordered[i];
        await addItem.mutateAsync({
          listingId,
          source: it.source,
          sourceId: it.sourceId,
          position: i,
        });
      }

      toast.success(`Anúncio combinado #${listingId} criado com ${ordered.length} produtos.`);
      utils.multiProduct.listMultiProductListings.invalidate();
      clearSelection();
      setLocation(`/multi-product-wizard?id=${listingId}`);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao criar anúncio combinado.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Estado vazio: nenhuma conta Shopee
  if (!accountsLoading && (!accounts || accounts.length === 0)) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Store className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">Nenhuma conta Shopee conectada</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Conecte uma conta Shopee antes de criar anúncios combinados.
            </p>
            <Button onClick={() => (window.location.href = "/shopee-accounts")}>
              Ir para contas Shopee
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 lg:p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          {addToListingId !== null
            ? `Adicionar produtos ao anúncio #${addToListingId}`
            : "Anúncio Combinado (multi-produto)"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {addToListingId !== null
            ? `Restam ${remainingSlots} vaga(s) — ${existingItemCount} produto(s) já no anúncio.`
            : "Selecione produtos do BaseLinker ou anúncios Shopee existentes para gerar um anúncio com variações."}
        </p>
      </div>

      {/* Pré-requisitos — escondido em modo addTo (listing já tem conta + modo) */}
      {addToListingId === null && (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Configuração</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-xs mb-1.5 block">Conta Shopee</Label>
            <Select
              value={shopeeAccountId?.toString() ?? ""}
              onValueChange={(v) => setShopeeAccountId(Number(v))}
              disabled={accountsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma conta..." />
              </SelectTrigger>
              <SelectContent>
                {(accounts as any[] | undefined)?.filter((a) => a.isActive).map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.shopName || `Loja ${a.shopId}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Modo</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "new" | "promote")}
              className="flex gap-4 pt-1"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="new" id="mode-new" />
                <Label htmlFor="mode-new" className="text-sm font-normal cursor-pointer">
                  Criar novo
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="promote" id="mode-promote" />
                <Label htmlFor="mode-promote" className="text-sm font-normal cursor-pointer">
                  Promover existente
                </Label>
              </div>
            </RadioGroup>
            {mode === "promote" && (
              <p className="text-xs text-muted-foreground mt-2">
                O ⭐ principal precisa ser um anúncio Shopee existente.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {/* Layout principal */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Coluna 1 — lista */}
        <div className="space-y-4">
          {/* Filtros */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Buscar por nome ou SKU..."
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSearch(searchDraft);
                    }}
                    className="pl-9"
                  />
                </div>
                <Select
                  value={sourceFilter}
                  onValueChange={(v) => setSourceFilter(v as SourceFilter)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as origens</SelectItem>
                    <SelectItem value="baselinker" disabled={!blAvailable}>
                      BaseLinker {!blAvailable && "(não configurado)"}
                    </SelectItem>
                    <SelectItem value="shopee">Shopee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!blAvailable && sourceFilter !== "shopee" && (
                <p className="text-xs text-muted-foreground">
                  BaseLinker não configurado — apenas produtos Shopee aparecerão.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Tabela */}
          {isLoadingAddToListing && (
            <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 mb-3">
              Carregando informações do anúncio existente...
            </div>
          )}
          <Card>
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : normalizedItems.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  Nenhum produto encontrado.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead className="w-14"></TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="w-32">Origem</TableHead>
                      <TableHead className="w-28">Preço</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {normalizedItems.map((item) => (
                      <ProductRow
                        key={item.key}
                        item={item}
                        isSelected={selected.has(item.key)}
                        isPrincipal={principalKey === item.key}
                        onToggle={() => toggleItem(item)}
                        onSetPrincipal={() => setPrincipal(item.key)}
                        disabled={isMaxed || isLoadingAddToListing}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Paginação (só ativa quando filtro de origem é único) */}
              {sourceFilter !== "all" && totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <span className="text-xs text-muted-foreground">
                    Página {page} de {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              {sourceFilter === "all" && (
                <p className="text-xs text-muted-foreground pt-3">
                  Use um filtro de origem específico para paginar resultados completos.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna 2 — resumo */}
        <SelectionSidebar
          selected={selected}
          principalKey={principalKey}
          onRemove={removeFromSelection}
          onSetPrincipal={setPrincipal}
          onClear={clearSelection}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          canSubmit={canSubmit}
          blockingReason={blockingReason}
          submitLabel={addToListingId !== null ? "Adicionar selecionados ao anúncio" : "Próximo passo"}
        />
      </div>
    </div>
  );
}
