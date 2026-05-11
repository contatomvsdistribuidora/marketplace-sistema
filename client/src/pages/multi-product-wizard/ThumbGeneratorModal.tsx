import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageIcon, Loader2, Sparkles, ZoomIn } from "lucide-react";

type Props = {
  listingId: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentThumbUrl?: string | null;
};

const MAX_REFS = 16;

export function ThumbGeneratorModal({
  listingId,
  isOpen,
  onClose,
  onSuccess,
  currentThumbUrl,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState("");
  const [extraPrompt, setExtraPrompt] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);

  const imagesQuery = trpc.multiProduct.getAvailableThumbImages.useQuery(
    { id: listingId },
    { enabled: isOpen },
  );

  const allUrls = useMemo(() => {
    const urls: string[] = [];
    for (const item of imagesQuery.data ?? []) {
      for (const u of item.imageUrls) {
        if (!urls.includes(u)) urls.push(u);
      }
    }
    return urls;
  }, [imagesQuery.data]);

  // Marca todas por padrão ao carregar (limita a MAX_REFS)
  useEffect(() => {
    if (!isOpen) return;
    if (allUrls.length === 0) return;
    setSelected((prev) => (prev.length === 0 ? allUrls.slice(0, MAX_REFS) : prev));
  }, [isOpen, allUrls]);

  // Reset state quando fecha
  useEffect(() => {
    if (isOpen) return;
    setSelected([]);
    setHeaderText("");
    setExtraPrompt("");
    setGeneratedUrl(null);
    setZoomOpen(false);
  }, [isOpen]);

  function toggleImage(url: string) {
    setSelected((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= MAX_REFS) {
        toast.error(`Máximo ${MAX_REFS} fotos.`);
        return prev;
      }
      return [...prev, url];
    });
  }

  function selectAll() {
    setSelected(allUrls.slice(0, MAX_REFS));
  }

  function clearAll() {
    setSelected([]);
  }

  const generateMutation = trpc.multiProduct.generateThumbWithAI.useMutation({
    onSuccess: (resp) => {
      setGeneratedUrl(resp.thumbUrl);
      toast.success("Thumb gerada! Confira o preview.");
    },
    onError: (e) => toast.error(e.message),
  });

  function handleGenerate() {
    if (selected.length === 0) {
      toast.error("Selecione ao menos 1 foto.");
      return;
    }
    generateMutation.mutate({
      id: listingId,
      extraPrompt: extraPrompt.trim() || undefined,
      selectedImageUrls: selected,
      headerText: headerText.trim() || undefined,
    });
  }

  function handleSaveAndClose() {
    onSuccess();
    onClose();
  }

  const previewSrc = generatedUrl || currentThumbUrl || null;
  const isGenerating = generateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl w-[90vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Gerar Thumb com IA
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* COLUNA ESQUERDA — Configurações */}
          <div className="space-y-4">
            <div>
              <Label>
                📸 Fotos de referência ({selected.length}/{MAX_REFS})
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Selecione até {MAX_REFS} fotos. Marcadas = IA usa como base visual.
              </p>
              {imagesQuery.isLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : imagesQuery.data && imagesQuery.data.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto p-2 border rounded">
                  {imagesQuery.data.flatMap((item) =>
                    item.imageUrls.map((url, urlIdx) => {
                      const isSelected = selected.includes(url);
                      const reachedLimit = !isSelected && selected.length >= MAX_REFS;
                      return (
                        <button
                          key={`${item.source}-${item.sourceId}-${urlIdx}`}
                          type="button"
                          onClick={() => toggleImage(url)}
                          disabled={reachedLimit}
                          className={`relative aspect-square rounded border-2 overflow-hidden transition ${
                            isSelected
                              ? "border-orange-500 ring-2 ring-orange-200"
                              : "border-gray-200 opacity-70 hover:opacity-100"
                          } ${reachedLimit ? "cursor-not-allowed" : "cursor-pointer"}`}
                          title={item.name}
                        >
                          <img
                            src={url}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                          {item.isPrincipal && (
                            <div className="absolute top-0 left-0 bg-yellow-400 text-[9px] px-1 font-bold">
                              ⭐
                            </div>
                          )}
                          {isSelected && (
                            <div className="absolute top-1 right-1 bg-orange-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                              ✓
                            </div>
                          )}
                        </button>
                      );
                    }),
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground border rounded p-3">
                  Nenhuma foto disponível nos produtos do anúncio.
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={selectAll} disabled={allUrls.length === 0}>
                  Marcar todas
                </Button>
                <Button variant="outline" size="sm" onClick={clearAll} disabled={selected.length === 0}>
                  Desmarcar todas
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="headerText">📝 Texto do Header (opcional)</Label>
              <p className="text-xs text-muted-foreground mb-1">
                Substitui o "N TIPOS DE..." automático.
              </p>
              <Input
                id="headerText"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder="Ex: KIT 5 EM 1, COMBO MEGA SACOS"
                maxLength={100}
              />
            </div>

            <div>
              <Label htmlFor="extraPrompt">💬 Instruções extras (opcional)</Label>
              <Textarea
                id="extraPrompt"
                rows={3}
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                placeholder='Ex: "fundo amarelo brilhante", "destaque a palavra OFERTA"'
                className="text-xs"
              />
            </div>
          </div>

          {/* COLUNA DIREITA — Preview */}
          <div className="space-y-3">
            <Label>🖼️ Preview</Label>
            {previewSrc ? (
              <div className="relative group">
                <img
                  src={previewSrc}
                  alt="Thumb"
                  className="w-full aspect-square object-contain border rounded bg-gray-50 cursor-zoom-in"
                  onClick={() => setZoomOpen(true)}
                />
                <button
                  type="button"
                  onClick={() => setZoomOpen(true)}
                  className="absolute top-2 right-2 bg-white/90 rounded-full p-2 shadow opacity-0 group-hover:opacity-100 transition"
                  title="Ampliar"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="aspect-square border-2 border-dashed rounded flex items-center justify-center text-muted-foreground bg-gray-50">
                <div className="text-center">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma thumb gerada ainda</p>
                  <p className="text-xs">Selecione fotos e clique em "Gerar"</p>
                </div>
              </div>
            )}
            {generatedUrl && (
              <p className="text-xs text-green-600 text-center">
                ✨ Thumb gerada! Clique pra ampliar ou em "Regerar" pra tentar de novo.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="flex justify-between gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <div className="flex gap-2 ml-auto">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || selected.length === 0}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Gerando...
                </>
              ) : generatedUrl ? (
                <>
                  <Sparkles className="h-4 w-4 mr-2" /> Regerar
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" /> Gerar Thumb
                </>
              )}
            </Button>
            {generatedUrl && (
              <Button onClick={handleSaveAndClose} className="bg-green-600 hover:bg-green-700">
                ✓ Usar esta thumb
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Thumb ampliada</DialogTitle>
          </DialogHeader>
          {previewSrc && <img src={previewSrc} alt="Thumb ampliada" className="w-full" />}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
