/**
 * Shopee brand picker with debounced autocomplete, scoped to a category.
 *
 * UX rules:
 *  - Category is required: if `categoryId` is null, the field is disabled
 *    with a tooltip.
 *  - "No Brand" (brand_id = 0) is always visible at the top of the dropdown.
 *  - Users can pick a Shopee-known brand OR type a free-text brand name
 *    (Shopee may reject unknown brand_ids server-side; we don't pre-block
 *    since the user may have just-registered brands that are valid for
 *    their store).
 *
 * TECH-DEBT: no component tests (frontend test infra not yet set up).
 * Backend fuzzyMatchBrands is covered in shopee-brand-search.test.ts.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Check, X } from "lucide-react";
import { trpc } from "../../lib/trpc";

export interface BrandValue {
  brandId: number; // 0 = No Brand (Shopee sentinel)
  brandName: string;
}

interface Props {
  accountId: number;
  categoryId: number | null;
  value: BrandValue;
  onChange: (value: BrandValue) => void;
}

const NO_BRAND: BrandValue = { brandId: 0, brandName: "No Brand" };

export function BrandPicker({ accountId, categoryId, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const disabled = !categoryId;
  const { data, isFetching } = trpc.shopee.searchBrands.useQuery(
    { accountId, categoryId: categoryId!, query: debounced, limit: 15 },
    { enabled: !!categoryId && open, staleTime: 60_000 },
  );

  const results = (data ?? []) as Array<{ brand_id: number; original_brand_name: string; display_brand_name?: string }>;
  // Always show "No Brand" first; dedupe if Shopee happens to include it.
  const finalList = [
    NO_BRAND,
    ...results
      .filter((r) => r.brand_id !== 0)
      .map((r) => ({ brandId: r.brand_id, brandName: r.display_brand_name ?? r.original_brand_name })),
  ];

  function applyFreeText() {
    const trimmed = query.trim();
    if (!trimmed) return;
    // brand_id = 0 = Shopee's "unknown brand" sentinel. Shopee stores the
    // free text as original_brand_name when brand_id is 0; when the user
    // types a known brand that we failed to match, Shopee will use the
    // sentinel too and the seller can correct later in their dashboard.
    onChange({ brandId: 0, brandName: trimmed });
    setQuery("");
    setDebounced("");
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className={`flex items-center gap-2 border rounded-xl px-3 py-2 bg-white transition ${
          disabled ? "border-gray-200 bg-gray-50" : open ? "border-orange-400 ring-2 ring-orange-100" : "border-gray-300 hover:border-gray-400"
        }`}
        title={disabled ? "Selecione uma categoria primeiro" : ""}
      >
        <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyFreeText(); } }}
          disabled={disabled}
          placeholder={
            disabled
              ? "Selecione uma categoria primeiro"
              : value.brandId !== 0 || value.brandName !== "No Brand"
                ? value.brandName
                : "Buscar marca (ou digite uma nova e Enter)"
          }
          className="flex-1 outline-none text-sm placeholder:text-gray-400 disabled:bg-transparent disabled:text-gray-500 disabled:cursor-not-allowed"
        />
        {isFetching && <Loader2 className="w-4 h-4 text-orange-400 animate-spin flex-shrink-0" />}
        {query && !disabled && (
          <button
            onClick={() => { setQuery(""); setDebounced(""); }}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            aria-label="Limpar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-80 overflow-y-auto z-50">
          {finalList.map((b, i) => (
            <button
              key={`${b.brandId}-${i}`}
              onClick={() => {
                onChange(b);
                setQuery("");
                setDebounced("");
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2.5 hover:bg-orange-50 transition flex items-center gap-2 border-b border-gray-100 last:border-0 ${
                b.brandId === value.brandId && b.brandName === value.brandName ? "bg-orange-50" : ""
              }`}
            >
              {b.brandId === value.brandId && b.brandName === value.brandName && (
                <Check className="w-4 h-4 text-orange-500 flex-shrink-0" />
              )}
              <span className={`text-sm flex-1 ${b.brandId === 0 ? "text-gray-500" : "text-gray-800 font-medium"}`}>
                {b.brandName}
              </span>
              {b.brandId === 0 && (
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">sem marca</span>
              )}
            </button>
          ))}
          {query.trim() && !isFetching && !results.some((r) => (r.display_brand_name ?? r.original_brand_name).toLowerCase() === query.trim().toLowerCase()) && (
            <button
              onClick={applyFreeText}
              className="w-full text-left px-4 py-2.5 bg-amber-50 hover:bg-amber-100 transition text-sm text-amber-900 border-t border-amber-200"
            >
              ➕ Usar “<b>{query.trim()}</b>” como texto livre
              <p className="text-[10px] text-amber-700 mt-0.5">
                A Shopee pode rejeitar se a marca não estiver registrada.
              </p>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
