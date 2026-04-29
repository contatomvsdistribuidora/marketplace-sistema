import { useLocation } from "wouter";
import { trpc } from "../lib/trpc";
import { Loader2, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function CombinedListingsDrafts() {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.multiProduct.listMultiProductListings.useQuery({});
  const utils = trpc.useUtils();
  const duplicate = trpc.multiProduct.duplicateMultiProductListing.useMutation();

  const drafts = (data ?? []).filter((l: any) => l.status === "draft");

  async function handleDuplicate(id: number) {
    try {
      const result = await duplicate.mutateAsync({ id });
      toast.success("Rascunho duplicado!");
      await utils.multiProduct.listMultiProductListings.invalidate();
      navigate(`/multi-product-wizard?id=${result.id}`);
    } catch (e: any) {
      toast.error("Erro ao duplicar: " + (e.message ?? "desconhecido"));
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rascunhos de Anuncios Combinados</h1>
        <p className="text-sm text-gray-500 mt-1">Anuncios em rascunho que voce pode editar ou duplicar.</p>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">Nenhum rascunho salvo ainda.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((d: any) => (
            <div key={d.id} className="border border-gray-200 rounded-xl bg-white p-4 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900 truncate">
                  {d.title || `Rascunho #${d.id}`}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Criado em {new Date(d.createdAt).toLocaleDateString("pt-BR")} · ID #{d.id}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => navigate(`/multi-product-wizard?id=${d.id}`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Abrir
                </button>
                <button
                  onClick={() => handleDuplicate(d.id)}
                  disabled={duplicate.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 rounded-lg"
                >
                  <Copy className="w-3.5 h-3.5" /> Duplicar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
