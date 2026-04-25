import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useState, useMemo, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Package,
  Video,
  Image,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Star,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

type SyncStatus = "synced" | "outdated" | "not_found" | "checking" | "unknown";

type CreatedBySystem = "all" | "yes" | "no";
type StatusFilter = "all" | "active" | "paused" | "draft";
type VariationFilter = "all" | "yes" | "no";
type StockFilter = "all" | "with" | "without" | "low";
type AiFilter = "all" | "yes" | "no";
type CreatedRangeFilter = "all" | "today" | "last7days" | "last30days";
type OrderBy = "recent" | "oldest" | "name_asc" | "name_desc" | "price_asc" | "price_desc";

type FilterState = {
  createdBySystem: CreatedBySystem;
  status: StatusFilter;
  hasVariation: VariationFilter;
  priceMin: string;
  priceMax: string;
  stockFilter: StockFilter;
  categoryId: string;
  brand: string;
  titleAi: AiFilter;
  descriptionAi: AiFilter;
  createdRange: CreatedRangeFilter;
  sku: string;
  search: string;
};

const EMPTY_FILTERS: FilterState = {
  createdBySystem: "all",
  status: "all",
  hasVariation: "all",
  priceMin: "",
  priceMax: "",
  stockFilter: "all",
  categoryId: "",
  brand: "",
  titleAi: "all",
  descriptionAi: "all",
  createdRange: "all",
  sku: "",
  search: "",
};

function readFiltersFromUrl(params: URLSearchParams): FilterState {
  const get = (k: string) => params.get(k) ?? "";
  return {
    createdBySystem: (get("createdBySystem") || "all") as CreatedBySystem,
    status: (get("status") || "all") as StatusFilter,
    hasVariation: (get("hasVariation") || "all") as VariationFilter,
    priceMin: get("priceMin"),
    priceMax: get("priceMax"),
    stockFilter: (get("stockFilter") || "all") as StockFilter,
    categoryId: get("categoryId"),
    brand: get("brand"),
    titleAi: (get("titleAi") || "all") as AiFilter,
    descriptionAi: (get("descriptionAi") || "all") as AiFilter,
    createdRange: (get("createdRange") || "all") as CreatedRangeFilter,
    sku: get("sku"),
    search: get("search"),
  };
}

function readOrderFromUrl(params: URLSearchParams): OrderBy {
  const v = params.get("orderBy");
  if (v === "recent" || v === "oldest" || v === "name_asc" || v === "name_desc" || v === "price_asc" || v === "price_desc") return v;
  return "recent";
}

function countActiveFilters(f: FilterState): number {
  let n = 0;
  if (f.createdBySystem !== "all") n++;
  if (f.status !== "all") n++;
  if (f.hasVariation !== "all") n++;
  if (f.priceMin) n++;
  if (f.priceMax) n++;
  if (f.stockFilter !== "all") n++;
  if (f.categoryId) n++;
  if (f.brand) n++;
  if (f.titleAi !== "all") n++;
  if (f.descriptionAi !== "all") n++;
  if (f.createdRange !== "all") n++;
  if (f.sku) n++;
  if (f.search) n++;
  return n;
}

function buildQueryInput(f: FilterState, orderBy: OrderBy) {
  const out: Record<string, unknown> = {};
  if (f.createdBySystem !== "all") out.createdBySystem = f.createdBySystem === "yes";
  if (f.status !== "all") out.status = f.status;
  if (f.hasVariation !== "all") out.hasVariation = f.hasVariation === "yes";
  const min = parseFloat(f.priceMin);
  const max = parseFloat(f.priceMax);
  if (!Number.isNaN(min) && f.priceMin !== "") out.priceMin = min;
  if (!Number.isNaN(max) && f.priceMax !== "") out.priceMax = max;
  if (f.stockFilter !== "all") out.stockFilter = f.stockFilter;
  const catId = parseInt(f.categoryId, 10);
  if (!Number.isNaN(catId) && catId > 0) out.categoryId = catId;
  if (f.brand) out.brand = f.brand;
  if (f.titleAi !== "all") out.titleAiGenerated = f.titleAi === "yes";
  if (f.descriptionAi !== "all") out.descriptionAiGenerated = f.descriptionAi === "yes";
  if (f.createdRange !== "all") out.createdRange = f.createdRange;
  if (f.sku) out.sku = f.sku;
  if (f.search) out.search = f.search;
  out.orderBy = orderBy;
  return out;
}

function SyncBadge({ status, changes }: { status: SyncStatus; changes?: string[] }) {
  if (status === "checking")
    return (
      <Badge variant="outline" className="text-xs gap-1 text-muted-foreground border-muted-foreground/30">
        <Loader2 className="h-3 w-3 animate-spin" />
        Verificando
      </Badge>
    );
  if (status === "synced")
    return (
      <Badge variant="outline" className="text-xs gap-1 text-green-700 border-green-300 bg-green-50">
        <CheckCircle2 className="h-3 w-3" />
        Sincronizado
      </Badge>
    );
  if (status === "outdated")
    return (
      <Badge
        variant="outline"
        className="text-xs gap-1 text-yellow-700 border-yellow-300 bg-yellow-50"
        title={changes?.length ? `Diferente: ${changes.join(", ")}` : undefined}
      >
        <AlertTriangle className="h-3 w-3" />
        Desatualizado{changes?.length ? ` (${changes.join(", ")})` : ""}
      </Badge>
    );
  if (status === "not_found")
    return (
      <Badge variant="outline" className="text-xs gap-1 text-red-700 border-red-300 bg-red-50">
        <WifiOff className="h-3 w-3" />
        Não sincronizado
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      —
    </Badge>
  );
}

function AiBadges({ titleAi, descAi }: { titleAi: boolean; descAi: boolean }) {
  if (!titleAi && !descAi) return null;
  if (titleAi && descAi) {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-violet-700 border-violet-300 bg-violet-50">
        <Sparkles className="h-3 w-3" />
        IA Título+Descrição
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs gap-1 text-violet-700 border-violet-300 bg-violet-50">
      <Sparkles className="h-3 w-3" />
      IA {titleAi ? "Título" : "Descrição"}
    </Badge>
  );
}

function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ShopeeProducts() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const initialParams = useMemo(() => new URLSearchParams(search), [search]);
  const initialAccountId = initialParams.get("accountId");

  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    initialAccountId ? parseInt(initialAccountId) : null
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [syncingProductId, setSyncingProductId] = useState<number | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const [filters, setFilters] = useState<FilterState>(() => readFiltersFromUrl(initialParams));
  const [orderBy, setOrderBy] = useState<OrderBy>(() => readOrderFromUrl(initialParams));
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Draft state lets the user stage filter edits inside the sheet without
  // triggering a refetch on every keystroke. Apply commits to the live state.
  const [draftFilters, setDraftFilters] = useState<FilterState>(filters);

  // Push filter state into URL query params so links are shareable + reload-safe.
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedAccountId != null) params.set("accountId", String(selectedAccountId));
    const writeIfSet = (k: keyof FilterState) => {
      const v = filters[k];
      if (v && v !== "all") params.set(k as string, String(v));
    };
    (Object.keys(filters) as Array<keyof FilterState>).forEach(writeIfSet);
    if (orderBy !== "recent") params.set("orderBy", orderBy);
    const qs = params.toString();
    const next = qs ? `/shopee-products?${qs}` : "/shopee-products";
    if (typeof window !== "undefined" && window.location.pathname + window.location.search !== next) {
      window.history.replaceState({}, "", next);
    }
  }, [filters, orderBy, selectedAccountId]);

  const { data: accounts } = trpc.shopee.getAccounts.useQuery();
  const { data: productsData, isLoading, refetch: refetchProducts } = trpc.shopee.getProducts.useQuery(
    {
      accountId: selectedAccountId!,
      offset: page * pageSize,
      limit: pageSize,
      ...buildQueryInput(filters, orderBy),
    },
    { enabled: !!selectedAccountId }
  );
  const { data: qualityStats } = trpc.shopee.getQualityStats.useQuery(
    { accountId: selectedAccountId! },
    { enabled: !!selectedAccountId }
  );

  const currentItemIds = useMemo(
    () => productsData?.products.map((p: any) => Number(p.itemId)) ?? [],
    [productsData]
  );

  const {
    data: syncStatusData,
    isLoading: isCheckingSync,
    isFetching: isFetchingSync,
    refetch: recheckSync,
  } = trpc.shopee.checkSyncStatus.useQuery(
    { accountId: selectedAccountId!, itemIds: currentItemIds },
    { enabled: !!selectedAccountId && currentItemIds.length > 0, staleTime: 30_000 }
  );

  const syncStatusByItemId = useMemo(() => {
    const map = new Map<number, { status: SyncStatus; changes?: string[] }>();
    if (syncStatusData) {
      for (const s of syncStatusData) map.set(s.itemId, s);
    }
    return map;
  }, [syncStatusData]);

  const syncSingleMutation = trpc.shopee.syncSingleProduct.useMutation();
  const syncAllMutation = trpc.shopee.syncProducts.useMutation();

  // Auto-select first account
  useMemo(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      const active = accounts.find((a: any) => a.isActive);
      if (active) setSelectedAccountId(active.id);
    }
  }, [accounts, selectedAccountId]);

  const totalPages = productsData ? Math.ceil(productsData.total / pageSize) : 0;
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  const syncValues = useMemo(() => Array.from(syncStatusByItemId.values()), [syncStatusByItemId]);

  const getScoreBadge = (filled: number, total: number) => {
    if (total === 0) return { label: "Sem dados", color: "bg-gray-100 text-gray-700" };
    const pct = (filled / total) * 100;
    if (pct >= 90) return { label: "Qualificado", color: "bg-green-100 text-green-700" };
    if (pct >= 50) return { label: "Parcial", color: "bg-yellow-100 text-yellow-700" };
    return { label: "Para Melhorar", color: "bg-red-100 text-red-700" };
  };

  const handleSyncSingle = async (productId: number, productName: string) => {
    setSyncingProductId(productId);
    try {
      await syncSingleMutation.mutateAsync({ productId });
      toast.success(`✅ "${productName}" sincronizado com sucesso!`);
      refetchProducts();
      recheckSync();
    } catch (err: any) {
      toast.error(`❌ Erro ao sincronizar: ${err.message}`);
    } finally {
      setSyncingProductId(null);
    }
  };

  const handleSyncAll = async () => {
    if (!selectedAccountId) return;
    setSyncingAll(true);
    try {
      const result = await syncAllMutation.mutateAsync({ accountId: selectedAccountId });
      toast.success(
        `✅ Sincronização concluída — ${result.added} adicionados · ${result.updated} atualizados · ${result.removed} removidos`
      );
      refetchProducts();
      recheckSync();
    } catch (err: any) {
      toast.error(`❌ Erro na sincronização: ${err.message}`);
    } finally {
      setSyncingAll(false);
    }
  };

  const applyFilters = () => {
    setFilters(draftFilters);
    setPage(0);
    setFiltersOpen(false);
  };

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(0);
  };

  const openFilters = () => {
    setDraftFilters(filters);
    setFiltersOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produtos Shopee</h1>
          <p className="text-muted-foreground mt-1">
            Visualize e gerencie os produtos sincronizados das suas lojas Shopee.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {accounts && accounts.length > 0 && (
            <Select
              value={selectedAccountId?.toString() || ""}
              onValueChange={(v) => { setSelectedAccountId(parseInt(v)); setPage(0); }}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Selecione uma loja" />
              </SelectTrigger>
              <SelectContent>
                {accounts.filter((a: any) => a.isActive).map((a: any) => (
                  <SelectItem key={a.id} value={a.id.toString()}>
                    {a.shopName || `Loja ${a.shopId}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Sheet open={filtersOpen} onOpenChange={(o) => (o ? openFilters() : setFiltersOpen(false))}>
            <SheetTrigger asChild>
              <Button variant="outline" className="gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Filtros</SheetTitle>
              </SheetHeader>

              <div className="mt-6 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {countActiveFilters(draftFilters)} filtro(s) ativo(s)
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraftFilters(EMPTY_FILTERS)}
                  className="gap-1 h-7 text-xs"
                >
                  <X className="h-3 w-3" />
                  Limpar
                </Button>
              </div>

              <Separator className="my-4" />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Origem</h3>
                <div>
                  <Label className="text-xs">Feitos pelo sistema</Label>
                  <Select
                    value={draftFilters.createdBySystem}
                    onValueChange={(v) => setDraftFilters({ ...draftFilters, createdBySystem: v as CreatedBySystem })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Sim — feitos pelo sistema</SelectItem>
                      <SelectItem value="no">Não — importados da Shopee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <Separator className="my-4" />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Status & Variação</h3>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select
                    value={draftFilters.status}
                    onValueChange={(v) => setDraftFilters({ ...draftFilters, status: v as StatusFilter })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="paused">Pausado</SelectItem>
                      <SelectItem value="draft">Rascunho</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Variação</Label>
                  <Select
                    value={draftFilters.hasVariation}
                    onValueChange={(v) => setDraftFilters({ ...draftFilters, hasVariation: v as VariationFilter })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Com variação</SelectItem>
                      <SelectItem value="no">Sem variação</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <Separator className="my-4" />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Preço & Estoque</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Preço mín. (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draftFilters.priceMin}
                      onChange={(e) => setDraftFilters({ ...draftFilters, priceMin: e.target.value })}
                      placeholder="0"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Preço máx. (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draftFilters.priceMax}
                      onChange={(e) => setDraftFilters({ ...draftFilters, priceMax: e.target.value })}
                      placeholder="∞"
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Estoque</Label>
                  <Select
                    value={draftFilters.stockFilter}
                    onValueChange={(v) => setDraftFilters({ ...draftFilters, stockFilter: v as StockFilter })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="with">Com estoque (≥ 1)</SelectItem>
                      <SelectItem value="without">Sem estoque</SelectItem>
                      <SelectItem value="low">Estoque baixo (1–4)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <Separator className="my-4" />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Classificação</h3>
                <div>
                  <Label className="text-xs">Categoria (ID Shopee)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={draftFilters.categoryId}
                    onChange={(e) => setDraftFilters({ ...draftFilters, categoryId: e.target.value })}
                    placeholder="ex: 100018"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Marca</Label>
                  <Input
                    value={draftFilters.brand}
                    onChange={(e) => setDraftFilters({ ...draftFilters, brand: e.target.value })}
                    placeholder="ex: Nike"
                    className="mt-1"
                  />
                </div>
              </section>

              <Separator className="my-4" />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Conteúdo IA</h3>
                <div>
                  <Label className="text-xs">Título por IA</Label>
                  <Select
                    value={draftFilters.titleAi}
                    onValueChange={(v) => setDraftFilters({ ...draftFilters, titleAi: v as AiFilter })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Gerado por IA</SelectItem>
                      <SelectItem value="no">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Descrição por IA</Label>
                  <Select
                    value={draftFilters.descriptionAi}
                    onValueChange={(v) => setDraftFilters({ ...draftFilters, descriptionAi: v as AiFilter })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Gerada por IA</SelectItem>
                      <SelectItem value="no">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <Separator className="my-4" />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Tempo</h3>
                <div>
                  <Label className="text-xs">Data de criação</Label>
                  <Select
                    value={draftFilters.createdRange}
                    onValueChange={(v) => setDraftFilters({ ...draftFilters, createdRange: v as CreatedRangeFilter })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Qualquer data</SelectItem>
                      <SelectItem value="today">Hoje</SelectItem>
                      <SelectItem value="last7days">Últimos 7 dias</SelectItem>
                      <SelectItem value="last30days">Últimos 30 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <Separator className="my-4" />

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Busca</h3>
                <div>
                  <Label className="text-xs">SKU</Label>
                  <Input
                    value={draftFilters.sku}
                    onChange={(e) => setDraftFilters({ ...draftFilters, sku: e.target.value })}
                    placeholder="busca por SKU (parcial)"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Nome do produto</Label>
                  <Input
                    value={draftFilters.search}
                    onChange={(e) => setDraftFilters({ ...draftFilters, search: e.target.value })}
                    placeholder="busca por nome (parcial)"
                    className="mt-1"
                  />
                </div>
              </section>

              <Separator className="my-4" />

              <div className="flex gap-2 sticky bottom-0 bg-background pt-2 pb-1">
                <Button variant="outline" onClick={() => setFiltersOpen(false)} className="flex-1">
                  Cancelar
                </Button>
                <Button onClick={applyFilters} className="flex-1">
                  Aplicar
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          <Select value={orderBy} onValueChange={(v) => { setOrderBy(v as OrderBy); setPage(0); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Mais recentes</SelectItem>
              <SelectItem value="oldest">Mais antigos</SelectItem>
              <SelectItem value="name_asc">Nome A→Z</SelectItem>
              <SelectItem value="name_desc">Nome Z→A</SelectItem>
              <SelectItem value="price_asc">Preço menor</SelectItem>
              <SelectItem value="price_desc">Preço maior</SelectItem>
            </SelectContent>
          </Select>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
              <X className="h-4 w-4" />
              Limpar filtros
            </Button>
          )}

          {selectedAccountId && (
            <Button
              onClick={handleSyncAll}
              disabled={syncingAll}
              className="gap-2"
            >
              {syncingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncingAll ? "Sincronizando..." : "🔄 Sincronizar Todos"}
            </Button>
          )}
        </div>
      </div>

      {/* Quality Summary */}
      {qualityStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="bg-blue-50/50 border-blue-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-blue-600 font-medium">Total</p>
              <p className="text-xl font-bold text-blue-800">{qualityStats.total}</p>
            </CardContent>
          </Card>
          <Card className="bg-purple-50/50 border-purple-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-purple-600 font-medium">Com Vídeo</p>
              <p className="text-xl font-bold text-purple-800">{qualityStats.withVideoPercent}%</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50/50 border-green-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-green-600 font-medium">5+ Fotos</p>
              <p className="text-xl font-bold text-green-800">{qualityStats.with5PlusImagesPercent}%</p>
            </CardContent>
          </Card>
          <Card className="bg-amber-50/50 border-amber-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-amber-600 font-medium">Atributos</p>
              <p className="text-xl font-bold text-amber-800">{qualityStats.avgAttrsFilled}%</p>
            </CardContent>
          </Card>
          <Card className="bg-teal-50/50 border-teal-200">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-teal-600 font-medium">Com Descrição</p>
              <p className="text-xl font-bold text-teal-800">{qualityStats.withDescriptionPercent}%</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sync status bar */}
      {productsData && productsData.products.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2 text-sm">
          <div className="flex items-center gap-3">
            {isCheckingSync || isFetchingSync ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Verificando status de sincronização...</span>
              </>
            ) : syncStatusData ? (
              <>
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {syncValues.filter(s => s.status === "synced").length} sincronizados
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="flex items-center gap-1 text-yellow-700">
                  <AlertTriangle className="h-4 w-4" />
                  {syncValues.filter(s => s.status === "outdated").length} desatualizados
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="flex items-center gap-1 text-red-700">
                  <WifiOff className="h-4 w-4" />
                  {syncValues.filter(s => s.status === "not_found").length} não encontrados
                </span>
              </>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" className="gap-1 h-7" onClick={() => recheckSync()}>
            <RefreshCw className="h-3 w-3" />
            Reverificar
          </Button>
        </div>
      )}

      {/* Products List */}
      {!selectedAccountId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Selecione uma loja para ver os produtos</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !productsData || productsData.products.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {activeFilterCount > 0 ? "Nenhum produto bate com os filtros" : "Nenhum produto sincronizado"}
            </h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              {activeFilterCount > 0
                ? "Tente afrouxar ou limpar os filtros."
                : "Clique em \"Sincronizar\" na página de Contas Shopee para importar os produtos desta loja."}
            </p>
            {activeFilterCount > 0 ? (
              <Button variant="outline" onClick={clearFilters}>Limpar filtros</Button>
            ) : (
              <Button variant="outline" asChild>
                <a href="/shopee-accounts">Ir para Contas Shopee</a>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {productsData.products.map((product: any) => {
              const score = getScoreBadge(product.attributesFilled || 0, product.attributesTotal || 0);
              const imgCount = Array.isArray(product.images) ? product.images.length : 0;
              const itemId = Number(product.itemId);
              const syncInfo = syncStatusByItemId.get(itemId);
              const syncStatus: SyncStatus = isCheckingSync || isFetchingSync
                ? "checking"
                : syncInfo?.status ?? "unknown";
              const isSyncingThis = syncingProductId === product.id;
              const titleAi = !!product.titleAiGenerated;
              const descAi = !!product.descriptionAiGenerated;
              const createdBySys = !!product.createdBySystem;

              return (
                <Card
                  key={product.id}
                  onClick={() => setLocation(`/shopee-criador?productId=${product.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLocation(`/shopee-criador?productId=${product.id}`);
                    }
                  }}
                  className={`cursor-pointer hover:shadow-md hover:border-orange-300 transition-all ${
                    syncStatus === "outdated" ? "border-yellow-200" :
                    syncStatus === "not_found" ? "border-red-200" : ""
                  }`}
                >
                  <CardContent className="py-3">
                    <div className="flex items-center gap-4">
                      {/* Thumbnail */}
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.itemName}
                          className="h-16 w-16 rounded-lg object-cover border shrink-0"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Package className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate text-sm">{product.itemName}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-sm font-semibold text-green-700">R$ {product.price}</span>
                          <span className="text-xs text-muted-foreground">Est: {product.stock}</span>
                          <span className="text-xs text-muted-foreground">Vendas: {product.sold}</span>
                          {product.rating && parseFloat(product.rating) > 0 && (
                            <span className="text-xs flex items-center gap-0.5 text-amber-600">
                              <Star className="h-3 w-3 fill-current" />
                              {parseFloat(product.rating).toFixed(1)}
                            </span>
                          )}
                          {product.itemSku && (
                            <span className="text-xs text-muted-foreground">SKU: {product.itemSku}</span>
                          )}
                        </div>
                        {/* Last sync + status + IA + origin */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <SyncBadge status={syncStatus} changes={syncInfo?.changes} />
                          <AiBadges titleAi={titleAi} descAi={descAi} />
                          {createdBySys && (
                            <Badge variant="outline" className="text-xs gap-1 text-orange-700 border-orange-300 bg-orange-50">
                              Feito pelo sistema
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            Sync: {formatDate(product.lastSyncAt)}
                          </span>
                        </div>
                      </div>

                      {/* Quality Indicators */}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                        <div className="flex items-center gap-1" title={`${imgCount} imagens`}>
                          <Image className={`h-4 w-4 ${imgCount >= 5 ? "text-green-500" : imgCount >= 3 ? "text-yellow-500" : "text-red-500"}`} />
                          <span className="text-xs">{imgCount}</span>
                        </div>
                        <div title={product.hasVideo ? "Tem vídeo" : "Sem vídeo"}>
                          <Video className={`h-4 w-4 ${product.hasVideo ? "text-purple-500" : "text-gray-300"}`} />
                        </div>
                        <div className="text-center min-w-[60px]">
                          <div className="text-xs font-medium">
                            {product.attributesFilled || 0}/{product.attributesTotal || 0}
                          </div>
                          <Progress
                            value={product.attributesTotal > 0
                              ? ((product.attributesFilled || 0) / product.attributesTotal) * 100
                              : 0}
                            className="h-1.5 w-14"
                          />
                        </div>
                        <Badge variant="secondary" className={`text-xs ${score.color}`}>
                          {score.label}
                        </Badge>

                        {/* Individual sync button — only for outdated/not_found */}
                        {(syncStatus === "outdated" || syncStatus === "not_found") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            disabled={isSyncingThis}
                            onClick={(e) => {
                              e.stopPropagation(); // don't trigger the Card's navigate-to-wizard
                              handleSyncSingle(product.id, product.itemName);
                            }}
                          >
                            {isSyncingThis
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <RefreshCw className="h-3 w-3" />}
                            {isSyncingThis ? "..." : "🔄 Sincronizar"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, productsData.total)} de {productsData.total}
              </span>
              <Select
                value={pageSize.toString()}
                onValueChange={(v) => { setPageSize(parseInt(v)); setPage(0); }}
              >
                <SelectTrigger className="w-[80px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">{page + 1} / {totalPages || 1}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
