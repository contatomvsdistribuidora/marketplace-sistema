/**
 * Fase 8.H — Bloquinho de status do cache de marcas/atributos da
 * categoria selecionada (Step 3 do wizard).
 *
 * ADITIVO e nunca bloqueante: a Bella sempre consegue escolher marca
 * (BrandPicker tem fallback de marca livre). Erro aqui só mostra um
 * aviso amarelo discreto + botão "Tentar de novo".
 *
 * Comportamento:
 *  - Ao montar / trocar categoria: consulta getCategoryCacheStatus.
 *  - Se cache > 24h OU inexistente → dispara refresh em background.
 *  - Botão "Atualizar novamente" sempre disponível.
 *  - Pós-sucesso: invalida searchBrands + getCategoryCacheStatus pra
 *    marca nova aparecer sem recarregar a página.
 */
import { useEffect, useRef } from "react";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../../lib/trpc";

interface Props {
  accountId: number;
  categoryId: number;
}

// "há X horas/dias" amigável em PT-BR.
function formatAge(hours: number): string {
  if (hours < 1) return "há poucos minutos";
  if (hours < 24) return `há ${Math.floor(hours)} hora(s)`;
  return `há ${Math.floor(hours / 24)} dia(s)`;
}

export function CategoryCacheStatus({ accountId, categoryId }: Props) {
  const utils = trpc.useUtils();
  // Guarda a categoria pra qual já disparamos auto-refresh — evita
  // disparar de novo em re-renders / refetch de status.
  const autoFiredFor = useRef<number | null>(null);

  const statusQ = trpc.shopee.getCategoryCacheStatus.useQuery(
    { accountId, categoryId },
    { staleTime: 0 },
  );

  const refreshM = trpc.shopee.refreshBrandsForCategory.useMutation({
    onSuccess: () => {
      // Marca nova precisa aparecer no BrandPicker sem reload.
      utils.shopee.searchBrands.invalidate({ accountId, categoryId });
      utils.shopee.getCategoryCacheStatus.invalidate({ accountId, categoryId });
      toast.success("Catálogo da categoria atualizado.");
    },
    // onError: sem toast vermelho — o próprio bloquinho mostra o aviso.
  });

  // Troca de categoria: limpa estado da mutation pra não vazar ESTADO
  // 3/4 da categoria anterior.
  useEffect(() => {
    refreshM.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  // Auto-disparo: cache inexistente (null) ou > 24h.
  useEffect(() => {
    const data = statusQ.data;
    if (!data) return;
    if (refreshM.isPending) return;
    if (autoFiredFor.current === categoryId) return;
    const stale = data.hoursSinceSync === null || data.hoursSinceSync > 24;
    if (stale) {
      autoFiredFor.current = categoryId;
      refreshM.mutate({ accountId, categoryId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQ.data, categoryId, accountId]);

  const box = "rounded-xl border p-3 mb-3 text-xs";

  // ── ESTADO 2 — atualizando em background ──
  if (refreshM.isPending) {
    return (
      <div className={`${box} border-blue-200 bg-blue-50 text-blue-700`}>
        <div className="flex items-center gap-2 font-medium">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ⏳ Atualizando marcas e atributos em segundo plano...
        </div>
        <p className="mt-1 text-blue-600">
          Você já pode escolher uma marca. Se a que procura não aparecer,
          aguarde alguns segundos.
        </p>
      </div>
    );
  }

  // ── ESTADO 4 — erro (amarelo discreto, NÃO vermelho) ──
  if (refreshM.isError) {
    return (
      <div className={`${box} border-amber-200 bg-amber-50 text-amber-800`}>
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="w-3.5 h-3.5" />
          ⚠️ Não consegui atualizar automaticamente
        </div>
        <p className="mt-1 text-amber-700">
          {refreshM.error?.message ?? "Tente novamente em alguns segundos."}{" "}
          Você ainda pode escolher uma marca do cache atual ou digitar uma
          marca livre.
        </p>
        <button
          onClick={() => refreshM.mutate({ accountId, categoryId })}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 transition font-medium"
        >
          <RefreshCw className="w-3 h-3" /> Tentar de novo
        </button>
      </div>
    );
  }

  // ── ESTADO 3 — recém atualizado ──
  if (refreshM.isSuccess && refreshM.data) {
    const d = refreshM.data;
    return (
      <div className={`${box} border-green-200 bg-green-50 text-green-800`}>
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          ✅ Catálogo atualizado agora
        </div>
        <p className="mt-0.5 text-green-700">
          ({d.brandsCount} marcas, {d.attributesCount} atributos)
        </p>
        {d.truncated && (
          <p className="mt-1 text-amber-700">
            ⚠️ Catálogo muito grande — pode haver mais marcas. Avise o
            suporte.
          </p>
        )}
        <button
          onClick={() => refreshM.mutate({ accountId, categoryId })}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-green-300 bg-white text-green-800 hover:bg-green-100 transition font-medium"
        >
          <RefreshCw className="w-3 h-3" /> Atualizar novamente
        </button>
      </div>
    );
  }

  // ── ESTADO 1 — cache fresh (≤ 24h) ──
  if (statusQ.data && statusQ.data.hoursSinceSync !== null) {
    const d = statusQ.data;
    return (
      <div className={`${box} border-green-200 bg-green-50 text-green-800`}>
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          ✅ Catálogo atualizado {formatAge(d.hoursSinceSync!)}
        </div>
        <p className="mt-0.5 text-green-700">
          ({d.brandsCount} marcas, {d.attributesCount} atributos)
        </p>
        <button
          onClick={() => refreshM.mutate({ accountId, categoryId })}
          className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-green-300 bg-white text-green-800 hover:bg-green-100 transition font-medium"
        >
          <RefreshCw className="w-3 h-3" /> Atualizar novamente
        </button>
      </div>
    );
  }

  // Neutro: ainda consultando o status (antes do auto-disparo decidir).
  return (
    <div className={`${box} border-gray-200 bg-gray-50 text-gray-500`}>
      <div className="flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Verificando catálogo da categoria...
      </div>
    </div>
  );
}
