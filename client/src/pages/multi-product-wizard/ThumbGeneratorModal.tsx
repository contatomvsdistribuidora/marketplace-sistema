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
import {
  THUMB_STYLES,
  THUMB_BADGES,
  THUMB_COLORS,
  MAX_THUMB_BADGES,
  type ThumbStyle,
  type ThumbBadge,
  type ThumbColor,
} from "@shared/thumb-styles";
import {
  THUMB_PROMPT_BASES,
  THUMB_TOGGLES_COMPOSICAO,
  THUMB_TOGGLES_CONTEXTO,
  THUMB_TOGGLES_ENFASE,
  type ThumbPromptBase,
  type ThumbToggleComposicao,
  type ThumbToggleContexto,
  type ThumbToggleEnfase,
} from "@shared/thumb-prompts";

type Props = {
  listingId: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentThumbUrl?: string | null;
};

const MAX_REFS = 16;
const DEFAULT_STYLE: ThumbStyle = "mercadao";
const DEFAULT_PROMPT_BASE: ThumbPromptBase = "top-vendedor";

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
  const [selectedStyle, setSelectedStyle] = useState<ThumbStyle>(DEFAULT_STYLE);
  const [selectedBadges, setSelectedBadges] = useState<ThumbBadge[]>([]);
  const [selectedColor, setSelectedColor] = useState<ThumbColor | undefined>(undefined);
  const [selectedPromptBase, setSelectedPromptBase] = useState<ThumbPromptBase>(DEFAULT_PROMPT_BASE);
  const [selectedComposicao, setSelectedComposicao] = useState<ThumbToggleComposicao[]>([]);
  const [selectedContexto, setSelectedContexto] = useState<ThumbToggleContexto[]>([]);
  const [selectedEnfase, setSelectedEnfase] = useState<ThumbToggleEnfase[]>([]);
  const [customPromptMode, setCustomPromptMode] = useState<boolean>(false);
  const [customPromptText, setCustomPromptText] = useState<string>("");
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
    setSelectedStyle(DEFAULT_STYLE);
    setSelectedBadges([]);
    setSelectedColor(undefined);
    setSelectedPromptBase(DEFAULT_PROMPT_BASE);
    setSelectedComposicao([]);
    setSelectedContexto([]);
    setSelectedEnfase([]);
    setCustomPromptMode(false);
    setCustomPromptText("");
    setGeneratedUrl(null);
    setZoomOpen(false);
  }, [isOpen]);

  // Quando o prompt base muda, marca os toggles padrão dele
  useEffect(() => {
    if (!selectedPromptBase) return;
    const base = THUMB_PROMPT_BASES[selectedPromptBase];
    setSelectedComposicao(base.defaultToggles.composicao);
    setSelectedContexto(base.defaultToggles.contexto);
    setSelectedEnfase(base.defaultToggles.enfase);
  }, [selectedPromptBase]);

  function toggleComposicao(t: ThumbToggleComposicao) {
    setSelectedComposicao((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }
  function toggleContexto(t: ThumbToggleContexto) {
    setSelectedContexto((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }
  function toggleEnfase(t: ThumbToggleEnfase) {
    setSelectedEnfase((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  function toggleBadge(b: ThumbBadge) {
    setSelectedBadges((prev) => {
      if (prev.includes(b)) return prev.filter((x) => x !== b);
      if (prev.length >= MAX_THUMB_BADGES) {
        toast.error(`Máximo ${MAX_THUMB_BADGES} selos.`);
        return prev;
      }
      return [...prev, b];
    });
  }

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
      style: selectedStyle,
      badges: selectedBadges.length > 0 ? selectedBadges : undefined,
      color: selectedColor,
      promptBase: customPromptMode ? undefined : selectedPromptBase,
      composicao: customPromptMode || selectedComposicao.length === 0 ? undefined : selectedComposicao,
      contexto: customPromptMode || selectedContexto.length === 0 ? undefined : selectedContexto,
      enfase: customPromptMode || selectedEnfase.length === 0 ? undefined : selectedEnfase,
      customPrompt: customPromptMode && customPromptText.trim() ? customPromptText.trim() : undefined,
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
      <DialogContent className="!max-w-none !w-screen !h-screen !max-h-screen !rounded-none p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0 bg-white shadow-sm">
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles className="h-6 w-6" />
            Gerar Thumb com IA
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full max-w-[1800px] mx-auto">
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
                <div className="grid grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto p-2 border rounded">
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
                            <div className="absolute top-1 right-1 bg-orange-500 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold">
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

          {/* COLUNA CENTRAL — Estilo, selos e cor */}
          <div className="space-y-4">
            <div>
              <Label>🎨 Estilo da thumb</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Define a "vibe" visual da imagem.
              </p>
              <div className="grid grid-cols-2 gap-3 max-h-[40vh] overflow-y-auto pr-1">
                {(Object.entries(THUMB_STYLES) as [ThumbStyle, typeof THUMB_STYLES[ThumbStyle]][]).map(
                  ([key, meta]) => {
                    const active = selectedStyle === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedStyle(key)}
                        className={`text-left border-2 rounded p-3 transition ${
                          active
                            ? "border-orange-500 bg-orange-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center gap-1 text-base font-medium">
                          <span>{meta.icon}</span>
                          <span>{meta.label}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                          {meta.description}
                        </p>
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            <div>
              <Label>
                🏷️ Selos ({selectedBadges.length}/{MAX_THUMB_BADGES})
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Adiciona selos visuais na thumb.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.entries(THUMB_BADGES) as [ThumbBadge, typeof THUMB_BADGES[ThumbBadge]][]).map(
                  ([key, meta]) => {
                    const active = selectedBadges.includes(key);
                    const disabled = !active && selectedBadges.length >= MAX_THUMB_BADGES;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleBadge(key)}
                        disabled={disabled}
                        className={`text-xs px-3 py-1.5 rounded-full border-2 transition ${
                          active
                            ? "border-orange-500 bg-orange-100 text-orange-900 font-medium"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                        } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        {meta.label}
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            <div>
              <Label>🌈 Cor dominante (opcional)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Sobrescreve a paleta do estilo escolhido.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedColor(undefined)}
                  className={`text-[11px] px-2.5 py-1 rounded border-2 transition ${
                    selectedColor === undefined
                      ? "border-orange-500 bg-orange-50 text-orange-900 font-medium"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                  title="Usa a paleta do estilo"
                >
                  Automática
                </button>
                {(Object.entries(THUMB_COLORS) as [ThumbColor, typeof THUMB_COLORS[ThumbColor]][]).map(
                  ([key, meta]) => {
                    const active = selectedColor === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedColor(key)}
                        className={`w-10 h-10 rounded-full border-2 transition flex items-center justify-center ${
                          active ? "border-orange-500 ring-2 ring-orange-200" : "border-gray-300"
                        }`}
                        style={{ backgroundColor: meta.hex }}
                        title={meta.label}
                      >
                        {active && (
                          <span className="text-white text-xs font-bold drop-shadow">✓</span>
                        )}
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            {/* SEÇÃO: PROMPT BASE (estratégia narrativa) */}
            <div>
              <Label>🎬 Estratégia narrativa</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Define como organizar e contar a história do produto.
              </p>
              <div className={`grid grid-cols-2 gap-2 ${customPromptMode ? "opacity-40 pointer-events-none" : ""}`}>
                {(Object.entries(THUMB_PROMPT_BASES) as [ThumbPromptBase, typeof THUMB_PROMPT_BASES[ThumbPromptBase]][]).map(
                  ([key, meta]) => {
                    const active = selectedPromptBase === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedPromptBase(key)}
                        className={`text-left border-2 rounded p-2 transition ${
                          active
                            ? "border-orange-500 bg-orange-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center gap-1 text-sm font-medium">
                          <span>{meta.icon}</span>
                          <span>{meta.label}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                          {meta.description}
                        </p>
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            {/* SEÇÃO: TOGGLES NARRATIVOS (Composição / Contexto / Ênfase) */}
            <div className={customPromptMode ? "opacity-40 pointer-events-none" : ""}>
              <Label>🎭 Ajuste fino (toggles)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Personalize a narrativa. Marque quantos quiser.
              </p>

              {/* Composição */}
              <div className="mb-2">
                <p className="text-xs font-medium text-gray-700 mb-1">Composição:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(THUMB_TOGGLES_COMPOSICAO) as [ThumbToggleComposicao, typeof THUMB_TOGGLES_COMPOSICAO[ThumbToggleComposicao]][]).map(
                    ([key, meta]) => {
                      const active = selectedComposicao.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleComposicao(key)}
                          className={`text-xs px-2.5 py-1 rounded-full border-2 transition ${
                            active
                              ? "border-blue-500 bg-blue-100 text-blue-900 font-medium"
                              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                          }`}
                        >
                          {meta.label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              {/* Contexto */}
              <div className="mb-2">
                <p className="text-xs font-medium text-gray-700 mb-1">Contexto:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(THUMB_TOGGLES_CONTEXTO) as [ThumbToggleContexto, typeof THUMB_TOGGLES_CONTEXTO[ThumbToggleContexto]][]).map(
                    ([key, meta]) => {
                      const active = selectedContexto.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleContexto(key)}
                          className={`text-xs px-2.5 py-1 rounded-full border-2 transition ${
                            active
                              ? "border-purple-500 bg-purple-100 text-purple-900 font-medium"
                              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                          }`}
                        >
                          {meta.label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              {/* Ênfase */}
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1">Ênfase:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(THUMB_TOGGLES_ENFASE) as [ThumbToggleEnfase, typeof THUMB_TOGGLES_ENFASE[ThumbToggleEnfase]][]).map(
                    ([key, meta]) => {
                      const active = selectedEnfase.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleEnfase(key)}
                          className={`text-xs px-2.5 py-1 rounded-full border-2 transition ${
                            active
                              ? "border-green-500 bg-green-100 text-green-900 font-medium"
                              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                          }`}
                        >
                          {meta.label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            </div>

            {/* SEÇÃO: MODO AVANÇADO — editar prompt manualmente */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>✏️  Prompt manual (avançado)</Label>
                <button
                  type="button"
                  onClick={() => setCustomPromptMode(!customPromptMode)}
                  className={`text-xs px-3 py-1 rounded border transition ${
                    customPromptMode
                      ? "bg-orange-100 border-orange-500 text-orange-900 font-medium"
                      : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {customPromptMode ? "✓ Modo manual ativo" : "Ativar edição manual"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {customPromptMode
                  ? "⚠️  Modo manual: estratégia e toggles acima ficam desativados. O texto abaixo é enviado direto pra IA."
                  : "Edite o prompt completo manualmente (substitui estratégia + toggles)."}
              </p>
              <Textarea
                rows={6}
                value={customPromptText}
                onChange={(e) => setCustomPromptText(e.target.value)}
                placeholder={
                  customPromptMode
                    ? "Escreva aqui o prompt completo que será enviado pra IA..."
                    : "Ative o modo manual acima pra escrever um prompt customizado"
                }
                disabled={!customPromptMode}
                className="text-xs font-mono"
                maxLength={5000}
              />
              {customPromptMode && (
                <div className="flex justify-between items-center mt-1">
                  <p className="text-[10px] text-muted-foreground">
                    {customPromptText.length}/5000 caracteres
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomPromptMode(false);
                      setCustomPromptText("");
                    }}
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    ↺ Restaurar automático
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* COLUNA DIREITA — Preview */}
          <div className="space-y-3">
            <Label>🖼️ Preview</Label>
            <div className="max-w-2xl mx-auto w-full">
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
                <p className="text-xs text-green-600 text-center mt-2">
                  ✨ Thumb gerada! Clique pra ampliar ou em "Regerar" pra tentar de novo.
                </p>
              )}
              <div className="mt-3 border rounded p-3 bg-gray-50 text-xs text-gray-700 space-y-1">
                <p className="font-medium text-sm text-gray-900">Configuração usada</p>
                <p>
                  <span className="text-muted-foreground">Estilo:</span>{" "}
                  {THUMB_STYLES[selectedStyle].icon} {THUMB_STYLES[selectedStyle].label}
                </p>
                <p>
                  <span className="text-muted-foreground">Fotos:</span> {selected.length}/{MAX_REFS}
                </p>
                <p>
                  <span className="text-muted-foreground">Selos:</span>{" "}
                  {selectedBadges.length > 0
                    ? selectedBadges.map((b) => THUMB_BADGES[b].label).join(", ")
                    : "nenhum"}
                </p>
                <p>
                  <span className="text-muted-foreground">Cor:</span>{" "}
                  {selectedColor ? THUMB_COLORS[selectedColor].label : "automática"}
                </p>
                {headerText.trim() && (
                  <p className="truncate">
                    <span className="text-muted-foreground">Header:</span> {headerText.trim()}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>

        <DialogFooter className="flex justify-between gap-2 px-6 py-4 border-t shrink-0 bg-white">
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
