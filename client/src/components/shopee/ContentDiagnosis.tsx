import { Loader2, RefreshCw, Star, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Mapa de issue_type da Shopee → texto pt-BR. Códigos não mapeados caem
// no fallback (suggestion crua em inglês). Códigos confirmados via API:
//   10 → Add video
// Demais foram inferidos da doc/comunidade Shopee — verifique antes de
// confiar 100% e atualize aqui quando surgirem novos casos reais.
const ISSUE_TYPE_PT: Record<number, string> = {
  1: "Adicionar descrição do produto",
  2: "Adicionar marca",
  3: "Adicionar SKU pai",
  4: "Adicionar peso do produto",
  5: "Adicionar dimensões da embalagem",
  6: "Preencher atributos da categoria",
  7: "Adicionar variações",
  8: "Melhorar qualidade das imagens",
  9: "Adicionar mais imagens",
  10: "Adicionar vídeo do produto",
  11: "Melhorar resolução das imagens",
  12: "Adicionar tabela de medidas",
};

function translateIssue(t: { issue_type: number; suggestion: string }): string {
  return ISSUE_TYPE_PT[t.issue_type] ?? t.suggestion;
}

interface Props {
  qualityLevel: number | null;
  unfinishedTasks: Array<{ issue_type: number; suggestion: string }> | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function ContentDiagnosis({ qualityLevel, unfinishedTasks, onRefresh, refreshing }: Props) {
  if (qualityLevel === null) {
    return (
      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 text-sm text-gray-500 flex items-center justify-between">
        <span>Diagnóstico de qualidade não disponível.</span>
        {onRefresh && (
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        )}
      </div>
    );
  }

  const tasks = unfinishedTasks ?? [];
  const isMax = qualityLevel >= 3 && tasks.length === 0;
  const tone = isMax
    ? { border: "border-emerald-300", bg: "bg-emerald-50", text: "text-emerald-900", star: "text-emerald-500" }
    : qualityLevel >= 2
      ? { border: "border-amber-300", bg: "bg-amber-50", text: "text-amber-900", star: "text-amber-500" }
      : { border: "border-rose-300", bg: "bg-rose-50", text: "text-rose-900", star: "text-rose-500" };

  return (
    <div className={`border rounded-lg p-3 ${tone.border} ${tone.bg}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isMax ? (
            <CheckCircle2 className={`h-4 w-4 ${tone.star}`} />
          ) : (
            <AlertCircle className={`h-4 w-4 ${tone.star}`} />
          )}
          <span className={`text-sm font-medium ${tone.text}`}>
            Qualidade Shopee:
          </span>
          <span className="flex items-center">
            {[1, 2, 3].map((n) => (
              <Star
                key={n}
                className={`h-4 w-4 ${n <= qualityLevel ? `${tone.star} fill-current` : "text-gray-300"}`}
              />
            ))}
          </span>
        </div>
        {onRefresh && (
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
      {tasks.length > 0 && (
        <ul className={`mt-2 space-y-1 text-xs ${tone.text}`}>
          {tasks.map((t, i) => (
            <li key={`${t.issue_type}-${i}`} className="flex items-start gap-1.5">
              <span className="text-gray-400">•</span>
              <span>{translateIssue(t)}</span>
            </li>
          ))}
        </ul>
      )}
      {isMax && (
        <p className={`mt-1 text-xs ${tone.text}`}>Anúncio sem pendências de qualidade.</p>
      )}
    </div>
  );
}
