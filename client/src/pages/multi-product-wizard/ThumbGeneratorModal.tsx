import { useState, useEffect, useRef } from "react";
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
import {
  Loader2, Sparkles, ZoomIn, ImageIcon, Check, Download,
  Copy, Clipboard, Upload,
} from "lucide-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  listingId: number;
  initialThumbUrl?: string | null;
  onThumbGenerated?: (url: string) => void;
  /**
   * Modo de operação (Fase 5.1.B multi-store):
   * - "listing" (default): escreve em listing.thumbUrl. Step 4 global.
   * - "publication-batch": gera N variantes SEM escrever no listing.
   *   Operador atribui cada variante a uma publication via dropdown.
   */
  mode?: "listing" | "publication-batch";
  /**
   * Lista de publicações marcadas pelo operador. Obrigatório quando
   * mode='publication-batch'. Cada uma vira uma row na tabela de atribuição.
   * customVideoId atual é necessário pra preservar override de vídeo durante
   * o save (updatePublicationMedia exige ambos os campos).
   */
  publications?: Array<{
    id: number;
    label: string;
    isPrincipal: boolean;
    customVideoId: number | null;
  }>;
  /** Callback chamado após salvar atribuições (refresh do parent). */
  onPublicationAssignmentsSaved?: () => void;
};

const PROMPT_TEMPLATES = {
  promocional: {
    label: "🛒 Promocional",
    template: `Create a Shopee marketplace thumbnail (1:1 ratio, 1024x1024px) with strong promotional appeal.

Style: bright, eye-catching, retail-style
Composition: hero product centered, large size taking 60% of the canvas
Background: solid bright color (yellow or red) with subtle gradient
Text overlays (in Portuguese, large bold sans-serif):
- Top: "OFERTA" or "MELHOR PREÇO"
- Bottom-right corner: discount badge like "-30%" or "50% OFF"
- If product has variations (sizes/colors), show them as small icons in a strip at the bottom

Product details:
{{PRODUCT_INFO}}

Visual requirements:
- High saturation colors
- Bold drop shadows on product
- Clear, readable text even at small thumbnail size
- Optional: yellow burst/star shape behind discount text
- Avoid clutter, max 3 text elements total

Output: photorealistic, professional e-commerce style`,
  },

  premium: {
    label: "✨ Premium",
    template: `Create a premium Shopee marketplace thumbnail (1:1 ratio, 1024x1024px) with elegant, high-end retail aesthetic.

Style: minimalist, sophisticated, Apple-like product photography
Composition: product centered with breathing room, hero shot at slight 3/4 angle
Background: subtle gradient (white to light gray) OR soft blurred lifestyle scene
Lighting: studio-quality, soft shadows beneath product
Text overlays (minimal, Portuguese):
- Optional small product name at bottom (thin elegant font)
- NO heavy promotional badges
- If variations exist, show them as a clean horizontal strip below product

Product details:
{{PRODUCT_INFO}}

Visual requirements:
- Muted/neutral color palette
- Sharp focus on product
- Professional shadows (not harsh)
- Generous white space
- Sense of premium quality

Output: photorealistic, magazine-quality product photography`,
  },

  comparativo: {
    label: "🎨 Comparativo",
    template: `Create a comparative Shopee marketplace thumbnail (1:1 ratio, 1024x1024px) showing all product variations side by side.

Style: organized retail catalog
Composition: grid or horizontal arrangement of all variations equally spaced
Background: solid white or very light gradient
Labels: each variation clearly labeled below it in Portuguese (e.g., "30L", "50L", "100L" or "Branco", "Preto")
Top banner (optional): "VARIAÇÕES DISPONÍVEIS" or "ESCOLHA O TAMANHO"

Product details:
{{PRODUCT_INFO}}

Visual requirements:
- Equal sizing for all variations (same height/width)
- Subtle dividers or shadows between items
- Bold, readable labels at base of each variation
- Consistent angle/perspective across all items
- Optional: numbered or alphabetical order
- Highlight ONE variation as "MAIS VENDIDO" with a small badge

Output: photorealistic, professional e-commerce catalog style`,
  },
};

export default function ThumbGeneratorModal({
  isOpen,
  onClose,
  listingId,
  initialThumbUrl,
  onThumbGenerated,
  mode = "listing",
  publications,
  onPublicationAssignmentsSaved,
}: Props) {
  const isPublicationBatch = mode === "publication-batch";

  const [selected, setSelected] = useState<string[]>([]);
  const [customPromptText, setCustomPromptText] = useState<string>("");
  const [creativeMode, setCreativeMode] = useState<boolean>(true);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState<string | null>(null);
  const [variationCount, setVariationCount] = useState<number>(2);
  const [generatedUrls, setGeneratedUrls] = useState<string[]>([]);
  const [selectedGeneratedIdx, setSelectedGeneratedIdx] = useState<number | null>(null);

  const [selectedStyle, setSelectedStyle] = useState<"promocional" | "premium" | "comparativo" | null>(null);
  const [generatedPromptText, setGeneratedPromptText] = useState<string>("");
  const [pasteDropActive, setPasteDropActive] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const thumbFileInputRef = useRef<HTMLInputElement>(null);

  // Atribuição multi-store (só usado em mode='publication-batch'):
  // assignments[publicationId] = variantIdx (0..3) ou null = não atribuir.
  const [assignments, setAssignments] = useState<Record<number, number | null>>({});
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [assignResult, setAssignResult] = useState<{ savedIds: number[]; failedIds: number[] } | null>(null);

  // Reset states quando modal abre
  useEffect(() => {
    if (!isOpen) return;
    setSelected([]);
    setCustomPromptText("");
    setCreativeMode(true);
    setGeneratedUrl(initialThumbUrl || null);
    setZoomOpen(null);
    setVariationCount(isPublicationBatch ? Math.min(4, Math.max(1, publications?.length ?? 2)) : 2);
    setGeneratedUrls([]);
    setSelectedGeneratedIdx(null);
    setAssignments({});
    setAssignResult(null);
  }, [isOpen, initialThumbUrl, isPublicationBatch, publications?.length]);

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

        // Em modo publication-batch, pre-popula atribuições com mapeamento
        // 1:1 (publication[i] → variante[i]) quando count >= publications.length.
        if (isPublicationBatch && publications && publications.length > 0) {
          const initial: Record<number, number | null> = {};
          publications.forEach((p, idx) => {
            initial[p.id] = idx < urls.length ? idx : null;
          });
          setAssignments(initial);
        }
      },
      onError: (e) => toast.error(e.message),
    });

  // Mutation: atribui thumb a uma publication (Fase 5.1.B)
  const updatePublicationMediaMut = trpc.multiProduct.updatePublicationMedia.useMutation();

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

  const uploadThumbFileMutation = trpc.multiProduct.uploadThumbFile.useMutation({
    onSuccess: () => {
      toast.success("Thumb enviada!");
      if (onThumbGenerated) onThumbGenerated(""); // refresh do parent
      setUploadingThumb(false);
    },
    onError: (e) => {
      toast.error(e.message);
      setUploadingThumb(false);
    },
  });

  function handleUploadThumbFromPC(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem maior que 5MB. Reduza antes de enviar.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Formato inválido. Use JPG, PNG ou WEBP.");
      return;
    }
    setUploadingThumb(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(",")[1];
      uploadThumbFileMutation.mutate({
        id: listingId,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64Data,
      });
    };
    reader.onerror = () => {
      toast.error("Erro ao ler arquivo.");
      setUploadingThumb(false);
    };
    reader.readAsDataURL(file);
  }

  function generatePromptFromTemplate(style: "promocional" | "premium" | "comparativo") {
    const template = PROMPT_TEMPLATES[style];

    const productInfo = [
      `- ${selected.length} reference photos provided (use as visual guidance)`,
    ].filter(Boolean).join("\n");

    const finalPrompt = template.template.replace("{{PRODUCT_INFO}}", productInfo);

    setSelectedStyle(style);
    setGeneratedPromptText(finalPrompt);
    toast.success(`Prompt ${template.label} gerado!`);
  }

  async function handleCopyPrompt() {
    if (!generatedPromptText) {
      toast.error("Gere um prompt primeiro.");
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedPromptText);
      toast.success("Prompt copiado! Cole no ChatGPT ou Gemini.");
    } catch {
      toast.error("Falha ao copiar.");
    }
  }

  async function handlePasteImageFromClipboard() {
    setPasteDropActive(true);
    try {
      const items = await navigator.clipboard.read();

      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (!imageType) continue;

        const blob = await item.getType(imageType);

        if (blob.size > 5 * 1024 * 1024) {
          toast.error("Imagem maior que 5MB.");
          setPasteDropActive(false);
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64Data = dataUrl.split(",")[1];

          uploadThumbFileMutation.mutate({
            id: listingId,
            contentType: imageType as "image/jpeg" | "image/png" | "image/webp",
            base64Data,
          });
          setPasteDropActive(false);
        };
        reader.onerror = () => {
          toast.error("Erro ao processar imagem.");
          setPasteDropActive(false);
        };
        reader.readAsDataURL(blob);
        return;
      }

      toast.error("Nenhuma imagem no clipboard. Copie a imagem do ChatGPT primeiro.");
      setPasteDropActive(false);
    } catch (e: any) {
      console.error("Paste error:", e);
      toast.error("Falha ao acessar clipboard. Permita acesso e tente de novo.");
      setPasteDropActive(false);
    }
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
    setAssignments({});
    setAssignResult(null);

    generateBatchMutation.mutate({
      id: listingId,
      count: variationCount,
      selectedImageUrls: creativeMode ? [] : selected,
      customPrompt: customPromptText.trim(),
      creativeMode,
      // Fase 5.1.B: modo publication-batch gera SEM escrever em listing.thumbUrl
      skipListingUpdate: isPublicationBatch,
    });
  }

  // Salva atribuições em série pra cada publication que tem variant escolhida.
  // Updates paralelos no mesmo listing poderiam confundir o operador em caso
  // de falha parcial; série + status por id facilita o report.
  async function handleSaveAssignments() {
    if (!isPublicationBatch || !publications) return;
    const entries = Object.entries(assignments)
      .map(([id, idx]) => ({ pubId: Number(id), idx }))
      .filter((e) => e.idx !== null && e.idx !== undefined);

    if (entries.length === 0) {
      toast.error("Nenhuma atribuição selecionada.");
      return;
    }
    if (generatedUrls.length === 0) {
      toast.error("Gere as variantes antes de atribuir.");
      return;
    }

    setSavingAssignments(true);
    const savedIds: number[] = [];
    const failedIds: number[] = [];

    // Map id → customVideoId atual, pra preservar overrides de vídeo no save
    // (updatePublicationMedia exige ambos os campos no payload).
    const videoByPubId = new Map(publications.map((p) => [p.id, p.customVideoId]));

    for (const { pubId, idx } of entries) {
      const url = generatedUrls[idx!];
      if (!url) {
        failedIds.push(pubId);
        continue;
      }
      try {
        await updatePublicationMediaMut.mutateAsync({
          publicationId: pubId,
          customThumbUrl: url,
          customVideoId: videoByPubId.get(pubId) ?? null,
        });
        savedIds.push(pubId);
      } catch {
        failedIds.push(pubId);
      }
    }

    setSavingAssignments(false);
    setAssignResult({ savedIds, failedIds });

    if (failedIds.length === 0) {
      toast.success(`${savedIds.length} atribuição(ões) salva(s).`);
    } else {
      toast.warning(`${savedIds.length} salvas, ${failedIds.length} falharam.`);
    }
    if (onPublicationAssignmentsSaved) onPublicationAssignmentsSaved();
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

          {/* Conteúdo: 3 colunas — col 3 (Preview) maior pra thumbs em tamanho útil */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.5fr] gap-6 max-w-[1800px] mx-auto">
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
                      <div className="grid grid-cols-2 gap-2">
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

                <div className="border-t pt-3 mt-3 space-y-2">
                  <Label className="text-xs font-semibold">📝 Escolher estilo do prompt</Label>

                  <div className="grid grid-cols-3 gap-1">
                    {(Object.keys(PROMPT_TEMPLATES) as Array<keyof typeof PROMPT_TEMPLATES>).map((key) => {
                      const tpl = PROMPT_TEMPLATES[key];
                      const isActive = selectedStyle === key;
                      return (
                        <Button
                          key={key}
                          type="button"
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          className="text-xs h-auto py-2"
                          onClick={() => generatePromptFromTemplate(key)}
                        >
                          {tpl.label}
                        </Button>
                      );
                    })}
                  </div>

                  {generatedPromptText && (
                    <>
                      <Textarea
                        value={generatedPromptText}
                        onChange={(e) => setGeneratedPromptText(e.target.value)}
                        rows={5}
                        className="text-xs font-mono"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full"
                        onClick={handleCopyPrompt}
                      >
                        <Copy className="h-4 w-4 mr-2" /> Copiar prompt
                      </Button>
                    </>
                  )}
                </div>

                <div className="border-t pt-3 mt-3 space-y-2">
                  <Label className="text-xs font-semibold">🚀 Abrir gerador de imagem</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => window.open("https://chatgpt.com/", "_blank")}
                    >
                      🤖 ChatGPT
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => window.open("https://gemini.google.com/", "_blank")}
                    >
                      💎 Gemini
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground italic">
                    Cola o prompt + anexa o collage e gera a thumb
                  </p>
                </div>

                <div className="border-t pt-3 mt-3 space-y-2">
                  <Label className="text-xs font-semibold">📤 Mandar thumb pro sistema</Label>

                  <input
                    ref={thumbFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadThumbFromPC(f);
                      e.target.value = "";
                    }}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={uploadingThumb}
                    onClick={() => thumbFileInputRef.current?.click()}
                  >
                    {uploadingThumb ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</>
                    ) : (
                      <><Upload className="h-4 w-4 mr-2" /> Enviar arquivo do computador</>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={uploadingThumb || pasteDropActive}
                    onClick={handlePasteImageFromClipboard}
                  >
                    {pasteDropActive ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Lendo clipboard...</>
                    ) : (
                      <><Clipboard className="h-4 w-4 mr-2" /> Colar imagem (Ctrl+V do ChatGPT)</>
                    )}
                  </Button>

                  <p className="text-xs text-muted-foreground italic">
                    💡 No ChatGPT: botão direito na imagem → "Copiar imagem". Aí clica em "Colar imagem" aqui.
                  </p>
                </div>
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
                        : isPublicationBatch
                        ? `✨ ${generatedUrls.length} variações geradas! Marque as contas embaixo de cada thumb:`
                        : `✨ ${generatedUrls.length} variações geradas! Clique na que quiser usar:`}
                    </p>
                    <div className={`grid gap-4 ${generatedUrls.length <= 2 ? "grid-cols-1" : "grid-cols-2"}`}>
                      {generatedUrls.map((url, idx) => {
                        const isSelected = selectedGeneratedIdx === idx;
                        return (
                          <div key={url} className="space-y-2">
                            <div
                              className={`relative rounded-lg overflow-hidden border-4 transition cursor-pointer ${
                                isSelected && !isPublicationBatch
                                  ? "border-orange-500 ring-2 ring-orange-200 shadow-lg"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                              onClick={() => {
                                setSelectedGeneratedIdx(idx);
                                setGeneratedUrl(url);
                              }}
                            >
                              <img src={url} alt={`Variação ${idx + 1}`} className="w-full" />
                              <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded font-semibold">
                                Variante {String.fromCharCode(65 + idx)}
                              </div>
                              {isSelected && !isPublicationBatch && (
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

                            {/* Atribuição multi-store: checkboxes de contas embaixo de cada thumb */}
                            {isPublicationBatch && publications && publications.length > 0 && (
                              <div className="border border-gray-200 rounded-lg p-2 bg-gray-50/50 space-y-1">
                                <div className="text-[11px] font-medium text-muted-foreground mb-1">
                                  Atribuir a:
                                </div>
                                {publications.map((pub) => {
                                  const isHere = assignments[pub.id] === idx;
                                  const isElsewhere =
                                    assignments[pub.id] !== undefined &&
                                    assignments[pub.id] !== null &&
                                    assignments[pub.id] !== idx;
                                  return (
                                    <label
                                      key={pub.id}
                                      className={`flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-white ${
                                        isElsewhere ? "opacity-60" : ""
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isHere}
                                        disabled={savingAssignments}
                                        onChange={(e) => {
                                          setAssignments((prev) => ({
                                            ...prev,
                                            // Radio: marcar aqui desmarca de outras variantes automaticamente
                                            // (assignments mapeia pubId → variantIdx, então atualizar a chave
                                            // já remove de outra variante).
                                            [pub.id]: e.target.checked ? idx : null,
                                          }));
                                        }}
                                        className="h-3.5 w-3.5 accent-orange-500"
                                      />
                                      <span className="text-xs flex-1 truncate">{pub.label}</span>
                                      {pub.isPrincipal && (
                                        <span className="text-[9px] text-yellow-700">⭐</span>
                                      )}
                                      {isElsewhere && (
                                        <span
                                          className="text-[9px] text-muted-foreground"
                                          title={`Atualmente em Variante ${String.fromCharCode(65 + (assignments[pub.id] as number))}`}
                                        >
                                          → {String.fromCharCode(65 + (assignments[pub.id] as number))}
                                        </span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!isPublicationBatch && (
                      <p className="text-xs text-muted-foreground text-center">
                        Variação selecionada: {selectedGeneratedIdx !== null ? String.fromCharCode(65 + selectedGeneratedIdx) : "—"}
                      </p>
                    )}
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

          {/* Status compacto de save (substituiu painel rodapé da Fase 5.1.B —
              atribuição agora fica embaixo de cada thumb na coluna 3). */}
          {isPublicationBatch && publications && generatedUrls.length > 0 && assignResult && (
            <div className="border-t bg-orange-50/30 px-6 py-2 shrink-0">
              <div className="text-xs flex items-center gap-3">
                <span className="font-medium">Resultado do save:</span>
                {assignResult.savedIds.length > 0 && (
                  <span className="text-green-700">
                    <Check className="h-3 w-3 inline mr-0.5" />
                    {assignResult.savedIds.length} salva(s)
                  </span>
                )}
                {assignResult.failedIds.length > 0 && (
                  <span className="text-red-700">{assignResult.failedIds.length} falhou(aram)</span>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <DialogFooter className="flex justify-between gap-2 px-6 py-4 border-t shrink-0 bg-white">
            <Button variant="outline" onClick={onClose}>
              {isPublicationBatch ? "Fechar" : "Cancelar"}
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
                    {isPublicationBatch ? `Gerar ${variationCount} variante(s)` : "Gerar Thumb"}
                  </>
                )}
              </Button>
              {/* Modo listing: botão "Usar esta thumb" tradicional */}
              {!isPublicationBatch && generatedUrl && (
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
              {/* Modo publication-batch: salvar atribuições */}
              {isPublicationBatch && publications && generatedUrls.length > 0 && (() => {
                const attribuidas = Object.values(assignments).filter((v) => v !== null && v !== undefined).length;
                return (
                  <Button
                    onClick={handleSaveAssignments}
                    disabled={savingAssignments || attribuidas === 0}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {savingAssignments ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
                    ) : (
                      <><Check className="h-4 w-4 mr-2" /> Salvar {attribuidas}/{publications.length} atribuições</>
                    )}
                  </Button>
                );
              })()}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de zoom — Fase 5.1.E: lightbox grande (90vw × 90vh) com
          object-contain pra preservar aspect ratio sem cortar nada. */}
      {zoomOpen && (
        <Dialog open={!!zoomOpen} onOpenChange={() => setZoomOpen(null)}>
          <DialogContent className="!max-w-[90vw] !w-[90vw] !max-h-[90vh] p-2 sm:p-4 flex items-center justify-center">
            <img
              src={zoomOpen}
              alt="Zoom"
              className="max-w-full max-h-[85vh] object-contain rounded"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
