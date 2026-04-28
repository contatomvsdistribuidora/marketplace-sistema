import { useState, useEffect, KeyboardEvent } from "react";
import { trpc } from "@/lib/trpc";
import type { Listing, ListingItem } from "./types";
import { VARIATION_TYPES, itemKey } from "./types";
import { useResolvedProducts } from "./useResolvedProducts";
import { Hash, Ruler, Palette, Layers, PenLine, Loader2, Plus, X, Copy } from "lucide-react";

const TYPE_ICONS: Record<string, any> = {
  quantidade: Hash,
  tamanho: Ruler,
  cor: Palette,
  material: Layers,
  personalizado: PenLine,
};

const MAX_OPTION_LEN = 64;

interface StepV2Props {
  listing: Listing;
  items: ListingItem[];
  onChange: () => void;
}

type VariationCell = {
  itemId: number;
  optionIndex: number;
  price: string | null;
  stock: string | null;
  sku: string | null;
  ean: string | null;
};

type CellField = "price" | "stock" | "sku" | "ean";

function parseOptions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

function parseCells(raw: string | null | undefined): VariationCell[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as VariationCell[];
    return [];
  } catch {
    return [];
  }
}

function cellKey(itemId: number, optionIndex: number): string {
  return `${itemId}:${optionIndex}`;
}

function buildCellMap(cells: VariationCell[]): Map<string, VariationCell> {
  const m = new Map<string, VariationCell>();
  for (const c of cells) m.set(cellKey(c.itemId, c.optionIndex), c);
  return m;
}

function emptyCell(itemId: number, optionIndex: number): VariationCell {
  return { itemId, optionIndex, price: null, stock: null, sku: null, ean: null };
}

export function StepV2({ listing, items, onChange }: StepV2Props) {
  const [selectedType, setSelectedType] = useState<string | null>(listing.variation2Type ?? null);
  const [options, setOptions] = useState<string[]>(parseOptions(listing.variation2OptionsJson));
  const [cells, setCells] = useState<VariationCell[]>(parseCells(listing.variation2CellsJson));
  const [newOption, setNewOption] = useState("");

  const [bulkValues, setBulkValues] = useState<{ price: string; stock: string; sku: string; ean: string }>({
    price: "",
    stock: "",
    sku: "",
    ean: "",
  });

  const updateMutation = trpc.multiProduct.updateMultiProductListing.useMutation();
  const { productMap, isResolving } = useResolvedProducts(listing, items);

  useEffect(() => {
    setSelectedType(listing.variation2Type ?? null);
    setOptions(parseOptions(listing.variation2OptionsJson));
    setCells(parseCells(listing.variation2CellsJson));
  }, [listing.id, listing.variation2Type, listing.variation2OptionsJson, listing.variation2CellsJson]);

  const cellMap = buildCellMap(cells);

  async function handleSelectType(type: string) {
    if (selectedType === type) return;
    setSelectedType(type);
    await updateMutation.mutateAsync({ id: listing.id, variation2Type: type });
    onChange();
  }

  async function persistOptions(next: string[]) {
    setOptions(next);
    setCells([]);
    await updateMutation.mutateAsync({
      id: listing.id,
      variation2OptionsJson: JSON.stringify(next),
      variation2CellsJson: JSON.stringify([]),
    });
    onChange();
  }

  async function handleAddOption() {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_OPTION_LEN) return;
    const exists = options.some((o) => o.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setNewOption("");
      return;
    }
    const next = [...options, trimmed];
    setNewOption("");
    await persistOptions(next);
  }

  async function handleRemoveOption(index: number) {
    const next = options.filter((_, i) => i !== index);
    await persistOptions(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddOption();
    }
  }

  async function persistCells(next: VariationCell[]) {
    setCells(next);
    await updateMutation.mutateAsync({
      id: listing.id,
      variation2CellsJson: JSON.stringify(next),
    });
    onChange();
  }

  function handleCellChange(itemId: number, optionIndex: number, field: CellField, value: string) {
    const key = cellKey(itemId, optionIndex);
    const existing = cellMap.get(key) ?? emptyCell(itemId, optionIndex);
    const updated: VariationCell = { ...existing, [field]: value === "" ? null : value };
    const next = cells.filter((c) => cellKey(c.itemId, c.optionIndex) !== key);
    next.push(updated);
    setCells(next);
  }

  function handleCellBlur() {
    persistCells(cells);
  }

  async function handleApplyAll() {
    const next: VariationCell[] = [];
    for (const it of items) {
      for (let optIdx = 0; optIdx < options.length; optIdx++) {
        const existing = cellMap.get(cellKey(it.sourceId, optIdx)) ?? emptyCell(it.sourceId, optIdx);
        next.push({
          ...existing,
          price: bulkValues.price.trim() !== "" ? bulkValues.price.trim() : existing.price,
          stock: bulkValues.stock.trim() !== "" ? bulkValues.stock.trim() : existing.stock,
          sku: bulkValues.sku.trim() !== "" ? bulkValues.sku.trim() : existing.sku,
          ean: bulkValues.ean.trim() !== "" ? bulkValues.ean.trim() : existing.ean,
        });
      }
    }
    await persistCells(next);
  }

  const selectedTypeLabel = VARIATION_TYPES.find((v) => v.key === selectedType)?.label;
  const showMatrix = selectedType && options.length > 0 && items.length > 0;

  return (
    <div className="space-y-6">
      {/* ZONA 1 — Tipo */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Tipo da Variação 2</h3>
          <p className="text-sm text-gray-500 mt-1">
            Escolha como os produtos do anúncio combinado vão ser subdivididos. Ex: por quantidade (50un, 100un), tamanho (P, M, G), etc.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {VARIATION_TYPES.map((vt) => {
            const Icon = TYPE_ICONS[vt.key] ?? Hash;
            const isSelected = selectedType === vt.key;
            const isLoading = updateMutation.isPending && selectedType === vt.key;
            return (
              <button
                key={vt.key}
                onClick={() => handleSelectType(vt.key)}
                disabled={updateMutation.isPending}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition ${
                  isSelected ? "border-orange-500 bg-orange-50 text-orange-700" : "border-gray-200 hover:border-gray-300 text-gray-700"
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Icon className="w-6 h-6" />}
                <span className="font-semibold text-sm">{vt.label}</span>
                <span className="text-xs text-gray-400 text-center">{vt.examples}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ZONA 2 — Opções */}
      {selectedType && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Opções de {selectedTypeLabel}</h3>
            <p className="text-sm text-gray-500 mt-1">
              Adicione as opções que cada produto vai ter. Ex: "50un", "100un", "200un". Mínimo 1 opção.
            </p>
            <p className="text-xs text-yellow-700 mt-2">
              ⚠️ Adicionar ou remover opções vai resetar a matriz de preços abaixo.
            </p>
          </div>

          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newOption}
              onChange={(e) => setNewOption(e.target.value.slice(0, MAX_OPTION_LEN))}
              onKeyDown={handleKeyDown}
              placeholder="Ex: 50un"
              maxLength={MAX_OPTION_LEN}
              disabled={updateMutation.isPending}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-50"
            />
            <button
              onClick={handleAddOption}
              disabled={!newOption.trim() || updateMutation.isPending}
              className="flex items-center gap-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Plus className="w-4 h-4" />
              Adicionar
            </button>
          </div>

          {options.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">⚠️ Adicione pelo menos uma opção para continuar.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {options.map((opt, idx) => (
                <div key={`${opt}-${idx}`} className="inline-flex items-center gap-2 px-3 py-1.5 bg-orange-100 border border-orange-300 text-orange-800 rounded-full text-sm font-medium">
                  <span>{opt}</span>
                  <button
                    onClick={() => handleRemoveOption(idx)}
                    disabled={updateMutation.isPending}
                    className="hover:bg-orange-200 rounded-full p-0.5 transition disabled:opacity-50"
                    aria-label={`Remover ${opt}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ZONA 3 — Matriz N×M */}
      {showMatrix && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Matriz de Preços</h3>
            <p className="text-sm text-gray-500 mt-1">
              Defina preço, estoque, SKU e EAN para cada combinação produto × {selectedTypeLabel?.toLowerCase()}.
            </p>
          </div>

          {/* Aplicar a todos */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <Copy className="w-4 h-4 text-blue-700" />
              <span className="text-sm font-semibold text-blue-900">Aplicar a todos</span>
              <span className="text-xs text-blue-700">(preenche todas as células — campos vazios não sobrescrevem)</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
              <input
                type="text"
                placeholder="Preço (R$)"
                value={bulkValues.price}
                onChange={(e) => setBulkValues({ ...bulkValues, price: e.target.value })}
                className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="text"
                placeholder="Estoque"
                value={bulkValues.stock}
                onChange={(e) => setBulkValues({ ...bulkValues, stock: e.target.value })}
                className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="text"
                placeholder="SKU"
                value={bulkValues.sku}
                onChange={(e) => setBulkValues({ ...bulkValues, sku: e.target.value })}
                className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="text"
                placeholder="EAN"
                value={bulkValues.ean}
                onChange={(e) => setBulkValues({ ...bulkValues, ean: e.target.value })}
                className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={handleApplyAll}
                disabled={updateMutation.isPending}
                className="flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded disabled:opacity-50 transition"
              >
                <Copy className="w-3.5 h-3.5" />
                Aplicar
              </button>
            </div>
          </div>

          {/* Matriz */}
          {isResolving ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              <span className="ml-2 text-sm text-gray-500">Carregando produtos...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="py-2 px-2 font-semibold text-gray-700 w-10">#</th>
                    <th className="py-2 px-2 font-semibold text-gray-700">Produto</th>
                    <th className="py-2 px-2 font-semibold text-gray-700">{selectedTypeLabel}</th>
                    <th className="py-2 px-2 font-semibold text-gray-700">Preço (R$) *</th>
                    <th className="py-2 px-2 font-semibold text-gray-700">Estoque *</th>
                    <th className="py-2 px-2 font-semibold text-gray-700">SKU</th>
                    <th className="py-2 px-2 font-semibold text-gray-700">EAN</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, itIdx) =>
                    options.map((opt, optIdx) => {
                      const product = productMap.get(itemKey(it.source, Number(it.sourceId)));
                      const cell = cellMap.get(cellKey(it.sourceId, optIdx)) ?? emptyCell(it.sourceId, optIdx);
                      const isFirstOptionOfRow = optIdx === 0;
                      return (
                        <tr key={`${it.sourceId}-${optIdx}`} className={`border-b border-gray-100 ${isFirstOptionOfRow ? "border-t-2 border-t-gray-300" : ""}`}>
                          <td className="py-2 px-2 text-gray-400 text-xs">
                            {isFirstOptionOfRow ? itIdx + 1 : ""}
                          </td>
                          <td className="py-2 px-2">
                            {isFirstOptionOfRow && (
                              <div className="flex items-center gap-2">
                                {product?.imageUrl && (
                                  <img src={product.imageUrl} alt="" className="w-10 h-10 object-cover rounded" />
                                )}
                                <span className="text-xs text-gray-700 line-clamp-2">{product?.name ?? "(produto não resolvido)"}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2 text-gray-800">{opt}</td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={cell.price ?? ""}
                              onChange={(e) => handleCellChange(it.sourceId, optIdx, "price", e.target.value)}
                              onBlur={handleCellBlur}
                              placeholder="0,00"
                              className="w-24 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-400"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={cell.stock ?? ""}
                              onChange={(e) => handleCellChange(it.sourceId, optIdx, "stock", e.target.value)}
                              onBlur={handleCellBlur}
                              placeholder="0"
                              className="w-20 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-400"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={cell.sku ?? ""}
                              onChange={(e) => handleCellChange(it.sourceId, optIdx, "sku", e.target.value)}
                              onBlur={handleCellBlur}
                              placeholder="SKU"
                              className="w-28 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-400"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={cell.ean ?? ""}
                              onChange={(e) => handleCellChange(it.sourceId, optIdx, "ean", e.target.value)}
                              onBlur={handleCellBlur}
                              placeholder="EAN"
                              className="w-32 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-400"
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-3">
                Total: {items.length} produto{items.length !== 1 ? "s" : ""} × {options.length} {options.length !== 1 ? "opções" : "opção"} = {items.length * options.length} células. * obrigatório.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
