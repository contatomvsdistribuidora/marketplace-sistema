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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import {
  Search, Loader2, ChevronLeft, ChevronRight, Star, X,
  Package, Store, AlertTriangle, ArrowRight, Trash2, Check, ChevronsUpDown, SlidersHorizontal,
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
  // Galeria opcional — so BL via getProductsCostInfo (que o picker nao chama).
  // Picker deixa undefined; ProductImage cai pro single imageUrl.
  imageUrls?: string[];
  manufacturerId: number | null;  // BL only — Shopee products não tem manufacturer no cache
  totalStock: number | null;      // BL: product_cache.totalStock | Shopee: stock
  averageCost: number | null;     // BL only — average_landed_cost com fallback pra average_cost; null em Shopee
  shopeeBrandName: string | null; // Shopee only — extraido de brand.original_brand_name (apenas brand_id > 0; sentinela "No Brand" vira null)
  shopeeBrandId: number | null;   // Shopee only — brand_id real (> 0). Usado pelo filtro client-side de Marca Shopee.
};

type SourceFilter = "all" | "baselinker" | "shopee";

function formatPrice(p: string | number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n)) return String(p);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function StockCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-300">—</span>;
  if (value < 0) return <span className="text-red-600 font-semibold tabular-nums">{value}</span>;
  if (value === 0) return <span className="text-amber-600 font-semibold tabular-nums">0</span>;
  return <span className="text-gray-700 tabular-nums">{value.toLocaleString("pt-BR")}</span>;
}

function CostCell({ value }: { value: number | null }) {
  if (value == null || value <= 0) return <span className="text-gray-300">—</span>;
  return <span className="text-gray-700 tabular-nums">{value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>;
}

/**
 * Renderiza imagem com cadeia de fallback: tenta urls[0], se onError dispara
 * avanca pra urls[1], etc. Quando esgota, mostra placeholder Package. Aceita
 * `single` como fallback final pra quando `urls` esta vazio.
 */
function ProductImage({ urls, single, alt }: { urls?: string[]; single: string | null; alt: string }) {
  const list = (urls && urls.length > 0) ? urls : (single ? [single] : []);
  const [idx, setIdx] = useState(0);
  const url = list[idx];
  if (!url) {
    return (
      <div className="h-20 w-20 rounded bg-muted flex items-center justify-center">
        <Package className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className="h-20 w-20 rounded object-cover border"
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

function ProductRow({
  item,
  isSelected,
  isPrincipal,
  onToggle,
  onSetPrincipal,
  disabled,
  brandName,
}: {
  item: SelectedItem;
  isSelected: boolean;
  isPrincipal: boolean;
  onToggle: () => void;
  onSetPrincipal: () => void;
  disabled: boolean;
  brandName: string | null;
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
      <TableCell style={{ width: 96, minWidth: 96 }}>
        <ProductImage urls={item.imageUrls} single={item.imageUrl} alt={item.name} />
      </TableCell>
      <TableCell>
        <div className="font-medium text-sm line-clamp-2">{item.name}</div>
      </TableCell>
      <TableCell className="text-xs font-mono whitespace-nowrap max-w-[180px] truncate">
        {item.sku || "—"}
      </TableCell>
      <TableCell className="text-xs max-w-[160px] truncate" title={brandName ?? undefined}>
        {brandName ?? "—"}
      </TableCell>
      <TableCell className="text-xs text-right">
        <CostCell value={item.averageCost} />
      </TableCell>
      <TableCell className="text-xs text-right">
        <StockCell value={item.totalStock} />
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

/**
 * Combobox de marca com busca interna. Usado tanto no filtro principal
 * quanto no painel de busca avancada. value=null significa "todas".
 */
function BrandCombobox({
  value,
  onChange,
  options,
  disabled,
  placeholder = "Marca",
  emptyLabel = "Todas as marcas",
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  options: Array<{ id: number; label: string; productCount: number }>;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = value === null
    ? null
    : options.find(o => o.id === value)?.label ?? `Marca #${value}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-left flex-1">
            {selectedLabel ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3 w-3 ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar marca..." />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhuma marca encontrada.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => { onChange(null); setOpen(false); }}
                className="text-muted-foreground"
              >
                <Check className={`mr-2 h-4 w-4 ${value === null ? "opacity-100" : "opacity-0"}`} />
                {emptyLabel}
              </CommandItem>
              {options.map(o => (
                <CommandItem
                  key={o.id}
                  value={o.label}
                  onSelect={() => { onChange(o.id); setOpen(false); }}
                >
                  <Check className={`mr-2 h-4 w-4 ${value === o.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="flex-1 truncate">{o.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{o.productCount}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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

  // Painel de busca avancada (F3). Quando aberto E algum campo preenchido,
  // sobrescreve a busca smart unica (looksLikeCode) com filtros explicitos.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState({
    name: "",
    sku: "",
    ean: "",
    brandBL: null as number | null,
    shopeeBrandId: null as number | null,
    categoryId: "",
    priceMin: "",
    priceMax: "",
    stockMin: "",
  });
  const advancedActive = advancedOpen && (
    !!advancedFilters.name || !!advancedFilters.sku || !!advancedFilters.ean ||
    advancedFilters.brandBL !== null || advancedFilters.shopeeBrandId !== null ||
    !!advancedFilters.categoryId ||
    !!advancedFilters.priceMin || !!advancedFilters.priceMax || !!advancedFilters.stockMin
  );

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
  }, [sourceFilter, search, shopeeAccountId, manufacturerId, pageSize, advancedActive, advancedFilters]);

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
  // Mapa id -> nome (usado tanto no dropdown quanto na coluna Marca).
  // BL retorna array [{manufacturer_id, name, manufacturer_name, ...}].
  // Alguns vem com name vazio — fallback pra manufacturer_name.
  // Nota: campo BL chama-se manufacturerId, mas no contexto Shopee/usuario
  // a label correta e' "Marca" — e' isso que vai pro brand_id da Shopee.
  const brandNameMap = useMemo(() => {
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

  const brandOptions = useMemo(() => {
    const cached = (cachedManufacturersQuery.data ?? []) as Array<{ manufacturerId: number; productCount: number }>;
    return cached
      .map(c => ({
        id: c.manufacturerId,
        label: brandNameMap.get(c.manufacturerId) ?? `Marca #${c.manufacturerId}`,
        productCount: c.productCount,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [cachedManufacturersQuery.data, brandNameMap]);

  // Marcas Shopee — vem do backfill da coluna brand. Filtra brand_id > 0
  // (descarta sentinela "No Brand"). Sempre habilitado se houver pelo menos
  // 1 marca em cache; nao depende de blAvailable.
  const cachedShopeeBrandsQuery = trpc.shopee.getCachedShopeeBrands.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const shopeeBrandOptions = useMemo(() => {
    const data = (cachedShopeeBrandsQuery.data ?? []) as Array<{ brandId: number; brandName: string; productCount: number }>;
    return data.map(b => ({ id: b.brandId, label: b.brandName, productCount: b.productCount }));
  }, [cachedShopeeBrandsQuery.data]);

  // BL filters: quando painel avancado tem campos preenchidos, mandam todos
  // os filtros explicitos (sobrescreve a busca smart). Caso contrario, usa
  // a busca smart: termo sem espaco -> searchAny (OR em name/sku/ean),
  // termo com espaco -> searchName.
  const blFilters = useMemo(() => {
    if (advancedActive) {
      const f: any = {};
      if (advancedFilters.name.trim()) f.searchName = advancedFilters.name.trim();
      if (advancedFilters.sku.trim()) f.searchSku = advancedFilters.sku.trim();
      if (advancedFilters.ean.trim()) f.searchEan = advancedFilters.ean.trim();
      if (advancedFilters.brandBL !== null) f.manufacturerId = advancedFilters.brandBL;
      if (advancedFilters.categoryId.trim()) {
        const c = parseInt(advancedFilters.categoryId);
        if (Number.isFinite(c)) f.categoryId = c;
      }
      if (advancedFilters.priceMin.trim()) {
        const v = parseFloat(advancedFilters.priceMin);
        if (Number.isFinite(v)) f.priceMin = v;
      }
      if (advancedFilters.priceMax.trim()) {
        const v = parseFloat(advancedFilters.priceMax);
        if (Number.isFinite(v)) f.priceMax = v;
      }
      if (advancedFilters.stockMin.trim()) {
        const v = parseInt(advancedFilters.stockMin);
        if (Number.isFinite(v)) f.stockMin = v;
      }
      return f;
    }
    const f: any = {};
    const trimmed = search.trim();
    if (trimmed) {
      if (looksLikeCode(trimmed)) f.searchAny = trimmed;
      else f.searchName = trimmed;
    }
    if (manufacturerId !== null) f.manufacturerId = manufacturerId;
    return f;
  }, [search, manufacturerId, advancedActive, advancedFilters]);

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

  // IDs BL da pagina atual — usado pra hidratar custo medio. Shopee fora.
  const blIdsOnPage = useMemo(() => {
    const ids: number[] = [];
    for (const p of (blData?.products ?? []) as any[]) {
      const id = Number(p.id);
      if (Number.isFinite(id) && id > 0) ids.push(id);
    }
    return ids;
  }, [blData]);

  const { data: costInfoOnPage } = trpc.baselinker.getProductsCostInfo.useQuery(
    { inventoryId: inventoryId!, productIds: blIdsOnPage },
    { enabled: blAvailable && blIdsOnPage.length > 0, staleTime: 5 * 60 * 1000 },
  );

  // Custo: prefere average_landed_cost, cai em average_cost (mesma regra do
  // CombinedWizard). Map por productId pra lookup O(1) na normalizacao.
  const costByProductId = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of (costInfoOnPage ?? []) as Array<{ productId: number; averageCost: number | null; averageLandedCost: number | null }>) {
      const landed = typeof c.averageLandedCost === "number" ? c.averageLandedCost : 0;
      const avg = typeof c.averageCost === "number" ? c.averageCost : 0;
      const cost = landed > 0 ? landed : avg;
      if (cost > 0) map.set(c.productId, cost);
    }
    return map;
  }, [costInfoOnPage]);

  // Normalização para tipo interno comum
  const normalizedItems: SelectedItem[] = useMemo(() => {
    const out: SelectedItem[] = [];

    if (sourceFilter !== "shopee" && blData?.products) {
      for (const p of (blData.products as any[])) {
        // filterProductsFromCache mapeia productCache.productId -> chave `id`.
        // Procurar `productId` aqui retornava undefined -> NaN -> todos pulados,
        // tabela ficava vazia mesmo com 25 produtos chegando.
        const sourceId = Number(p.id);
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
          totalStock: typeof p.totalStock === "number" ? p.totalStock : null,
          averageCost: costByProductId.get(sourceId) ?? null,
          shopeeBrandName: null,
          shopeeBrandId: null,
        });
      }
    }

    if (sourceFilter !== "baselinker" && shopeeData?.products) {
      for (const p of (shopeeData.products as any[])) {
        const sourceId = Number(p.itemId);
        if (!sourceId) continue;
        // Brand JSON: { brand_id, original_brand_name }. brand_id <= 0 e' sentinela
        // "No Brand" do backfill — tratamos como sem marca pra UI.
        const brandObj = p.brand && typeof p.brand === "object" ? p.brand : null;
        const brandIdNum = brandObj && typeof brandObj.brand_id === "number" ? brandObj.brand_id : 0;
        const shopeeBrandName = brandIdNum > 0 ? String(brandObj.original_brand_name ?? "") || null : null;
        out.push({
          key: `shopee:${sourceId}`,
          source: "shopee",
          sourceId,
          name: p.itemName ?? "",
          sku: p.itemSku ?? "",
          price: String(p.price ?? "0"),
          imageUrl: p.imageUrl ?? null,
          manufacturerId: null, // Shopee não expoe manufacturer no shopee_products
          totalStock: typeof p.stock === "number" ? p.stock : null,
          averageCost: null,
          shopeeBrandName,
          shopeeBrandId: brandIdNum > 0 ? brandIdNum : null,
        });
      }
    }

    // Filtro client-side de Marca Shopee. Roda aqui (em vez de no servidor)
    // porque shopee_products.brand e' coluna nova e o endpoint getProducts
    // ainda nao expoe o filtro. So afeta items source="shopee"; BL passa direto.
    const shopeeBrandFilter = advancedActive ? advancedFilters.shopeeBrandId : null;
    if (shopeeBrandFilter !== null) {
      return out.filter(it => it.source !== "shopee" || it.shopeeBrandId === shopeeBrandFilter);
    }
    return out;
  }, [blData, shopeeData, sourceFilter, costByProductId, advancedActive, advancedFilters.shopeeBrandId]);

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
    <div className="container mx-auto p-4 lg:p-6 max-w-screen-2xl">
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
                <BrandCombobox
                  value={manufacturerId}
                  onChange={setManufacturerId}
                  options={brandOptions}
                  disabled={!blAvailable || brandOptions.length === 0}
                  placeholder="Marca BL"
                />
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

              {/* F3: Toggle painel busca avancada */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(o => !o)}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  {advancedOpen ? "− Busca avançada" : "+ Busca avançada"}
                  {advancedActive && (
                    <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1 border-orange-300 bg-orange-50 text-orange-700">
                      ativa
                    </Badge>
                  )}
                </button>
                {advancedActive && (
                  <button
                    type="button"
                    onClick={() => setAdvancedFilters({
                      name: "", sku: "", ean: "", brandBL: null, shopeeBrandId: null,
                      categoryId: "", priceMin: "", priceMax: "", stockMin: "",
                    })}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Limpar avançada
                  </button>
                )}
              </div>

              {/* F3: Painel de busca avancada */}
              {advancedOpen && (
                <div className="grid gap-2 md:grid-cols-3 pt-2 border-t border-gray-100">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Nome contém</Label>
                    <Input
                      value={advancedFilters.name}
                      onChange={(e) => setAdvancedFilters(f => ({ ...f, name: e.target.value }))}
                      placeholder="ex: saco lixo"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">SKU</Label>
                    <Input
                      value={advancedFilters.sku}
                      onChange={(e) => setAdvancedFilters(f => ({ ...f, sku: e.target.value }))}
                      placeholder="ex: SHP-12345"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">EAN</Label>
                    <Input
                      value={advancedFilters.ean}
                      onChange={(e) => setAdvancedFilters(f => ({ ...f, ean: e.target.value }))}
                      placeholder="ex: 7891234567890"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Marca BL</Label>
                    <BrandCombobox
                      value={advancedFilters.brandBL}
                      onChange={(id) => setAdvancedFilters(f => ({ ...f, brandBL: id }))}
                      options={brandOptions}
                      disabled={!blAvailable || brandOptions.length === 0}
                      placeholder="Marca BL"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Marca Shopee</Label>
                    <BrandCombobox
                      value={advancedFilters.shopeeBrandId}
                      onChange={(id) => setAdvancedFilters(f => ({ ...f, shopeeBrandId: id }))}
                      options={shopeeBrandOptions}
                      disabled={shopeeBrandOptions.length === 0}
                      placeholder="Marca Shopee"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Categoria ID (BL)</Label>
                    <Input
                      type="number"
                      value={advancedFilters.categoryId}
                      onChange={(e) => setAdvancedFilters(f => ({ ...f, categoryId: e.target.value }))}
                      placeholder="ex: 1234"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Estoque mínimo</Label>
                    <Input
                      type="number"
                      value={advancedFilters.stockMin}
                      onChange={(e) => setAdvancedFilters(f => ({ ...f, stockMin: e.target.value }))}
                      placeholder="0"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Preço mínimo (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={advancedFilters.priceMin}
                      onChange={(e) => setAdvancedFilters(f => ({ ...f, priceMin: e.target.value }))}
                      placeholder="0.00"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Preço máximo (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={advancedFilters.priceMax}
                      onChange={(e) => setAdvancedFilters(f => ({ ...f, priceMax: e.target.value }))}
                      placeholder="999.99"
                      className="h-8 text-xs"
                    />
                  </div>
                  <p className="md:col-span-3 text-[10px] text-muted-foreground italic">
                    Filtros avançados aplicam-se a BaseLinker. Todos os campos preenchidos somam (AND). Nome/SKU/EAN substituem a busca smart no campo principal acima.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status diagnostico — ajuda a identificar quando a query nao
              retorna nada por config faltando ou cache vazio. */}
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>BL: {blAvailable ? `inv=${inventoryId}` : "nao configurado"}</span>
            {blQueryEnabled && (
              <span>· retornou {blData?.products?.length ?? 0}{blTotal != null && ` de ${blTotal}`}</span>
            )}
            <span>· Shopee: {shopeeAccountId ? `acc=${shopeeAccountId}` : "sem conta"}</span>
            {shopeeQueryEnabled && (
              <span>· retornou {shopeeData?.products?.length ?? 0}{shopeeTotal != null && ` de ${shopeeTotal}`}</span>
            )}
            {blError && <span className="text-red-600">· erro BL: {blError.message}</span>}
            {shopeeError && <span className="text-red-600">· erro Shopee: {shopeeError.message}</span>}
          </div>

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
                      <TableHead style={{ width: 96, minWidth: 96 }}></TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="w-40">SKU</TableHead>
                      <TableHead className="w-40">Marca</TableHead>
                      <TableHead className="w-24 text-right">Custo</TableHead>
                      <TableHead className="w-20 text-right">Estoque</TableHead>
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
                        brandName={item.shopeeBrandName ?? (item.manufacturerId != null ? brandNameMap.get(item.manufacturerId) ?? null : null)}
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
