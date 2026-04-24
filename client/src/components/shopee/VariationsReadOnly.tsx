/**
 * Renders the existing variations of a Shopee product in read-only mode —
 * used by the wizard when has_model=true on the listing. Editing is not yet
 * supported (see the BLOCKED banner in ShopeeCriador).
 *
 * TECH-DEBT: no component-level tests (frontend test infra not yet set up).
 * Backend shape is covered in shopee-publish.test.ts (checkExistingVariation).
 */
import { ExternalLink } from "lucide-react";

export interface VariationsReadOnlyTier {
  name: string;
  optionList: Array<{ option: string; image: string | null }>;
}

export interface VariationsReadOnlyModel {
  modelId: number;
  modelSku: string;
  modelName: string;
  tierIndex: number[];
  currentPrice: number | null;
  originalPrice: number | null;
  currentStock: number | null;
  normalStock: number | null;
}

interface Props {
  itemId: number;
  tierVariation: VariationsReadOnlyTier[];
  models: VariationsReadOnlyModel[];
}

function formatBRL(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function VariationsReadOnly({ itemId, tierVariation, models }: Props) {
  return (
    <div className="border border-gray-200 rounded-xl bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">
          Variações atuais na Shopee
          <span className="ml-2 text-xs font-normal text-gray-400">(somente leitura)</span>
        </p>
        <a
          href={`https://seller.shopee.com.br/portal/product/${itemId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 transition"
        >
          Editar no painel Shopee <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Tiers + opções */}
      <div className="px-4 py-3 space-y-2 border-b border-gray-100">
        {tierVariation.length === 0 && (
          <p className="text-xs text-gray-400">Nenhuma camada de variação retornada pela Shopee.</p>
        )}
        {tierVariation.map((tier, ti) => (
          <div key={ti} className="flex items-start gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
              {tier.name || `Tier ${ti + 1}`}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {tier.optionList.map((opt, oi) => (
                <span
                  key={oi}
                  className="text-xs text-gray-700 bg-white border border-gray-300 rounded-full px-2.5 py-0.5"
                >
                  {opt.option}
                </span>
              ))}
              {tier.optionList.length === 0 && (
                <span className="text-xs text-gray-400">(sem opções)</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tabela de models */}
      {models.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="text-left font-medium px-4 py-2">Variação</th>
                <th className="text-left font-medium px-4 py-2">SKU</th>
                <th className="text-right font-medium px-4 py-2">Preço</th>
                <th className="text-right font-medium px-4 py-2">Estoque</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.modelId} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2 text-gray-800 font-medium">{m.modelName}</td>
                  <td className="px-4 py-2 text-gray-600 font-mono text-xs">
                    {m.modelSku || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-800 tabular-nums">
                    {formatBRL(m.currentPrice ?? m.originalPrice)}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-800 tabular-nums">
                    {m.currentStock ?? m.normalStock ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-3 text-xs text-gray-400">
          Não foi possível carregar a lista detalhada de variações (a Shopee não retornou os models).
        </div>
      )}
    </div>
  );
}
