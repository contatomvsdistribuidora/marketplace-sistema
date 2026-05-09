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

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const ALL_MODE_PAGE_SIZE = 25; // por origem, quando sourceFilter === "all"
const MAX_SELECTION = 50;
const WARN_SELECTION = 40;

// Heuristica: termo sem espacos provavelmente eh codigo (SKU, EAN, ref interna)
// e nao um nome de produto. Nesse caso usamos OR-search no backend pra cobrir
// name/sku/ean simultaneamente. Termos com espacos (ex: "Pendrive 16gb") ficam
// na busca por nome — mais precisa.
function looksLikeCode(s: string): boolean {
  const trimmed = s.trim();
  return trimmed.length >= 3 && !trimmed.includes(" ");
}

type SourceKind = "baselinker" | "shopee";

type SelectedItem = {
  key: string;        // "baselinker:123" | "shopee:456"
  source: SourceKind;
  sourceId: number;   // BL: productCache.productId | Shopee: shopeeProducts.itemId
  name: string;
  sku: string;
  price: string;
  imageUrl: string | null;
  manufacturerId: number | null;  // BL only — Shopee products não tem manufacturer no cache
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
  manufacturerName,
}: {
  item: SelectedItem;
  isSelected: boolean;
  isPrincipal: boolean;
  onToggle: () => void;
  onSetPrincipal: () => void;
  disabled: boolean;
  manufacturerName: string | null;
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
      <TableCell className="w-24">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-20 w-20 rounded object-cover border"
            loading="lazy"
          />
        ) : (
          <div className="h-20 w-20 rounded bg-muted flex items-center justify-center">
            <Package className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="font-medium text-sm line-clamp-2">{item.name}</div>
      </TableCell>
      <TableCell className="text-xs font-mono whitespace-nowrap max-w-[180px] truncate">
        {item.sku || "—"}
      </TableCell>
      <TableCell className="text-xs max-w-[160px] truncate" title={manufacturerName ?? undefined}>
        {manufacturerName ?? "—"}
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
  const [manufacturerId, setManufacturerId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<number>(25);
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
  }, [sourceFilter, search, shopeeAccountId, manufacturerId, pageSize]);

  // Lista de manufacturers DISTINCT presentes no cache local (instantaneo).
  const cachedManufacturersQuery = trpc.baselinker.getCachedManufacturers.useQuery(
    { inventoryId: inventoryId! },
    { enabled: blAvailable },
  );
  // Nomes oficiais via API BL (pra mapear ID -> nome humano).
  const manufacturerNamesQuery = trpc.baselinker.getManufacturers.useQuery(
    { inventoryId: inventoryId! },
    { enabled: blAvailable, staleTime: 60 * 60 * 1000 },
  );
  // Mapa id -> nome (usado tanto no dropdown quanto na coluna Fabricante).
  // BL retorna array [{manufacturer_id, name, manufacturer_name, ...}].
  // Alguns vem com name vazio — fallback pra manufacturer_name.
  const manufacturerNameMap = useMemo(() => {
    const map = new Map<number, string>();
    const raw = manufacturerNamesQuery.data;
    if (Array.isArray(raw)) {
      for (const m of raw as any[]) {
        const id = Number(m?.manufacturer_id);
        const name = String(m?.name || m?.manufacturer_name || "").trim();
        if (Number.isFinite(id) && name) map.set(id, name);
      }
    }
    return map;
  }, [manufacturerNamesQuery.data]);

  const manufacturerOptions = useMemo(() => {
    const cached = (cachedManufacturersQuery.data ?? []) as Array<{ manufacturerId: number; productCount: number }>;
    return cached
      .map(c => ({
        id: c.manufacturerId,
        label: manufacturerNameMap.get(c.manufacturerId) ?? `Fabricante #${c.manufacturerId}`,
        productCount: c.productCount,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [cachedManufacturersQuery.data, manufacturerNameMap]);

  // BL filters: termos com espaco -> searchName (preciso). Sem espaco -> searchAny
  // (OR em name/sku/ean). manufacturerId acumula AND quando definido.
  const blFilters = useMemo(() => {
    const f: any = {};
    const trimmed = search.trim();
    if (trimmed) {
      if (looksLikeCode(trimmed)) f.searchAny = trimmed;
      else f.searchName = trimmed;
    }
    if (manufacturerId !== null) f.manufacturerId = manufacturerId;
    return f;
  }, [search, manufacturerId]);

  // Pagina/tamanho efetivos por origem. Em modo "all" pagina simultaneamente
  // 25 de cada fonte (offset segue a pagina atual).
  const blPageSize = sourceFilter === "baselinker" ? pageSize : ALL_MODE_PAGE_SIZE;
  const shopeePageSize = sourceFilter === "shopee" ? pageSize : ALL_MODE_PAGE_SIZE;
  const blPage = sourceFilter === "shopee" ? 1 : page;
  const shopeePageOffset = sourceFilter === "baselinker" ? 0 : (page - 1) * shopeePageSize;

  const blQueryEnabled = blAvailable && (sourceFilter === "all" || sourceFilter === "baselinker");
  const { data: blData, isLoading: blLoading, error: blError } = trpc.baselinker.filterProducts.useQuery(
    {
      inventoryId: inventoryId!,
      filters: blFilters,
      page: blPage,
      pageSize: blPageSize,
    },
    { enabled: blQueryEnabled },
  );

  const shopeeQueryEnabled = !!shopeeAccountId && (sourceFilter === "all" || sourceFilter === "shopee");
  const { data: shopeeData, isLoading: shopeeLoading, error: shopeeError } = trpc.shopee.getProducts.useQuery(
    {
      accountId: shopeeAccountId!,
      offset: shopeePageOffset,
      limit: shopeePageSize,
      search: search.trim() || undefined,
      hasVariation: false,
    },
    { enabled: shopeeQueryEnabled },
  );

  // Surfaces silent query failures (ex: token expirado, invalid input) que
  // antes resultavam em "Nenhum produto encontrado" sem feedback ao usuario.
  useEffect(() => {
    if (blError) toast.error(`BaseLinker: ${blError.message}`);
  }, [blError]);
  useEffect(() => {
    if (shopeeError) toast.error(`Shopee: ${shopeeError.message}`);
  }, [shopeeError]);

  const isLoading =
    (blQueryEnabled && blLoading) || (shopeeQueryEnabled && shopeeLoading);

  // Normalização para tipo interno comum
  const normalizedItems: SelectedItem[] = useMemo(() => {
    const out: SelectedItem[] = [];

    if (sourceFilter !== "shopee" && blData?.products) {
      for (const p of (blData.products as any[])) {
        const sourceId = Number(p.productId);
        if (!sourceId) continue;
        const mid = Number(p.manufacturerId);
        out.push({
          key: `baselinker:${sourceId}`,
          source: "baselinker",
          sourceId,
          name: p.name ?? "",
          sku: p.sku ?? "",
          price: String(p.mainPrice ?? "0"),
          imageUrl: p.imageUrl ?? null,
          manufacturerId: Number.isFinite(mid) && mid > 0 ? mid : null,
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
          manufacturerId: null, // Shopee não expoe manufacturer no shopee_products
        });
      }
    }

    return out;
  }, [blData, shopeeData, sourceFilter]);

  // Heuristica: quando a API nao retorna `total`, infere "tem mais paginas"
  // pelo fato de a pagina atual ter vindo cheia. Subestima paginas finais
  // mas evita travar o botao Proxima.
  const blTotal = (blData as any)?.total as number | undefined;
  const shopeeTotal = (shopeeData as any)?.total as number | undefined;
  const blReceivedFull = (blData?.products?.length ?? 0) >= blPageSize;
  const shopeeReceivedFull = (shopeeData?.products?.length ?? 0) >= shopeePageSize;

  const totalPages = useMemo(() => {
    if (sourceFilter === "baselinker") {
      if (blTotal != null) return Math.max(1, Math.ceil(blTotal / pageSize));
      return blReceivedFull ? page + 1 : page; // fallback: avança se veio cheio
    }
    if (sourceFilter === "shopee") {
      if (shopeeTotal != null) return Math.max(1, Math.ceil(shopeeTotal / pageSize));
      return shopeeReceivedFull ? page + 1 : page;
    }
    // Modo "all": pagina simultaneamente, totalPages = max das duas origens.
    const blPages = blTotal != null ? Math.ceil(blTotal / ALL_MODE_PAGE_SIZE) : (blReceivedFull ? page + 1 : page);
    const shPages = shopeeTotal != null ? Math.ceil(shopeeTotal / ALL_MODE_PAGE_SIZE) : (shopeeReceivedFull ? page + 1 : page);
    return Math.max(1, blPages, shPages);
  }, [sourceFilter, blTotal, shopeeTotal, blReceivedFull, shopeeReceivedFull, pageSize, page]);

  const totalCount = useMemo(() => {
    if (sourceFilter === "baselinker") return blTotal ?? normalizedItems.length;
    if (sourceFilter === "shopee") return shopeeTotal ?? normalizedItems.length;
    return (blTotal ?? 0) + (shopeeTotal ?? 0);
  }, [sourceFilter, blTotal, shopeeTotal, normalizedItems.length]);

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
              <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_120px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Buscar por nome, SKU ou EAN..."
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
                <Select
                  value={manufacturerId === null ? "__all__" : String(manufacturerId)}
                  onValueChange={(v) => setManufacturerId(v === "__all__" ? null : Number(v))}
                  disabled={!blAvailable || manufacturerOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Fabricante" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos os fabricantes</SelectItem>
                    {manufacturerOptions.map(m => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.label} ({m.productCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => setPageSize(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map(n => (
                      <SelectItem key={n} value={String(n)}>{n}/pag</SelectItem>
                    ))}
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
                      <TableHead className="w-24"></TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="w-40">SKU</TableHead>
                      <TableHead className="w-40">Fabricante</TableHead>
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
                        manufacturerName={item.manufacturerId != null ? manufacturerNameMap.get(item.manufacturerId) ?? null : null}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Paginação ativa em todos os modos. Em "all" pagina ambas
                  origens simultaneamente (offset por fonte). */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <span className="text-xs text-muted-foreground">
                    Pagina {page} de {totalPages}
                    {totalCount > 0 && ` · ${totalCount.toLocaleString("pt-BR")} produto(s) total`}
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
                  Modo combinado mostra ate {ALL_MODE_PAGE_SIZE} de cada origem por pagina.
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
