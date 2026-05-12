import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Sparkles, ZoomIn, ImageIcon, Check, Download } from "lucide-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  listingId: number;
  initialThumbUrl?: string | null;
  onThumbGenerated?: (url: string) => void;
};

export default function ThumbGeneratorModal({
  isOpen,
  onClose,
  listingId,
  initialThumbUrl,
  onThumbGenerated,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customPromptText, setCustomPromptText] = useState<string>("");
  const [creativeMode, setCreativeMode] = useState<boolean>(true);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState<string | null>(null);
  const [variationCount, setVariationCount] = useState<number>(2);
  const [generatedUrls, setGeneratedUrls] = useState<string[]>([]);
  const [selectedGeneratedIdx, setSelectedGeneratedIdx] = useState<number | null>(null);

  // Reset states quando modal abre
  useEffect(() => {
    if (!isOpen) return;
    setSelected([]);
    setCustomPromptText("");
    setCreativeMode(true);
    setGeneratedUrl(initialThumbUrl || null);
    setZoomOpen(null);
    setVariationCount(2);
    setGeneratedUrls([]);
    setSelectedGeneratedIdx(null);
  }, [isOpen, initialThumbUrl]);

  // Busca fotos agrupadas por produto
  const imagesQuery = trpc.multiProduct.getAvailableThumbImages.useQuery(
    { id: listingId },
    { enabled: isOpen },
  );

  // Mutation: gerar prompt com IA
  const generatePromptMutation =
    trpc.multiProduct.generateThumbPromptWithAI.useMutation({
      onSuccess: (data) => {
        setCustomPromptText(data.prompt);
        toast.success("Prompt gerado! Edite se quiser antes de gerar a imagem.");
      },
      onError: (e) => toast.error(e.message),
    });

  // Mutation: gerar thumb final
  const generateMutation =
    trpc.multiProduct.generateThumbWithAI.useMutation({
      onSuccess: (data) => {
        setGeneratedUrl(data.thumbUrl);
        toast.success("Thumb gerada!");
        if (onThumbGenerated) onThumbGenerated(data.thumbUrl);
      },
      onError: (e) => toast.error(e.message),
    });

  // Mutation: gerar batch de 1-4 variações em paralelo
  const generateBatchMutation =
    trpc.multiProduct.generateThumbBatchWithAI.useMutation({
      onSuccess: (data) => {
        const urls = data.results.map((r) => r.thumbUrl);
        setGeneratedUrls(urls);
        setSelectedGeneratedIdx(0);
        if (urls.length > 0) setGeneratedUrl(urls[0]);

        if (data.errors.length > 0) {
          toast.warning(`${urls.length} thumbs geradas. ${data.errors.length} falharam.`);
        } else {
          toast.success(`${urls.length} thumb(s) gerada(s)!`);
        }
      },
      onError: (e) => toast.error(e.message),
    });

  const generateCollageMutation = trpc.multiProduct.generateCollage.useMutation({
    onSuccess: (data) => {
      const a = document.createElement("a");
      a.href = data.url;
      a.download = `collage-${data.cols}x${data.rows}-${Date.now()}.png`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(`Collage ${data.cols}×${data.rows} gerado! Anexe no ChatGPT.`);
    },
    onError: (e) => toast.error(e.message),
  });

  function handleGenerateCollage() {
    if (selected.length === 0) {
      toast.error("Selecione ao menos 1 foto.");
      return;
    }
    generateCollageMutation.mutate({ imageUrls: selected });
  }

  function toggleImage(url: string) {
    setSelected((prev) =>
      prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url],
    );
  }

  function selectAllOf(urls: string[]) {
    setSelected((prev) => {
      const set = new Set(prev);
      urls.forEach((u) => set.add(u));
      return Array.from(set);
    });
  }

  function unselectAllOf(urls: string[]) {
    setSelected((prev) => prev.filter((u) => !urls.includes(u)));
  }

  function handleGeneratePrompt() {
    if (selected.length === 0 && !creativeMode) {
      toast.error("Selecione ao menos 1 foto ou ative o modo criativo total.");
      return;
    }
    generatePromptMutation.mutate({
      id: listingId,
      photoUrls: selected.length > 0 ? selected : undefined,
    });
  }

  function handleGenerate() {
    if (!customPromptText.trim()) {
      toast.error("Gere ou escreva um prompt antes de gerar a thumb.");
      return;
    }
    if (selected.length === 0 && !creativeMode) {
      toast.error(
        "Selecione ao menos 1 foto OU ative o modo criativo total.",
      );
      return;
    }

    setGeneratedUrls([]);
    setSelectedGeneratedIdx(null);

    generateBatchMutation.mutate({
      id: listingId,
      count: variationCount,
      selectedImageUrls: creativeMode ? [] : selected,
      customPrompt: customPromptText.trim(),
      creativeMode,
    });
  }

  const products = imagesQuery.data || [];
  const allUrls = products.flatMap((p) => p.imageUrls);
  const isGenerating = generateMutation.isPending || generateBatchMutation.isPending;
  const isGeneratingPrompt = generatePromptMutation.isPending;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="!max-w-none !w-screen !h-screen !max-h-screen !rounded-none p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              Gerar Thumb com IA
            </DialogTitle>
          </DialogHeader>

          {/* Conteúdo: 3 colunas */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-6 max-w-[1800px] mx-auto">
              {/* COLUNA 1 — FOTOS AGRUPADAS POR PRODUTO */}
              <div className="space-y-4">
                <div>
                  <Label className="text-base font-semibold">
                    📸 Fotos do anúncio ({selected.length} selecionadas)
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {creativeMode
                      ? "🎨 Modo Criativo: fotos são analisadas pela IA mas NÃO copiadas — IA cria do zero."
                      : "Marque fotos pra IA usar como referência visual."}
                  </p>
                </div>

                {imagesQuery.isLoading && (
                  <div className="flex items-center justify-center p-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Carregando fotos...
                  </div>
                )}

                {!imagesQuery.isLoading && products.length === 0 && (
                  <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
                    <ImageIcon className="h-10 w-10 mb-2 opacity-40" />
                    <p className="text-sm">Nenhuma foto disponível.</p>
                  </div>
                )}

                {products.length > 0 && (
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => selectAllOf(allUrls)}
                      className="underline text-blue-600 hover:text-blue-800"
                    >
                      Marcar todas
                    </button>
                    <span className="text-gray-400">|</span>
                    <button
                      type="button"
                      onClick={() => setSelected([])}
                      className="underline text-blue-600 hover:text-blue-800"
                    >
                      Desmarcar todas
                    </button>
                  </div>
                )}

                {products.map((produto) => {
                  const allSelected = produto.imageUrls.every((u) =>
                    selected.includes(u),
                  );
                  return (
                    <div
                      key={`${produto.source}-${produto.sourceId}`}
                      className="border rounded-lg p-3 bg-gray-50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {produto.isPrincipal && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-medium">
                              ⭐ Principal
                            </span>
                          )}
                          <h4 className="text-sm font-medium line-clamp-1">
                            {produto.name}
                          </h4>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            allSelected
                              ? unselectAllOf(produto.imageUrls)
                              : selectAllOf(produto.imageUrls)
                          }
                          className="text-[10px] underline text-blue-600 shrink-0 ml-2"
                        >
                          {allSelected ? "Desmarcar" : "Marcar"} todas
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {produto.imageUrls.map((url) => {
                          const isSelected = selected.includes(url);
                          return (
                            <div
                              key={url}
                              className={`relative rounded overflow-hidden border-2 transition cursor-pointer aspect-square bg-white ${
                                isSelected
                                  ? "border-orange-500 ring-2 ring-orange-200"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                              onClick={() => toggleImage(url)}
                            >
                              <img
                                src={url}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                              {isSelected && (
                                <div className="absolute top-1 right-1 bg-orange-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow">
                                  <Check className="h-4 w-4" />
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setZoomOpen(url);
                                }}
                                className="absolute bottom-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black/80"
                                title="Ampliar"
                              >
                                <ZoomIn className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* COLUNA 2 — PROMPT + BOTÕES */}
              <div className="space-y-4">
                <div>
                  <Label className="text-base font-semibold">
                    🎨 Modo de geração
                  </Label>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCreativeMode(true)}
                      className={`flex-1 text-sm px-4 py-3 rounded border-2 transition ${
                        creativeMode
                          ? "bg-purple-100 border-purple-500 text-purple-900 font-medium"
                          : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      🎨 Criativo Total
                      <br />
                      <span className="text-[10px] opacity-70">
                        IA cria do zero (recomendado)
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreativeMode(false)}
                      className={`flex-1 text-sm px-4 py-3 rounded border-2 transition ${
                        !creativeMode
                          ? "bg-orange-100 border-orange-500 text-orange-900 font-medium"
                          : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      📷 Com Referências
                      <br />
                      <span className="text-[10px] opacity-70">
                        IA reproduz as fotos
                      </span>
                    </button>
                  </div>
                </div>

                <div>
                  <Label className="text-base font-semibold">
                    🔢 Quantas variações gerar?
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1 mb-2">
                    Mais variações = mais opções pra escolher, mas custo proporcional.
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map((n) => {
                      const active = variationCount === n;
                      const cost = (n * 0.17).toFixed(2);
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setVariationCount(n)}
                          className={`text-sm px-3 py-3 rounded border-2 transition flex flex-col items-center ${
                            active
                              ? "bg-orange-100 border-orange-500 text-orange-900 font-bold"
                              : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                          }`}
                        >
                          <span className="text-lg">{n}</span>
                          <span className="text-[10px] opacity-70">~US$ {cost}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>✏️ Prompt da imagem</Label>
                    <button
                      type="button"
                      onClick={handleGeneratePrompt}
                      disabled={isGeneratingPrompt}
                      className="text-xs px-3 py-1 rounded border bg-gradient-to-r from-purple-100 to-pink-100 border-purple-400 text-purple-900 font-medium hover:from-purple-200 hover:to-pink-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title="IA lê os dados do anúncio + as fotos selecionadas e cria um prompt profissional"
                    >
                      {isGeneratingPrompt ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 inline animate-spin" />
                          Gerando...
                        </>
                      ) : (
                        <>🤖 Gerar prompt com IA</>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Clique no botão pra IA criar um prompt baseado no anúncio
                    e fotos. Você pode editar antes de gerar a thumb.
                  </p>
                  <Textarea
                    rows={16}
                    value={customPromptText}
                    onChange={(e) => setCustomPromptText(e.target.value)}
                    placeholder="O prompt aparecerá aqui após clicar em 'Gerar prompt com IA' acima. Você pode editar ou escrever do zero."
                    className="text-xs font-mono"
                    maxLength={5000}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {customPromptText.length}/5000 caracteres
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={generateCollageMutation.isPending || selected.length === 0}
                  onClick={handleGenerateCollage}
                  className="w-full"
                >
                  {generateCollageMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando collage...</>
                  ) : (
                    <><Download className="h-4 w-4 mr-2" /> Baixar imagem das {selected.length} fotos (pra ChatGPT)</>
                  )}
                </Button>
              </div>

              {/* COLUNA 3 — PREVIEW */}
              <div className="space-y-4">
                <Label className="text-base font-semibold">
                  🖼️ Preview da thumb
                </Label>
                {isGenerating && (
                  <div className="flex flex-col items-center justify-center p-8 bg-gray-50 rounded-lg min-h-[400px]">
                    <Loader2 className="h-10 w-10 animate-spin text-purple-600 mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Gerando {variationCount} variação{variationCount > 1 ? "ões" : ""} com IA... (~{variationCount * 30}s)
                    </p>
                  </div>
                )}
                {!isGenerating && generatedUrls.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {generatedUrls.length === 1
                        ? "✨ Thumb gerada!"
                        : `✨ ${generatedUrls.length} variações geradas! Clique na que quiser usar:`}
                    </p>
                    <div className={`grid gap-3 ${generatedUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                      {generatedUrls.map((url, idx) => {
                        const isSelected = selectedGeneratedIdx === idx;
                        return (
                          <div
                            key={url}
                            className={`relative rounded-lg overflow-hidden border-4 transition cursor-pointer ${
                              isSelected
                                ? "border-orange-500 ring-2 ring-orange-200 shadow-lg"
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                            onClick={() => {
                              setSelectedGeneratedIdx(idx);
                              setGeneratedUrl(url);
                            }}
                          >
                            <img src={url} alt={`Variação ${idx + 1}`} className="w-full" />
                            <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                              {String.fromCharCode(65 + idx)}
                            </div>
                            {isSelected && (
                              <div className="absolute top-2 right-2 bg-orange-500 text-white rounded-full p-1.5 shadow">
                                <Check className="h-4 w-4" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setZoomOpen(url);
                              }}
                              className="absolute bottom-2 right-2 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80"
                              title="Ampliar"
                            >
                              <ZoomIn className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      Variação selecionada: {selectedGeneratedIdx !== null ? String.fromCharCode(65 + selectedGeneratedIdx) : "—"}
                    </p>
                  </div>
                )}
                {!isGenerating && generatedUrls.length === 0 && generatedUrl && (
                  <div className="space-y-2">
                    <img
                      src={generatedUrl}
                      alt="Thumb atual"
                      className="w-full rounded-lg border-2 border-orange-300 shadow"
                    />
                    <p className="text-xs text-muted-foreground text-center">
                      Thumb atual do anúncio. Clique em "Gerar Thumb" pra criar variações novas.
                    </p>
                  </div>
                )}
                {!isGenerating && generatedUrls.length === 0 && !generatedUrl && (
                  <div className="flex flex-col items-center justify-center p-8 bg-gray-50 rounded-lg min-h-[400px] text-muted-foreground">
                    <ImageIcon className="h-12 w-12 mb-3 opacity-40" />
                    <p className="text-sm text-center">
                      A thumb aparecerá aqui após clicar em "Gerar Thumb".
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="flex justify-between gap-2 px-6 py-4 border-t shrink-0 bg-white">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <div className="flex gap-2">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !customPromptText.trim()}
                variant={generatedUrl ? "outline" : "default"}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Gerando...
                  </>
                ) : generatedUrl ? (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Regerar
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Gerar Thumb
                  </>
                )}
              </Button>
              {generatedUrl && (
                <Button
                  onClick={() => {
                    if (onThumbGenerated) onThumbGenerated(generatedUrl);
                    onClose();
                  }}
                  className="bg-green-600 hover:bg-green-700"
                >
                  ✓ Usar esta thumb
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de zoom */}
      {zoomOpen && (
        <Dialog open={!!zoomOpen} onOpenChange={() => setZoomOpen(null)}>
          <DialogContent className="max-w-4xl">
            <img
              src={zoomOpen}
              alt="Zoom"
              className="w-full h-auto rounded"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
