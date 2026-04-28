import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface DescriptionEditorProps {
  product: any;
  onUpdated: (newDescription: string) => void;
}

export function DescriptionEditor({ product, onUpdated }: DescriptionEditorProps) {
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(product.description || "");
  const [savingDesc, setSavingDesc] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const applyDescMutation = trpc.shopee.applyDescription.useMutation();
  const generateAdMutation = trpc.shopee.generateAdContent.useMutation();

  async function handleSaveDesc() {
    if (!descDraft.trim()) return;
    setSavingDesc(true);
    try {
      await applyDescMutation.mutateAsync({ productId: product.id, newDescription: descDraft });
      onUpdated(descDraft);
      setEditingDesc(false);
    } catch {}
    setSavingDesc(false);
  }

  async function handleGenerateDesc() {
    setGeneratingDesc(true);
    try {
      const result = await generateAdMutation.mutateAsync({
        productName: product.itemName || "",
        category: product.categoryName || undefined,
        variationType: "Unidade",
        variations: [{
          label: "1 Unidade",
          qty: 1,
          weight: product.weight ? String(product.weight) : "0.5",
          dimensions: [product.dimensionLength, product.dimensionWidth, product.dimensionHeight]
            .filter(Boolean).join("x") || "20x15x10",
          price: product.price ? String(product.price) : "0",
        }],
      });
      const generated = (result as any).descricao || (result as any).description || "";
      setDescDraft(generated);
      setEditingDesc(true);
    } catch {}
    setGeneratingDesc(false);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Descrição</p>
        {!editingDesc && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateDesc}
              disabled={generatingDesc}
              className="text-xs flex items-center gap-1 text-purple-500 hover:text-purple-700 disabled:opacity-50 transition font-medium">
              {generatingDesc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {generatingDesc ? "Gerando…" : "✨ Gerar com IA"}
            </button>
            <span className="text-gray-200">|</span>
            <button onClick={() => { setDescDraft(product.description || ""); setEditingDesc(true); }}
              className="text-xs flex items-center gap-1 text-gray-400 hover:text-orange-500 transition">
              ✏️ Editar
            </button>
          </div>
        )}
      </div>
      {editingDesc ? (
        <div className="space-y-2">
          <textarea
            value={descDraft}
            onChange={e => setDescDraft(e.target.value)}
            rows={8}
            className="w-full text-sm text-gray-700 border border-gray-300 rounded-xl p-3 resize-y focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <div className="flex gap-2">
            <button onClick={() => setEditingDesc(false)}
              className="flex-1 py-2 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button onClick={handleSaveDesc} disabled={savingDesc}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-xl disabled:opacity-50 transition">
              {savingDesc ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          {product.description || <span className="text-gray-400 italic">Sem descrição</span>}
        </p>
      )}
    </div>
  );
}
