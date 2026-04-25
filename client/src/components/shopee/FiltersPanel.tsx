import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  SlidersHorizontal,
  X,
} from "lucide-react";

export type CreatedBySystem = "all" | "yes" | "no";
export type StatusFilter = "all" | "active" | "paused" | "draft";
export type VariationFilter = "all" | "yes" | "no";
export type StockFilter = "all" | "with" | "without" | "low";
export type AiFilter = "all" | "yes" | "no";
export type CreatedRangeFilter = "all" | "today" | "last7days" | "last30days";
export type OrderBy =
  | "recent"
  | "oldest"
  | "name_asc"
  | "name_desc"
  | "price_asc"
  | "price_desc";

export type FilterState = {
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

export const EMPTY_FILTERS: FilterState = {
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

export function readFiltersFromUrl(params: URLSearchParams): FilterState {
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

export function readOrderFromUrl(params: URLSearchParams): OrderBy {
  const v = params.get("orderBy");
  if (
    v === "recent" ||
    v === "oldest" ||
    v === "name_asc" ||
    v === "name_desc" ||
    v === "price_asc" ||
    v === "price_desc"
  )
    return v;
  return "recent";
}

export function countActiveFilters(f: FilterState): number {
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

export function buildQueryInput(f: FilterState, orderBy: OrderBy) {
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

interface FiltersPanelProps {
  filters: FilterState;
  onApply: (next: FilterState) => void;
  onClear: () => void;
  /** Optional class to control the trigger button styling (e.g. width). */
  triggerClassName?: string;
}

export function FiltersPanel({
  filters,
  onApply,
  onClear,
  triggerClassName,
}: FiltersPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [draft, setDraft] = useState<FilterState>(filters);

  // Reset draft to current applied filters whenever the panel opens, so edits
  // start from the current state rather than stale draft values.
  useEffect(() => {
    if (isExpanded) setDraft(filters);
  }, [isExpanded, filters]);

  const activeCount = countActiveFilters(filters);
  const draftCount = countActiveFilters(draft);

  const apply = () => {
    onApply(draft);
    setIsExpanded(false);
  };

  const clearDraft = () => setDraft(EMPTY_FILTERS);

  const clearAll = () => {
    setDraft(EMPTY_FILTERS);
    onClear();
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsExpanded((v) => !v)}
          className={`gap-2 ${triggerClassName ?? ""}`}
          aria-expanded={isExpanded}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtros{activeCount > 0 ? ` (${activeCount})` : ""}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          />
        </Button>
        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="gap-1"
          >
            <X className="h-4 w-4" />
            Limpar filtros
          </Button>
        )}
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isExpanded ? "grid-rows-[1fr] mt-3" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="rounded-lg border bg-white shadow-sm p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {draftCount} filtro(s) selecionado(s)
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearDraft}
                className="gap-1 h-7 text-xs"
              >
                <X className="h-3 w-3" />
                Limpar
              </Button>
            </div>

            <Separator className="my-3" />

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Origem</h3>
                <div>
                  <Label className="text-xs">Feitos pelo sistema</Label>
                  <Select
                    value={draft.createdBySystem}
                    onValueChange={(v) =>
                      setDraft({ ...draft, createdBySystem: v as CreatedBySystem })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Sim — feitos pelo sistema</SelectItem>
                      <SelectItem value="no">Não — importados da Shopee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Status & Variação</h3>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select
                    value={draft.status}
                    onValueChange={(v) =>
                      setDraft({ ...draft, status: v as StatusFilter })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
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
                    value={draft.hasVariation}
                    onValueChange={(v) =>
                      setDraft({ ...draft, hasVariation: v as VariationFilter })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Com variação</SelectItem>
                      <SelectItem value="no">Sem variação</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Preço & Estoque</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Preço mín. (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.priceMin}
                      onChange={(e) => setDraft({ ...draft, priceMin: e.target.value })}
                      placeholder="0"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Preço máx. (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={draft.priceMax}
                      onChange={(e) => setDraft({ ...draft, priceMax: e.target.value })}
                      placeholder="∞"
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Estoque</Label>
                  <Select
                    value={draft.stockFilter}
                    onValueChange={(v) =>
                      setDraft({ ...draft, stockFilter: v as StockFilter })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="with">Com estoque (≥ 1)</SelectItem>
                      <SelectItem value="without">Sem estoque</SelectItem>
                      <SelectItem value="low">Estoque baixo (1–4)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Classificação</h3>
                <div>
                  <Label className="text-xs">Categoria (ID Shopee)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={draft.categoryId}
                    onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                    placeholder="ex: 100018"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Marca</Label>
                  <Input
                    value={draft.brand}
                    onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                    placeholder="ex: Nike"
                    className="mt-1"
                  />
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Conteúdo IA</h3>
                <div>
                  <Label className="text-xs">Título por IA</Label>
                  <Select
                    value={draft.titleAi}
                    onValueChange={(v) => setDraft({ ...draft, titleAi: v as AiFilter })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
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
                    value={draft.descriptionAi}
                    onValueChange={(v) =>
                      setDraft({ ...draft, descriptionAi: v as AiFilter })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="yes">Gerada por IA</SelectItem>
                      <SelectItem value="no">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Tempo</h3>
                <div>
                  <Label className="text-xs">Data de criação</Label>
                  <Select
                    value={draft.createdRange}
                    onValueChange={(v) =>
                      setDraft({ ...draft, createdRange: v as CreatedRangeFilter })
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Qualquer data</SelectItem>
                      <SelectItem value="today">Hoje</SelectItem>
                      <SelectItem value="last7days">Últimos 7 dias</SelectItem>
                      <SelectItem value="last30days">Últimos 30 dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="space-y-2 md:col-span-2 lg:col-span-3">
                <h3 className="text-sm font-semibold">Busca</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">SKU</Label>
                    <Input
                      value={draft.sku}
                      onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                      placeholder="busca por SKU (parcial)"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Nome do produto</Label>
                    <Input
                      value={draft.search}
                      onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                      placeholder="busca por nome (parcial)"
                      className="mt-1"
                    />
                  </div>
                </div>
              </section>
            </div>

            <Separator className="my-3" />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsExpanded(false)}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={apply}>
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
