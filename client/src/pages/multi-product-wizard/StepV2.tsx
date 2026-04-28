import { useState, useEffect, KeyboardEvent } from "react";
import { trpc } from "@/lib/trpc";
import type { Listing } from "./types";
import { VARIATION_TYPES } from "./types";
import { Hash, Ruler, Palette, Layers, PenLine, Loader2, Plus, X } from "lucide-react";

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
  onChange: () => void;
}

function parseOptions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
    return [];
  } catch {
    return [];
  }
}

export function StepV2({ listing, onChange }: StepV2Props) {
  const [selectedType, setSelectedType] = useState<string | null>(listing.variation2Type ?? null);
  const [options, setOptions] = useState<string[]>(parseOptions(listing.variation2OptionsJson));
  const [newOption, setNewOption] = useState("");

  const updateMutation = trpc.multiProduct.updateMultiProductListing.useMutation();

  useEffect(() => {
    setSelectedType(listing.variation2Type ?? null);
    setOptions(parseOptions(listing.variation2OptionsJson));
  }, [listing.id, listing.variation2Type, listing.variation2OptionsJson]);

  async function handleSelectType(type: string) {
    if (selectedType === type) return;
    setSelectedType(type);
    await updateMutation.mutateAsync({ id: listing.id, variation2Type: type });
    onChange();
  }

  async function persistOptions(next: string[]) {
    setOptions(next);
    await updateMutation.mutateAsync({
      id: listing.id,
      variation2OptionsJson: JSON.stringify(next),
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

  const selectedTypeLabel = VARIATION_TYPES.find((v) => v.key === selectedType)?.label;

  return (
    <div className="space-y-6">
      {/* Zona 1 - Tipo da Variacao 2 */}
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
                className={`
                  flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition
                  ${isSelected
                    ? "border-orange-500 bg-orange-50 text-orange-700"
                    : "border-gray-200 hover:border-gray-300 text-gray-700"}
                  disabled:opacity-60 disabled:cursor-not-allowed
                `}
              >
                {isLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Icon className="w-6 h-6" />
                )}
                <span className="font-semibold text-sm">{vt.label}</span>
                <span className="text-xs text-gray-400 text-center">{vt.examples}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Zona 2 - Opcoes da Variacao 2 */}
      {selectedType && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Opções de {selectedTypeLabel}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Adicione as opções que cada produto vai ter. Ex: "50un", "100un", "200un". Mínimo 1 opção.
            </p>
          </div>

          {/* Input + botão adicionar */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newOption}
              onChange={(e) => setNewOption(e.target.value.slice(0, MAX_OPTION_LEN))}
              onKeyDown={handleKeyDown}
              placeholder={`Ex: ${VARIATION_TYPES.find((v) => v.key === selectedType)?.examples?.replace("ex: ", "").split(",")[0].trim() ?? "valor"}`}
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

          {/* Lista de opções */}
          {options.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                ⚠️ Adicione pelo menos uma opção para continuar.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {options.map((opt, idx) => (
                <div
                  key={`${opt}-${idx}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-orange-100 border border-orange-300 text-orange-800 rounded-full text-sm font-medium"
                >
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

          {options.length > 0 && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-800">
                <strong>{options.length} {options.length === 1 ? "opção configurada" : "opções configuradas"}.</strong>
                {" "}Próximo passo: matriz de preços por produto × opção. <em>Em desenvolvimento.</em>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
