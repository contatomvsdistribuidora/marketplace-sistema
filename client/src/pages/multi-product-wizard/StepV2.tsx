import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import type { Listing } from "./types";
import { VARIATION_TYPES } from "./types";
import { Hash, Ruler, Palette, Layers, PenLine, Loader2 } from "lucide-react";

const TYPE_ICONS: Record<string, any> = {
  quantidade: Hash,
  tamanho: Ruler,
  cor: Palette,
  material: Layers,
  personalizado: PenLine,
};

interface StepV2Props {
  listing: Listing;
  onChange: () => void;
}

export function StepV2({ listing, onChange }: StepV2Props) {
  const [selectedType, setSelectedType] = useState<string | null>(listing.variation2Type ?? null);
  const updateMutation = trpc.multiProduct.updateMultiProductListing.useMutation();

  useEffect(() => {
    setSelectedType(listing.variation2Type ?? null);
  }, [listing.id, listing.variation2Type]);

  async function handleSelectType(type: string) {
    if (selectedType === type) return;
    setSelectedType(type);
    await updateMutation.mutateAsync({ id: listing.id, variation2Type: type });
    onChange();
  }

  return (
    <div className="space-y-6">
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

      {selectedType && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm text-blue-800">
            <strong>Tipo selecionado:</strong> {VARIATION_TYPES.find(v => v.key === selectedType)?.label}.
            Próximo passo: definir as opções (ex: 50un, 100un, 200un) e a matriz de preços. <em>Em desenvolvimento.</em>
          </p>
        </div>
      )}
    </div>
  );
}
