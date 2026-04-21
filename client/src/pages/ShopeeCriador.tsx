import { useState, useEffect } from "react";
import { trpc } from "../lib/trpc";
import {
  Search, Package, ChevronRight, Star, Loader2,
  Plus, Trash2, Sparkles, Hash, Ruler, Layers,
  Palette, PenLine, ArrowLeft, ArrowRight, Check,
  CheckCircle2, X, PlusCircle,
} from "lucide-react";

const PAGE_SIZE = 50;

// ─── Tipos ────────────────────────────────────────────────────────────────────

type VariationType = "quantidade" | "tamanho" | "material" | "cor" | "personalizado";
type WizardStep = "A" | "B" | "C" | "D";

interface VariationOption {
  id: string;
  label: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  price: string;
  stock: string;
}

interface VariationGroup {
  id: string;
  type: VariationType;
  typeName: string;
  options: VariationOption[];
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyOption(label = ""): VariationOption {
  return { id: uid(), label, weight: "", length: "", width: "", height: "", price: "", stock: "" };
}

const VARIATION_TYPES: { type: VariationType; label: string; icon: React.ReactNode; examples: string }[] = [
  { type: "quantidade",    label: "Quantidade",    icon: <Hash className="w-5 h-5" />,    examples: "50un, 100un, 200un" },
  { type: "tamanho",       label: "Tamanho",       icon: <Ruler className="w-5 h-5" />,   examples: "P, M, G ou 10L, 50L" },
  { type: "material",      label: "Material",      icon: <Layers className="w-5 h-5" />,  examples: "Plástico, Metal, Tecido" },
  { type: "cor",           label: "Cor",           icon: <Palette className="w-5 h-5" />, examples: "Vermelho, Azul, Preto" },
  { type: "personalizado", label: "Personalizado", icon: <PenLine className="w-5 h-5" />, examples: "Campo livre" },
];

// ─── Tela 1 – Lista de produtos ───────────────────────────────────────────────

export default function ShopeeCriador() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data: accounts } = trpc.shopee.getAccounts.useQuery();
  const activeAccounts = accounts?.filter((a: any) => a.isActive) ?? [];

  const offset = (page - 1) * PAGE_SIZE;
  const { data: productsData, isLoading, error } = trpc.shopee.getProducts.useQuery(
    { accountId: selectedAccountId!, offset, limit: PAGE_SIZE, search: debouncedSearch || undefined },
    { enabled: !!selectedAccountId }
  );

  const products: any[] = productsData?.products ?? [];
  const total: number = productsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleSelectAccount(id: number) {
    setSelectedAccountId(id);
    setPage(1);
    setSearch("");
    setDebouncedSearch("");
    setSelectedProduct(null);
  }

  if (selectedProduct) {
    return <ProductDetail product={selectedProduct} onBack={() => setSelectedProduct(null)} />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Criar Anúncio</h1>
        <p className="text-gray-500 mt-1">Selecione um produto para criar variações de anúncio na Shopee</p>
      </div>

      {/* Seletor de conta */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {activeAccounts.map((acc: any) => (
          <button
            key={acc.id}
            onClick={() => handleSelectAccount(acc.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
              selectedAccountId === acc.id
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-white text-gray-700 border-gray-300 hover:border-orange-400"
            }`}
          >
            {acc.shopName || `Loja ${acc.shopId}`}
          </button>
        ))}
        {activeAccounts.length === 0 && (
          <p className="text-gray-400 text-sm">Nenhuma conta Shopee ativa</p>
        )}
      </div>

      {!selectedAccountId && (
        <div className="text-center py-20 text-gray-400">
          <Star className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>Selecione uma loja para começar</p>
        </div>
      )}

      {selectedAccountId && (
        <>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Buscar produto por nome..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
            />
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-20 gap-3 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Carregando produtos...</span>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              Erro: {error.message}
            </div>
          )}

          {!isLoading && !error && (
            <>
              <p className="text-sm text-gray-500 mb-3">
                {debouncedSearch ? `${total} resultado(s) para "${debouncedSearch}"` : `${total} produtos`}
              </p>

              {products.length === 0 ? (
                <div className="text-center py-20 text-gray-400">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Nenhum produto encontrado</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {products.map((product: any) => (
                    <div
                      key={product.id}
                      onClick={() => setSelectedProduct(product)}
                      className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-orange-300 transition-all cursor-pointer"
                    >
                      <div className="flex gap-3 items-start">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.itemName} className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                        ) : (
                          <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Package className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug">{product.itemName || "Sem título"}</p>
                          <p className="text-xs text-gray-400 mt-1">ID: {product.itemId}</p>
                          {product.price && (
                            <p className="text-sm font-semibold text-orange-600 mt-1">R$ {Number(product.price).toFixed(2)}</p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-6">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-50 transition">Anterior</button>
                  <span className="text-sm text-gray-600">Página {page} de {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-50 transition">Próxima</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tela 2 – Detalhe do produto ──────────────────────────────────────────────

function ProductDetail({ product, onBack }: { product: any; onBack: () => void }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [savedVariations, setSavedVariations] = useState<VariationGroup[]>([]);

  function handleSaveVariation(group: VariationGroup) {
    setSavedVariations(v => [...v, group]);
    setWizardOpen(false);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 mb-6 text-sm transition">
        <ArrowLeft className="w-4 h-4" /> Voltar para lista
      </button>

      {/* Dados atuais do produto */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex gap-5 items-start">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.itemName} className="w-28 h-28 object-cover rounded-xl flex-shrink-0 border border-gray-100" />
          ) : (
            <div className="w-28 h-28 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Package className="w-10 h-10 text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 leading-snug">{product.itemName || "Sem título"}</h2>
            <p className="text-xs text-gray-400 mt-1">ID: {product.itemId}</p>
            {product.price && <p className="text-base font-bold text-orange-600 mt-2">R$ {Number(product.price).toFixed(2)}</p>}
          </div>
        </div>

        {product.description && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Descrição</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-5">{product.description}</p>
          </div>
        )}

        <div className="mt-5 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Peso e medidas</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoBox label="Peso" value={product.weight ? `${product.weight} kg` : "—"} />
            <InfoBox label="Comprimento" value={product.dimensionLength ? `${product.dimensionLength} cm` : "—"} />
            <InfoBox label="Largura" value={product.dimensionWidth ? `${product.dimensionWidth} cm` : "—"} />
            <InfoBox label="Altura" value={product.dimensionHeight ? `${product.dimensionHeight} cm` : "—"} />
          </div>
        </div>
      </div>

      {/* Variações já criadas */}
      {savedVariations.length > 0 && (
        <div className="mb-6 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Variações criadas</p>
          {savedVariations.map((group, gi) => (
            <div key={group.id} className="bg-white border border-orange-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-semibold text-gray-800">{group.typeName}</span>
                  <span className="text-xs text-gray-400">{group.options.length} opção(ões)</span>
                </div>
                <button onClick={() => setSavedVariations(v => v.filter((_, i) => i !== gi))} className="text-gray-300 hover:text-red-400 transition">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.options.map(opt => (
                  <span key={opt.id} className="px-2.5 py-1 bg-orange-50 text-orange-700 text-xs rounded-full border border-orange-200">
                    {opt.label}
                    {opt.weight && ` · ${opt.weight}kg`}
                    {opt.price && ` · R$${opt.price}`}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Botão principal */}
      <button
        onClick={() => setWizardOpen(true)}
        className="w-full flex items-center justify-center gap-3 py-5 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg transition shadow-md shadow-orange-200 mb-4"
      >
        <PlusCircle className="w-6 h-6" /> Criar Variação de Anúncio
      </button>

      {wizardOpen && (
        <VariationWizard
          product={product}
          onSave={handleSaveVariation}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Tela 3 – Wizard ─────────────────────────────────────────────────────────

function VariationWizard({
  product,
  onSave,
  onClose,
}: {
  product: any;
  onSave: (group: VariationGroup) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<WizardStep>("A");
  const [selectedType, setSelectedType] = useState<VariationType | null>(null);
  const [optionLabels, setOptionLabels] = useState<string[]>([""]);
  const [optionDetails, setOptionDetails] = useState<VariationOption[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  const optimizeMutation = trpc.shopee.optimizeTitle.useMutation();

  const STEPS: { key: WizardStep; label: string }[] = [
    { key: "A", label: "Tipo" },
    { key: "B", label: "Opções" },
    { key: "C", label: "Detalhes" },
    { key: "D", label: "Revisão" },
  ];

  const currentStepIndex = STEPS.findIndex(s => s.key === step);
  const typeName = VARIATION_TYPES.find(t => t.type === selectedType)?.label ?? "";

  // ── Etapa A ──
  function goAtoB() {
    if (!selectedType) return;
    setStep("B");
  }

  // ── Etapa B ──
  function updateLabel(idx: number, val: string) {
    setOptionLabels(labels => labels.map((l, i) => (i === idx ? val : l)));
  }

  function addLabel() {
    setOptionLabels(l => [...l, ""]);
  }

  function removeLabel(idx: number) {
    setOptionLabels(l => l.filter((_, i) => i !== idx));
  }

  async function suggestWithAI() {
    try {
      const result = await optimizeMutation.mutateAsync({ productId: product.id });
      setAiSuggestions(result.keywords?.slice(0, 5) ?? []);
    } catch {
      setAiSuggestions([]);
    }
  }

  function applySuggestion(s: string) {
    setOptionLabels(labels => {
      const empty = labels.findIndex(l => l.trim() === "");
      if (empty >= 0) return labels.map((l, i) => (i === empty ? s : l));
      return [...labels, s];
    });
    setAiSuggestions(prev => prev.filter(x => x !== s));
  }

  function goBtoC() {
    const filled = optionLabels.filter(l => l.trim() !== "");
    if (filled.length === 0) return;
    setOptionDetails(filled.map(label => emptyOption(label)));
    setStep("C");
  }

  // ── Etapa C ──
  function updateDetail(id: string, field: keyof Omit<VariationOption, "id" | "label">, value: string) {
    setOptionDetails(opts => opts.map(o => (o.id === id ? { ...o, [field]: value } : o)));
  }

  function suggestDimensions(id: string) {
    setOptionDetails(opts => opts.map(o => {
      if (o.id !== id) return o;
      return {
        ...o,
        weight: o.weight || product.weight || "0.5",
        length: o.length || product.dimensionLength || "20",
        width:  o.width  || product.dimensionWidth  || "15",
        height: o.height || product.dimensionHeight || "10",
      };
    }));
  }

  // ── Etapa D ──
  function handleSave() {
    onSave({ id: uid(), type: selectedType!, typeName, options: optionDetails });
  }

  function stepBack() {
    const prev = ({ B: "A", C: "B", D: "C" } as Record<string, WizardStep>)[step];
    if (prev) setStep(prev);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Criar Variação de Anúncio</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition"><X className="w-5 h-5" /></button>
        </div>

        {/* Barra de progresso */}
        <div className="flex items-center px-6 py-3 border-b border-gray-100 gap-0">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <div className="flex items-center gap-1.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                  step === s.key
                    ? "bg-orange-500 border-orange-500 text-white"
                    : currentStepIndex > i
                    ? "bg-orange-100 border-orange-300 text-orange-600"
                    : "bg-gray-100 border-gray-300 text-gray-400"
                }`}>
                  {currentStepIndex > i ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${step === s.key ? "text-orange-600" : "text-gray-400"}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 rounded-full transition-all ${currentStepIndex > i ? "bg-orange-300" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ETAPA A – Tipo */}
          {step === "A" && (
            <div>
              <p className="text-sm text-gray-600 mb-4">Qual tipo de variação você quer criar?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {VARIATION_TYPES.map(vt => (
                  <button
                    key={vt.type}
                    onClick={() => setSelectedType(vt.type)}
                    className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                      selectedType === vt.type
                        ? "border-orange-500 bg-orange-50"
                        : "border-gray-200 hover:border-orange-300 bg-white"
                    }`}
                  >
                    <span className={`mt-0.5 ${selectedType === vt.type ? "text-orange-500" : "text-gray-400"}`}>{vt.icon}</span>
                    <div className="flex-1">
                      <p className={`text-sm font-semibold ${selectedType === vt.type ? "text-orange-700" : "text-gray-800"}`}>{vt.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{vt.examples}</p>
                    </div>
                    {selectedType === vt.type && <CheckCircle2 className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ETAPA B – Opções */}
          {step === "B" && (
            <div>
              <p className="text-sm text-gray-600 mb-1">
                Digite cada opção da variação <span className="font-semibold text-gray-800">({typeName})</span>:
              </p>
              <p className="text-xs text-gray-400 mb-4">Ex: "100 unidades", "Azul", "Grande"...</p>

              <div className="space-y-2 mb-3">
                {optionLabels.map((label, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={label}
                      onChange={e => updateLabel(idx, e.target.value)}
                      placeholder={`Opção ${idx + 1}`}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                    {optionLabels.length > 1 && (
                      <button onClick={() => removeLabel(idx)} className="text-gray-300 hover:text-red-400 transition flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={addLabel} className="flex items-center gap-1.5 text-orange-600 text-sm font-medium hover:text-orange-700 transition mb-5">
                <Plus className="w-4 h-4" /> Adicionar opção
              </button>

              <div className="border border-dashed border-orange-200 rounded-xl p-4 bg-orange-50">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-orange-700">Sugerir com IA</p>
                  <button
                    onClick={suggestWithAI}
                    disabled={optimizeMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg transition disabled:opacity-60"
                  >
                    {optimizeMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Sparkles className="w-3.5 h-3.5" />}
                    Sugerir com IA
                  </button>
                </div>
                {aiSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {aiSuggestions.map(s => (
                      <button key={s} onClick={() => applySuggestion(s)} className="px-2.5 py-1 bg-white border border-orange-300 text-orange-700 text-xs rounded-full hover:bg-orange-100 transition">
                        + {s}
                      </button>
                    ))}
                  </div>
                )}
                {optimizeMutation.isError && <p className="text-xs text-red-500 mt-2">Erro ao buscar sugestões.</p>}
                {optimizeMutation.isSuccess && !optimizeMutation.isPending && aiSuggestions.length === 0 && (
                  <p className="text-xs text-gray-400 mt-2">Nenhuma sugestão disponível.</p>
                )}
              </div>
            </div>
          )}

          {/* ETAPA C – Detalhes */}
          {step === "C" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-1">Preencha os detalhes de cada opção:</p>
              {optionDetails.map((opt, idx) => (
                <div key={opt.id} className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-800">
                      <span className="text-orange-500">{idx + 1}.</span> {opt.label}
                    </p>
                    <button
                      onClick={() => suggestDimensions(opt.id)}
                      className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 border border-orange-200 rounded-lg px-2 py-1 bg-white transition"
                    >
                      <Sparkles className="w-3 h-3" /> IA preenche dimensões
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {([
                      { field: "weight" as const, label: "Peso (kg)",        placeholder: "0.50", step: "0.01" },
                      { field: "length" as const, label: "Comprimento (cm)", placeholder: "20",   step: "0.1"  },
                      { field: "width"  as const, label: "Largura (cm)",     placeholder: "15",   step: "0.1"  },
                      { field: "height" as const, label: "Altura (cm)",      placeholder: "10",   step: "0.1"  },
                      { field: "price"  as const, label: "Preço (R$)",       placeholder: "0.00", step: "0.01" },
                      { field: "stock"  as const, label: "Estoque",          placeholder: "0",    step: "1"    },
                    ]).map(({ field, label, placeholder, step: stepVal }) => (
                      <div key={field}>
                        <label className="block text-xs text-gray-500 mb-1">{label}</label>
                        <input
                          type="number"
                          min="0"
                          step={stepVal}
                          placeholder={placeholder}
                          value={(opt as any)[field]}
                          onChange={e => updateDetail(opt.id, field, e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ETAPA D – Revisão */}
          {step === "D" && (
            <div>
              <p className="text-sm text-gray-600 mb-4">Revise antes de publicar:</p>
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-5">
                <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-3">
                  {typeName} · {optionDetails.length} opção(ões)
                </p>
                <div className="space-y-3">
                  {optionDetails.map((opt, idx) => (
                    <div key={opt.id} className="bg-white rounded-lg border border-orange-100 p-3">
                      <p className="text-sm font-semibold text-gray-800 mb-2">
                        <span className="text-orange-500">{idx + 1}.</span> {opt.label}
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                        {opt.weight && <span>Peso: <b className="text-gray-700">{opt.weight} kg</b></span>}
                        {opt.length && <span>Comp: <b className="text-gray-700">{opt.length} cm</b></span>}
                        {opt.width  && <span>Larg: <b className="text-gray-700">{opt.width} cm</b></span>}
                        {opt.height && <span>Alt: <b className="text-gray-700">{opt.height} cm</b></span>}
                        {opt.price  && <span>Preço: <b className="text-orange-600">R${opt.price}</b></span>}
                        {opt.stock  && <span>Estoque: <b className="text-gray-700">{opt.stock}</b></span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => alert("Publicação na Shopee em breve")}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition mb-3"
              >
                <Sparkles className="w-4 h-4" /> Publicar na Shopee
              </button>
              <button
                onClick={() => setStep("C")}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 transition"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar e editar
              </button>
            </div>
          )}
        </div>

        {/* Footer de navegação */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
          {step !== "A" ? (
            <button onClick={stepBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
          ) : (
            <div />
          )}

          {step === "A" && (
            <button onClick={goAtoB} disabled={!selectedType} className="flex items-center gap-1.5 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition">
              Próximo <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === "B" && (
            <button onClick={goBtoC} disabled={optionLabels.every(l => l.trim() === "")} className="flex items-center gap-1.5 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition">
              Próximo <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === "C" && (
            <button onClick={() => setStep("D")} className="flex items-center gap-1.5 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition">
              Revisar <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === "D" && (
            <button onClick={handleSave} className="flex items-center gap-1.5 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition">
              <Check className="w-4 h-4" /> Salvar variação
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Componente auxiliar ──────────────────────────────────────────────────────

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}
