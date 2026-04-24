/**
 * Shopee category picker with debounced fuzzy search.
 *
 * TECH-DEBT: no component-level tests (frontend test infra not yet set up —
 * see docs/roadmap or open issue). Backend logic (buildCategoryIndex +
 * fuzzyMatchCategories) is fully unit-tested in shopee-category-search.test.ts.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Check, X } from "lucide-react";
import { trpc } from "../../lib/trpc";

interface CategoryResult {
  category_id: number;
  display_category_name: string;
  breadcrumb: string;
  has_children: boolean;
}

interface Props {
  accountId: number;
  /** Currently selected category id (null when nothing selected yet). */
  value: number | null;
  /** Breadcrumb of the currently selected category, if we know it. */
  valueBreadcrumb?: string;
  /** Disabled + tooltip, e.g. "Para mudar categoria, recrie o produto na Shopee". */
  disabled?: boolean;
  disabledReason?: string;
  onChange: (categoryId: number, breadcrumb: string) => void;
}

export function CategoryPicker({ accountId, value, valueBreadcrumb, disabled, disabledReason, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Debounce: 300ms after user stops typing.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const enabled = !disabled && debounced.trim().length >= 2;
  const { data, isFetching } = trpc.shopee.searchCategories.useQuery(
    { accountId, query: debounced, limit: 15 },
    { enabled, staleTime: 60_000 },
  );

  const results = (data ?? []) as CategoryResult[];

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className={`flex items-center gap-2 border rounded-xl px-3 py-2 bg-white transition ${
          disabled ? "border-gray-200 bg-gray-50" : open ? "border-orange-400 ring-2 ring-orange-100" : "border-gray-300 hover:border-gray-400"
        }`}
        title={disabled ? disabledReason : ""}
      >
        <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={
            value
              ? (valueBreadcrumb || `Categoria ${value}`)
              : "Buscar categoria (ex: sacos de lixo)"
          }
          className="flex-1 outline-none text-sm placeholder:text-gray-400 disabled:bg-transparent disabled:text-gray-500 disabled:cursor-not-allowed"
        />
        {isFetching && <Loader2 className="w-4 h-4 text-orange-400 animate-spin flex-shrink-0" />}
        {query && !disabled && (
          <button
            onClick={() => { setQuery(""); setDebounced(""); setOpen(false); }}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            aria-label="Limpar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && !disabled && (debounced.length >= 2) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-80 overflow-y-auto z-50">
          {results.length === 0 && !isFetching && (
            <div className="px-4 py-3 text-sm text-gray-400">Nenhuma categoria encontrada.</div>
          )}
          {results.map((r) => (
            <button
              key={r.category_id}
              onClick={() => {
                onChange(r.category_id, r.breadcrumb);
                setQuery("");
                setDebounced("");
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2.5 hover:bg-orange-50 transition flex items-start gap-2 border-b border-gray-100 last:border-0 ${
                r.category_id === value ? "bg-orange-50" : ""
              }`}
            >
              {r.category_id === value && <Check className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{r.display_category_name}</p>
                <p className="text-xs text-gray-500 truncate">{r.breadcrumb}</p>
              </div>
              {r.has_children && (
                <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 flex-shrink-0">
                  tem subcategorias
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Helper line when disabled */}
      {disabled && disabledReason && (
        <p className="text-xs text-gray-400 mt-1">{disabledReason}</p>
      )}
    </div>
  );
}
