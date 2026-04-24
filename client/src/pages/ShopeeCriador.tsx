import { useState, useEffect, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { trpc } from "../lib/trpc";
import { CategoryPicker } from "../components/shopee/CategoryPicker";
// BrandPicker NÃO é usado na Etapa 4 (Revisão). Brand é atributo de categoria
// na Shopee — renderizado dentro de Especificações na Etapa 3 quando o
// backend devolve um attribute com input_type=BRAND. O componente fica
// disponível pra ser usado lá no próximo passo.
import {
  Search, Package, ChevronRight, Star, Loader2,
  Plus, Trash2, Sparkles, Hash, Ruler, Layers,
  Palette, PenLine, ArrowLeft, ArrowRight, Check,
  CheckCircle2, X, PlusCircle, AlertTriangle, TrendingUp,
  ExternalLink,
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
  sku: string;
  ean: string;
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
  return { id: uid(), label, weight: "", length: "", width: "", height: "", price: "", stock: "", sku: "", ean: "" };
}

/**
 * Validates an EAN/GTIN/UPC code. Only 8, 12, 13 or 14 digits are accepted
 * (GTIN-8, UPC-A, EAN-13, GTIN-14). Empty string is considered valid —
 * callers should treat it as "not provided".
 */
export function isValidEan(ean: string): boolean {
  const trimmed = ean.trim();
  if (!trimmed) return true;
  if (!/^\d+$/.test(trimmed)) return false;
  return [8, 12, 13, 14].includes(trimmed.length);
}

// Sugere um nome para a criação de um novo anúncio — incrementa o sufixo " - V<n>"
// se já existir, senão adiciona " - V2". Shopee limita item_name a 120 chars,
// então trunca o original se necessário. Mantido aqui pra ficar colado com
// o DecisionModal que o usa.
function suggestNewName(original: string): string {
  const match = original.match(/^(.*?)\s*-\s*V(\d+)$/);
  const suffix = match ? ` - V${parseInt(match[2], 10) + 1}` : " - V2";
  const base = match ? match[1].trimEnd() : original;
  const combined = base + suffix;
  if (combined.length <= 120) return combined;
  const maxBase = Math.max(0, 120 - suffix.length);
  return base.slice(0, maxBase).trimEnd() + suffix;
}

// Abrevia nomes longos de variação para caber em 20 chars
function truncateVariationName(name: string): string {
  const abbrevs: [RegExp, string][] = [
    [/\bUnidades\b/gi, "Un."],
    [/\bUnidade\b/gi,  "Un."],
    [/\bquadrado\b/gi, "quad."],
    [/\bRedondo\b/gi,  "red."],
    [/\bRetangular\b/gi, "ret."],
    [/\bMililitros\b/gi, "ml"],
    [/\bLitros\b/gi,   "L"],
    [/\bGramas\b/gi,   "g"],
    [/\bKilograma[s]?\b/gi, "kg"],
    [/\bcentímetros\b/gi, "cm"],
    [/\s+de\s+/gi, " "],
    [/\s+com\s+/gi, " c/"],
    [/\s+para\s+/gi, " p/"],
  ];
  let r = name;
  for (const [pat, rep] of abbrevs) r = r.replace(pat, rep);
  r = r.replace(/\s+/g, " ").trim();
  return r.slice(0, 20);
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
  const urlSearch = useSearch();
  const [, setLocation] = useLocation();
  // Deep-link from the Shopee products grid: /shopee-criador?productId=N
  // auto-selects the product and skips the picker.
  const urlProductId = useMemo(() => {
    const p = new URLSearchParams(urlSearch).get("productId");
    const n = p ? Number(p) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [urlSearch]);

  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  const { data: urlProduct, error: urlProductError } = trpc.shopee.getProductById.useQuery(
    { productId: urlProductId! },
    { enabled: urlProductId !== null, staleTime: 60_000, retry: false },
  );

  // Hydrate selectedAccountId + selectedProduct from the deep-link row once
  // the tRPC query resolves.
  useEffect(() => {
    if (urlProduct && selectedProduct?.id !== urlProduct.id) {
      setSelectedAccountId(Number(urlProduct.shopeeAccountId));
      setSelectedProduct(urlProduct);
    }
  }, [urlProduct, selectedProduct?.id]);

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
    // When arrived via deep-link, "Voltar" goes back to the products page.
    // Otherwise it clears state and shows the internal picker again.
    const handleBack = urlProductId
      ? () => setLocation("/shopee-products")
      : () => setSelectedProduct(null);
    return (
      <ProductDetail
        product={selectedProduct}
        accountId={selectedAccountId!}
        onBack={handleBack}
        showBreadcrumb={!!urlProductId}
      />
    );
  }

  // Deep-link with invalid / unauthorized productId → show friendly error.
  if (urlProductId && urlProductError) {
    return (
      <div className="p-6 max-w-xl mx-auto text-center space-y-3">
        <p className="text-lg font-semibold text-gray-800">Produto não disponível</p>
        <p className="text-sm text-gray-500">{urlProductError.message}</p>
        <button
          onClick={() => setLocation("/shopee-products")}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition"
        >
          Voltar para Produtos Shopee
        </button>
      </div>
    );
  }

  // Deep-link pending (query still loading) — avoid flashing the picker.
  if (urlProductId && !urlProduct) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span>Carregando produto...</span>
      </div>
    );
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

function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: "bg-green-100 text-green-700 border-green-300",
    B: "bg-blue-100 text-blue-700 border-blue-300",
    C: "bg-yellow-100 text-yellow-700 border-yellow-300",
    D: "bg-orange-100 text-orange-700 border-orange-300",
    F: "bg-red-100 text-red-700 border-red-300",
  };
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full border-2 text-xs font-bold ${colors[grade] ?? colors.F}`}>
      {grade}
    </span>
  );
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const color = pct >= 85 ? "bg-green-500" : pct >= 70 ? "bg-blue-500" : pct >= 50 ? "bg-yellow-500" : pct >= 30 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ProductDetail({ product, accountId, onBack, showBreadcrumb = false }: { product: any; accountId: number; onBack: () => void; showBreadcrumb?: boolean }) {
  // — existing wizard/publish state —
  const [wizardOpen, setWizardOpen] = useState(false);
  const [savedVariations, setSavedVariations] = useState<VariationGroup[]>([]);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishModalStatus, setPublishModalStatus] = useState<"idle"|"loading"|"success"|"error">("idle");
  const [publishModalResult, setPublishModalResult] = useState<{ itemId: number; itemUrl: string; mode?: "create" | "update" | "promote" } | null>(null);
  const [publishModalError, setPublishModalError] = useState("");
  const [promoteConfirmed, setPromoteConfirmed] = useState(false);
  // Decision modal: user picks "create" or "promote" when local variations
  // don't match the remote (simple) product. `overrideMode` then flows into
  // the mutation to disambiguate for the backend.
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [overrideMode, setOverrideMode] = useState<"create" | "promote" | undefined>(undefined);
  // Name-editor sub-view inside DecisionModal (only for "create"): user tweaks
  // the title to avoid duplicate-listing detection on Shopee.
  const [showNameEditor, setShowNameEditor] = useState(false);
  const [newItemName, setNewItemName] = useState("");

  // — state —
  const allImages: string[] = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : product.imageUrl ? [product.imageUrl] : [];
  const [activeImg, setActiveImg] = useState(0);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(product.description || "");
  const [savingDesc, setSavingDesc] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [editingAttrId, setEditingAttrId] = useState<number | null>(null);
  const [editingAttrValue, setEditingAttrValue] = useState("");
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [titleSuggestion, setTitleSuggestion] = useState<{
    optimizedTitle: string; alternatives: string[]; keywords: string[]; explanation: string;
  } | null>(null);
  const [selectedSuggestedTitle, setSelectedSuggestedTitle] = useState("");
  const [applyingTitle, setApplyingTitle] = useState(false);
  // live product name — updated when title is applied
  const [displayName, setDisplayName] = useState(product.itemName || "");

  // — queries —
  const { data: diagData, isLoading: diagLoading } =
    trpc.shopee.getProductDiagnostic.useQuery({ productId: product.id }, { staleTime: 60_000 });
  const { data: urlData } =
    trpc.shopee.getProductUrls.useQuery({ accountId, productId: product.id }, { staleTime: 300_000 });
  const { data: categoryAttrsForDisplay } = trpc.shopee.getCategoryAttributes.useQuery(
    { accountId, categoryId: Number(product.categoryId) },
    { enabled: !!product.categoryId, staleTime: 5 * 60 * 1000 }
  );
  const { data: publishMode } = trpc.shopee.getPublishMode.useQuery(
    { productId: product.id },
    { staleTime: 60_000 },
  );
  const localOptionsCount = savedVariations[savedVariations.length - 1]?.options.length ?? 0;
  // Ambiguous: remote is simple, local has >1 variations. User picks via DecisionModal.
  const isSimpleToVariatedCase =
    publishMode?.mode === "update" &&
    publishMode?.hasRemoteVariations === false &&
    localOptionsCount > 1;
  // Publish modal styling: driven by the user's explicit overrideMode (from
  // DecisionModal) or, when there's no ambiguity, by the natural mode.
  const isPromoteMode = overrideMode === "promote";
  const isForcedCreate = overrideMode === "create" && !!publishMode?.itemId;
  const isUpdateMode = publishMode?.mode === "update" && !isPromoteMode && !isForcedCreate;
  const attrDefMap = useMemo(() => {
    const map = new Map<number, { displayName: string; values: Map<number, string> }>();
    if (Array.isArray(categoryAttrsForDisplay)) {
      for (const def of categoryAttrsForDisplay as any[]) {
        const vmap = new Map<number, string>();
        const list = def.attribute_value_list ?? def.options_list ?? [];
        for (const v of list) {
          if (v?.value_id != null) {
            vmap.set(Number(v.value_id), v.display_value_name ?? v.original_value_name ?? "");
          }
        }
        map.set(Number(def.attribute_id), {
          displayName: def.display_attribute_name ?? def.original_attribute_name ?? "",
          values: vmap,
        });
      }
    }
    return map;
  }, [categoryAttrsForDisplay]);

  // — mutations —
  const detailPublishMutation   = trpc.shopee.createProductFromWizard.useMutation();
  const applyDescMutation       = trpc.shopee.applyDescription.useMutation();
  const generateAdMutation      = trpc.shopee.generateAdContent.useMutation();
  const optimizeTitleMutation   = trpc.shopee.optimizeTitle.useMutation();
  const applyTitleMutation      = trpc.shopee.applyTitle.useMutation();

  const diagnostic = diagData?.diagnostic;
  const statusLabel = product.itemStatus === "BANNED" ? "Banido"
    : product.itemStatus === "UNLIST" ? "Deslistado"
    : product.itemStatus === "SELLER_DELETE" ? "Excluído"
    : "Ativo";
  const statusColor = product.itemStatus === "NORMAL" || !product.itemStatus
    ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";

  const attrs: any[] = Array.isArray(product.attributes) ? product.attributes : [];
  const filledAttrs = attrs.filter((a: any) => a.attribute_value_list?.length > 0);

  function handleSaveVariation(group: VariationGroup) {
    setSavedVariations(v => [...v, group]);
    setWizardOpen(false);
  }

  async function handleSaveDesc() {
    if (!descDraft.trim()) return;
    setSavingDesc(true);
    try {
      await applyDescMutation.mutateAsync({ productId: product.id, newDescription: descDraft });
      product.description = descDraft;
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

  async function handleGenerateTitle() {
    setGeneratingTitle(true);
    try {
      const result = await optimizeTitleMutation.mutateAsync({ productId: product.id });
      setTitleSuggestion(result);
      setSelectedSuggestedTitle(result.optimizedTitle);
    } catch {}
    setGeneratingTitle(false);
  }

  async function handleApplyTitle() {
    if (!selectedSuggestedTitle.trim()) return;
    setApplyingTitle(true);
    try {
      await applyTitleMutation.mutateAsync({ productId: product.id, newTitle: selectedSuggestedTitle });
      product.itemName = selectedSuggestedTitle;
      setDisplayName(selectedSuggestedTitle);
      setTitleSuggestion(null);
    } catch {}
    setApplyingTitle(false);
  }

  async function handlePublishFromDetail() {
    if (savedVariations.length === 0) return;
    const group = savedVariations[savedVariations.length - 1];
    const variations = group.options
      .map(o => ({
        label:  o.label,
        price:  Math.max(parseFloat(o.price) || 0.01, 0.01),
        stock:  Math.max(parseInt(o.stock || "0", 10), 0),
        weight: Math.max(parseFloat(o.weight) || 0.1, 0.01),
        length: parseFloat(o.length) > 0 ? parseFloat(o.length) : undefined,
        width:  parseFloat(o.width)  > 0 ? parseFloat(o.width)  : undefined,
        height: parseFloat(o.height) > 0 ? parseFloat(o.height) : undefined,
      }))
      .filter(v => v.price > 0);
    if (variations.length === 0) return;
    setPublishModalStatus("loading");
    setPublishModalError("");
    try {
      const result = await detailPublishMutation.mutateAsync({
        accountId,
        sourceProductId: product.id,
        variationTypeName: group.typeName,
        variations,
        title: product.itemName || "",
        description: product.description || "",
        hashtags: [],
        overrideMode,
        newItemName: overrideMode === "create" ? newItemName : undefined,
      });
      setPublishModalResult({ itemId: result.itemId, itemUrl: result.itemUrl, mode: result.mode });
      setPublishModalStatus("success");
    } catch (e: any) {
      const msg: string = e?.message || "";
      // Safety net: if the client-side heuristic missed the ambiguous case,
      // the backend throws NEEDS_USER_DECISION. Surface the decision modal
      // instead of showing a raw error. Match the bare code (no brackets) so
      // the check survives any formatter/wrapper stripping punctuation.
      if (msg.includes("NEEDS_USER_DECISION")) {
        setShowPublishModal(false);
        setPublishModalStatus("idle");
        setOverrideMode(undefined);
        setPromoteConfirmed(false);
        setShowDecisionModal(true);
        return;
      }
      setPublishModalError(msg || "Erro desconhecido ao publicar");
      setPublishModalStatus("error");
    }
  }

  function handlePublishClick() {
    if (isSimpleToVariatedCase && !overrideMode) {
      setShowDecisionModal(true);
      setShowNameEditor(false);
      setPromoteConfirmed(false);
      return;
    }
    setShowPublishModal(true);
    setPublishModalStatus("idle");
    setPublishModalResult(null);
    setPromoteConfirmed(false);
  }

  function pickDecision(mode: "create" | "promote") {
    setOverrideMode(mode);
    setShowDecisionModal(false);
    setShowNameEditor(false);
    setShowPublishModal(true);
    setPublishModalStatus("idle");
    setPublishModalResult(null);
    setPromoteConfirmed(false);
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      {showBreadcrumb && (
        <nav className="text-xs text-gray-500 flex items-center gap-1 flex-wrap">
          <button onClick={onBack} className="hover:text-gray-700 underline">
            Produtos Shopee
          </button>
          <span>›</span>
          <span className="text-gray-700 font-medium truncate max-w-[40ch]">{displayName || product.itemName}</span>
          <span>›</span>
          <span className="text-orange-600 font-semibold">Criar Anúncio</span>
        </nav>
      )}
      <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 text-sm transition">
        <ArrowLeft className="w-4 h-4" /> {showBreadcrumb ? "Voltar para Produtos Shopee" : "Voltar para lista"}
      </button>

      {/* ── 1. HEADER ─────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex gap-4 items-start">
          {/* Gallery */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            <div className="w-28 h-28 rounded-xl border border-gray-100 overflow-hidden bg-gray-50 flex items-center justify-center">
              {allImages[activeImg]
                ? <img src={allImages[activeImg]} alt="" className="w-full h-full object-cover" />
                : <Package className="w-10 h-10 text-gray-300" />}
            </div>
            {allImages.length > 1 && (
              <div className="flex gap-1 flex-wrap max-w-[112px]">
                {allImages.slice(0, 6).map((url, i) => (
                  <button key={i} onClick={() => setActiveImg(i)}
                    className={`w-8 h-8 rounded-md border-2 overflow-hidden flex-shrink-0 ${i === activeImg ? "border-orange-400" : "border-transparent"}`}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-gray-900 leading-snug">{displayName || "Sem título"}</h2>
              <div className="flex items-center gap-2 flex-shrink-0">
                {diagLoading && <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />}
                {diagnostic && <GradeBadge grade={diagnostic.grade} />}
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">ID: {product.itemId}</p>
            {product.price && (
              <p className="text-base font-bold text-orange-600 mt-1">R$ {Number(product.price).toFixed(2)}</p>
            )}
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mt-1.5 ${statusColor}`}>
              {statusLabel}
            </span>

            <div className="flex gap-2 mt-3 flex-wrap">
              {urlData?.shopeeUrl && (
                <a href={urlData.shopeeUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-orange-300 text-orange-600 hover:bg-orange-50 transition font-medium">
                  <ExternalLink className="w-3.5 h-3.5" /> Ver na Shopee
                </a>
              )}
              {urlData?.sellerCenterUrl && (
                <a href={urlData.sellerCenterUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition font-medium">
                  ✏️ Editar na Shopee
                </a>
              )}
              <button
                onClick={handleGenerateTitle}
                disabled={generatingTitle}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-purple-300 text-purple-600 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 transition font-medium">
                {generatingTitle
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Sparkles className="w-3.5 h-3.5" />}
                {generatingTitle ? "Gerando…" : "✨ Gerar Título"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. QUALIDADE DO ANÚNCIO ───────────────────────────────────────── */}
      {diagLoading && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-center gap-3 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Calculando qualidade do anúncio…
        </div>
      )}
      {diagnostic && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">📊 Qualidade do Anúncio</span>
              <GradeBadge grade={diagnostic.grade} />
            </div>
            <span className="text-xs text-gray-500">{diagnostic.overallScore}/100</span>
          </div>

          {/* Overall bar */}
          <div>
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  diagnostic.overallScore >= 85 ? "bg-green-500" :
                  diagnostic.overallScore >= 70 ? "bg-blue-500" :
                  diagnostic.overallScore >= 50 ? "bg-yellow-500" :
                  diagnostic.overallScore >= 30 ? "bg-orange-500" : "bg-red-500"
                }`}
                style={{ width: `${diagnostic.overallScore}%` }}
              />
            </div>
          </div>

          {/* 4 mini-cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              { key: "title",       label: "Título" },
              { key: "description", label: "Descrição" },
              { key: "images",      label: "Imagens" },
              { key: "attributes",  label: "Atributos" },
            ] as const).map(({ key, label }) => {
              const cat = diagnostic.categories[key];
              const pct = cat.maxScore > 0 ? Math.round((cat.score / cat.maxScore) * 100) : 0;
              return (
                <div key={key} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-xs text-gray-500 font-medium">{label}</p>
                  <p className="text-sm font-bold text-gray-800 mt-0.5">{cat.score}<span className="text-xs font-normal text-gray-400">/{cat.maxScore}</span></p>
                  <ScoreBar score={cat.score} max={cat.maxScore} />
                  {cat.suggestions[0] && (
                    <p className="text-xs text-gray-400 mt-1.5 leading-tight line-clamp-2">{cat.suggestions[0]}</p>
                  )}
                  {cat.issues[0] && !cat.suggestions[0] && (
                    <p className="text-xs text-orange-500 mt-1.5 leading-tight line-clamp-2">{cat.issues[0]}</p>
                  )}
                  {pct === 100 && (
                    <p className="text-xs text-green-600 mt-1.5 font-medium">✓ Ótimo</p>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => { window.location.href = "/shopee-optimizer"; }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-sm font-semibold transition shadow-sm shadow-orange-200">
            <Sparkles className="w-4 h-4" /> ✨ Otimizar com IA
          </button>
        </div>
      )}

      {/* ── 3. DESCRIÇÃO ─────────────────────────────────────────────────── */}
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

      {/* ── 4. PESO E MEDIDAS ────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Peso e Medidas</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <InfoBox label="Peso" value={product.weight ? `${product.weight} kg` : "—"} />
          <InfoBox label="Comprimento" value={product.dimensionLength ? `${product.dimensionLength} cm` : "—"} />
          <InfoBox label="Largura" value={product.dimensionWidth ? `${product.dimensionWidth} cm` : "—"} />
          <InfoBox label="Altura" value={product.dimensionHeight ? `${product.dimensionHeight} cm` : "—"} />
        </div>
      </div>

      {/* ── 5. FICHA TÉCNICA / ATRIBUTOS ─────────────────────────────────── */}
      {filledAttrs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            📋 Ficha Técnica <span className="normal-case font-normal text-gray-400">({filledAttrs.length} atributo{filledAttrs.length !== 1 ? "s" : ""})</span>
          </p>
          <div className="divide-y divide-gray-100">
            {filledAttrs.map((attr: any) => {
              const attrId: number = attr.attribute_id;
              const attrDef = attrDefMap.get(attrId);
              const attrName: string =
                (attrDef?.displayName && attrDef.displayName.trim()) ||
                attr.display_attribute_name ||
                attr.original_attribute_name ||
                attr.attribute_name ||
                `Atributo ${attrId}`;
              const values: any[] = attr.attribute_value_list || [];
              const displayValue = values.map((v: any) => {
                const mapped = v?.value_id != null ? attrDef?.values.get(Number(v.value_id)) : undefined;
                const name = (mapped && mapped.trim())
                  || v.display_value_name
                  || v.original_value_name
                  || "";
                const unit = v.value_unit ? ` ${v.value_unit}` : "";
                return `${name}${unit}`;
              }).filter(Boolean).join(", ");

              const isEditing = editingAttrId === attrId;
              return (
                <div key={attrId} className="py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500">{attrName}</p>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editingAttrValue}
                        onChange={e => setEditingAttrValue(e.target.value)}
                        className="text-sm border border-orange-400 rounded-lg px-2 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-orange-400 mt-0.5"
                        autoFocus
                      />
                    ) : (
                      <p className="text-sm font-medium text-gray-800 truncate">{displayValue || "—"}</p>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => setEditingAttrId(null)}
                        className="text-xs px-2.5 py-1 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50">
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingAttrId(attrId); setEditingAttrValue(displayValue); }}
                      className="text-xs text-gray-400 hover:text-orange-500 transition flex-shrink-0">
                      ✏️
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 6. FOTOS ────────────────────────────────────────────────────── */}
      {allImages.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fotos ({allImages.length})</p>
            <button
              onClick={() => { window.location.href = urlData?.sellerCenterUrl || urlData?.shopeeUrl || "#"; }}
              className="text-xs flex items-center gap-1 text-gray-400 hover:text-orange-500 transition">
              ➕ Adicionar foto
            </button>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {allImages.map((url, i) => (
              <button key={i} onClick={() => setActiveImg(i)}
                className={`aspect-square rounded-xl border-2 overflow-hidden ${i === activeImg ? "border-orange-400" : "border-gray-100"} hover:border-orange-300 transition`}>
                <img src={url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 7. VARIAÇÕES CRIADAS ─────────────────────────────────────────── */}
      {savedVariations.length > 0 && (
        <div className="space-y-3">
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

      {/* Publicar / Criar variação */}
      {savedVariations.length > 0 && (
        <button
          onClick={handlePublishClick}
          className="w-full flex items-center justify-center gap-3 py-4 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-base transition shadow-md shadow-orange-200">
          🚀 Publicar na Shopee
        </button>
      )}
      <button
        onClick={() => setWizardOpen(true)}
        className="w-full flex items-center justify-center gap-3 py-4 px-6 rounded-xl border-2 border-orange-400 text-orange-600 font-bold text-base transition hover:bg-orange-50">
        <PlusCircle className="w-5 h-5" /> {savedVariations.length > 0 ? "Criar Nova Variação" : "Criar Variação de Anúncio"}
      </button>

      {/* ── Modal de sugestão de título ─────────────────────────────────── */}
      {titleSuggestion && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" /> Título Otimizado com IA
              </h3>
              <button onClick={() => setTitleSuggestion(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Titles to pick from */}
            <div className="space-y-2">
              {[titleSuggestion.optimizedTitle, ...titleSuggestion.alternatives].map((t, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedSuggestedTitle(t)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border-2 text-sm transition ${
                    selectedSuggestedTitle === t
                      ? "border-purple-500 bg-purple-50 text-purple-900 font-medium"
                      : "border-gray-200 hover:border-purple-300 text-gray-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="leading-snug">{t}</span>
                    <span className={`text-xs flex-shrink-0 mt-0.5 font-mono ${t.length > 100 ? "text-red-500" : t.length >= 70 ? "text-green-600" : "text-amber-500"}`}>
                      {t.length}ch
                    </span>
                  </div>
                  {i === 0 && <span className="text-xs text-purple-500 font-semibold mt-0.5 block">✨ Principal</span>}
                </button>
              ))}
            </div>

            {/* Keywords */}
            {titleSuggestion.keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {titleSuggestion.keywords.map((kw, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{kw}</span>
                ))}
              </div>
            )}

            {/* Explanation */}
            {titleSuggestion.explanation && (
              <p className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 pt-3">{titleSuggestion.explanation}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={() => setTitleSuggestion(null)}
                className="flex-1 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button
                onClick={handleApplyTitle}
                disabled={applyingTitle || !selectedSuggestedTitle.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-xl disabled:opacity-50 transition">
                {applyingTitle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {applyingTitle ? "Aplicando…" : "Aplicar Título"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de decisão: criar novo vs. promover existente ─────────── */}
      {showDecisionModal && !showNameEditor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Como publicar este produto?</h3>
              <button onClick={() => setShowDecisionModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              O produto na Shopee (<span className="font-mono">item_id: {publishMode?.itemId ?? "—"}</span>) é <b>simples</b>,
              sem variações. Localmente você montou <b>{localOptionsCount} variações</b>. Escolha uma ação:
            </p>

            {/* Opção 1: CRIAR NOVO — abre editor de nome */}
            <button
              onClick={() => {
                setNewItemName(suggestNewName(product.itemName || ""));
                setShowNameEditor(true);
              }}
              className="w-full text-left border-2 border-blue-200 hover:border-blue-400 bg-blue-50 hover:bg-blue-100 rounded-xl p-4 transition"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0 text-lg">🆕</div>
                <div className="flex-1">
                  <p className="font-semibold text-blue-900 text-sm">Criar novo produto na Shopee</p>
                  <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                    Mantém o produto antigo intocado. Cria um novo anúncio com as variações.
                    Recomendado se você quer migrar pra um novo listing sem perder o antigo.
                  </p>
                </div>
              </div>
            </button>

            {/* Opção 2: ADICIONAR VARIAÇÕES (amber, irreversível) */}
            <button
              onClick={() => pickDecision("promote")}
              className="w-full text-left border-2 border-amber-300 hover:border-amber-500 bg-amber-50 hover:bg-amber-100 rounded-xl p-4 transition"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center flex-shrink-0 text-lg">⚠️</div>
                <div className="flex-1">
                  <p className="font-semibold text-amber-900 text-sm">
                    Adicionar variações ao produto existente <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded ml-1">IRREVERSÍVEL</span>
                  </p>
                  <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                    O produto simples vai passar a ter {localOptionsCount} variações. Histórico de vendas e avaliações são preservados,
                    mas <b>não dá pra voltar pra produto simples</b>.
                  </p>
                </div>
              </div>
            </button>

            {/* Opção 3: CANCELAR */}
            <button
              onClick={() => setShowDecisionModal(false)}
              className="w-full py-2.5 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Editor de nome (sub-view do DecisionModal, opção "Criar novo") ─ */}
      {showDecisionModal && showNameEditor && (() => {
        const nameLen = newItemName.length;
        const nameValid = nameLen >= 1 && nameLen <= 120;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">Nome do novo produto na Shopee</h3>
                <button onClick={() => { setShowDecisionModal(false); setShowNameEditor(false); }} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1.5">
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value.slice(0, 120))}
                  maxLength={120}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 focus:border-blue-400 rounded-xl text-sm outline-none transition"
                  placeholder="Nome do produto na Shopee"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Edite se quiser. O nome deve ser diferente do anúncio atual para evitar duplicata.
                  </p>
                  <span className={`text-xs font-mono flex-shrink-0 ${nameLen > 110 ? "text-amber-600" : nameLen < 1 ? "text-red-500" : "text-gray-400"}`}>
                    {nameLen}/120
                  </span>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowNameEditor(false)}
                  className="flex-1 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition"
                >
                  Voltar
                </button>
                <button
                  onClick={() => pickDecision("create")}
                  disabled={!nameValid}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition"
                >
                  🆕 Confirmar Criação
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Modal de publicação ──────────────────────────────────────────── */}
      {showPublishModal && (() => {
        const modeColor = isPromoteMode
          ? { tintBg: "bg-amber-50", tintBorder: "border-amber-300", accent: "text-amber-800",
              btnBg: "bg-amber-600 hover:bg-amber-700", btnLabel: "Confirmar promoção",
              title: "Promover para produto com variações",
              subtitle: `ATENÇÃO: Esta ação é IRREVERSÍVEL. O produto simples (item_id: ${publishMode?.itemId ?? "—"}) vai passar a ter ${localOptionsCount} variações. O histórico de vendas e avaliações é preservado, mas não dá pra voltar pra produto simples.`,
              emoji: "⚠️",
              needsExtraConfirm: true as boolean }
          : isForcedCreate
          ? { tintBg: "bg-blue-50", tintBorder: "border-blue-200", accent: "text-blue-800",
              btnBg: "bg-blue-600 hover:bg-blue-700", btnLabel: "Criar novo anúncio",
              title: "Criar novo produto (descartar antigo)",
              subtitle: `Um novo anúncio com variações será criado. O produto antigo (item_id: ${publishMode?.itemId ?? "—"}) permanece na Shopee, mas o registro local será reapontado para o novo item.`,
              emoji: "🆕",
              needsExtraConfirm: false as boolean }
          : isUpdateMode
          ? { tintBg: "bg-red-50", tintBorder: "border-red-200", accent: "text-red-700",
              btnBg: "bg-red-600 hover:bg-red-700", btnLabel: "Atualizar produto",
              title: "Atualizar produto existente",
              subtitle: `Isso vai sobrescrever o produto que já está na Shopee (item_id: ${publishMode?.itemId ?? "—"}). Preço, estoque, imagens, descrição, atributos e dimensões serão substituídos pelos valores atuais.`,
              emoji: "⚠️",
              needsExtraConfirm: false as boolean }
          : { tintBg: "bg-emerald-50", tintBorder: "border-emerald-200", accent: "text-emerald-700",
              btnBg: "bg-emerald-600 hover:bg-emerald-700", btnLabel: "Criar produto",
              title: "Criar novo produto na Shopee",
              subtitle: "Esse produto ainda não existe na Shopee. Um novo anúncio será criado.",
              emoji: "🆕",
              needsExtraConfirm: false as boolean };

        return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className={`text-base font-bold ${modeColor.accent}`}>{modeColor.emoji} {modeColor.title}</h3>
              <button onClick={() => setShowPublishModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {publishModalStatus !== "success" && (
              <div className="space-y-3 mb-5">
                <div className={`${modeColor.tintBg} border ${modeColor.tintBorder} rounded-xl p-3`}>
                  <p className={`text-xs ${modeColor.accent} font-semibold mb-1`}>
                    {isUpdateMode ? "ATUALIZAÇÃO" : "CRIAÇÃO"}
                  </p>
                  <p className={`text-xs ${modeColor.accent}`}>{modeColor.subtitle}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-0.5">Produto</p>
                  <p className="text-sm font-semibold text-gray-800 truncate">{product.itemName || "Sem título"}</p>
                </div>
                {savedVariations.length > 0 && (() => {
                  const group = savedVariations[savedVariations.length - 1];
                  return (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                      <p className="text-xs text-gray-500 mb-0.5">Variações ({group.typeName})</p>
                      <p className="text-sm font-semibold text-gray-800 mb-2">{group.options.length} opção(ões)</p>
                      <div className="flex flex-wrap gap-1">
                        {group.options.slice(0, 5).map(o => (
                          <span key={o.id} className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700">
                            {o.label}{o.price ? ` · R$${o.price}` : ""}
                          </span>
                        ))}
                        {group.options.length > 5 && (
                          <span className="text-xs text-gray-400">+{group.options.length - 5} mais</span>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {(isUpdateMode || isPromoteMode) && (
                  <p className="text-xs text-gray-400 text-center">
                    Categoria permanece <b>{publishMode?.currentCategoryId ?? "—"}</b> — para mudar, recrie o produto na Shopee.
                  </p>
                )}
                {modeColor.needsExtraConfirm && (
                  <label className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={promoteConfirmed}
                      onChange={e => setPromoteConfirmed(e.target.checked)}
                      className="mt-0.5 accent-amber-600"
                    />
                    <span className="text-xs text-amber-900">
                      Entendo que esta operação é <b>irreversível</b>.
                    </span>
                  </label>
                )}
              </div>
            )}

            {publishModalStatus === "error" && (
              <div className="bg-red-50 border border-red-300 rounded-xl p-3 mb-4 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-800">
                  <p className="font-semibold">Falha na publicação</p>
                  <p className="mt-0.5 text-red-700 text-xs">{publishModalError}</p>
                </div>
              </div>
            )}

            {publishModalStatus === "success" && publishModalResult && (
              <div className="bg-green-50 border border-green-300 rounded-xl p-5 mb-4 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
                <p className="font-bold text-green-800 text-base">
                  Produto {(() => {
                    const m = publishModalResult.mode ?? (isPromoteMode ? "promote" : isUpdateMode ? "update" : "create");
                    return m === "promote" ? "promovido" : m === "update" ? "atualizado" : "publicado";
                  })()}!
                </p>
                <a href={publishModalResult.itemUrl} target="_blank" rel="noopener noreferrer"
                  className="text-green-700 underline flex items-center justify-center gap-1 mt-2 text-sm hover:text-green-900">
                  Ver produto na Shopee <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {publishModalStatus !== "success" ? (
              <div className="flex gap-3">
                <button onClick={() => setShowPublishModal(false)}
                  className="flex-1 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button
                  onClick={handlePublishFromDetail}
                  disabled={publishModalStatus === "loading" || (modeColor.needsExtraConfirm && !promoteConfirmed)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 transition ${modeColor.btnBg}`}>
                  {publishModalStatus === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : "🚀"}
                  {publishModalStatus === "loading"
                    ? (isPromoteMode ? "Promovendo..." : isUpdateMode ? "Atualizando..." : "Publicando...")
                    : modeColor.btnLabel}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowPublishModal(false)}
                className="w-full py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-xl transition">
                Fechar
              </button>
            )}
          </div>
        </div>
        );
      })()}

      {wizardOpen && (
        <VariationWizard
          product={product}
          accountId={accountId}
          onSave={handleSaveVariation}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Tela 3 – Wizard ─────────────────────────────────────────────────────────

type PricingMode = "multiplier" | "margin" | "profit";

interface PricingGlobals {
  unitCost: string;
  batchCost: string;        // custo total do lote (alternativa ao unitCost)
  baseProductQty: string;   // quantas unidades o produto base representa
  packagingCost: string;
  shippingCost: string;
  transactionFee: string;
  minMarginPct: string;     // margem mínima desejada (%)
  // mode 1
  marginMultiplier: string;
  defaultDiscount: string;
  // mode 2
  desiredMargin: string;
  // mode 3
  minProfit: string;
  globalStock: string;
}

interface ComputedPricing {
  qty: number;
  price: number;
  totalProductCost: number;
  platformCost: number;
  commissionRate: number;
  commissionFixed: number;
  marginContribution: number;
  profitPct: number;
  weight: number;
  length: number;
  width: number;
  height: number;
  factor: number;
  effectiveDisc: number;
  minMarginAdjusted: boolean;
}

function extractQty(label: string): number {
  const m = label.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 1;
}

// Shopee Brazil 2026 commission tiers (taxa % + valor fixo)
function shopeeCommission(price: number): { rate: number; fixed: number } {
  if (price <   8) return { rate: 0.50, fixed:  0 };
  if (price <  80) return { rate: 0.20, fixed:  4 };
  if (price < 100) return { rate: 0.14, fixed: 16 };
  if (price < 200) return { rate: 0.14, fixed: 20 };
  return              { rate: 0.14, fixed: 26 };
}

function shopeeCommissionLabel(price: number): string {
  if (price <   8) return "50% + R$0 (< R$8)";
  if (price <  80) return "20% + R$4 (R$8–79)";
  if (price < 100) return "14% + R$16 (R$80–99)";
  if (price < 200) return "14% + R$20 (R$100–199)";
  return              "14% + R$26 (R$200+)";
}

// Mode 2: iterate until price converges to hit desired margin %
function solvePriceByMargin(
  totalCost: number, packaging: number, shipping: number,
  txFee: number, desiredMarginPct: number
): number {
  if (totalCost <= 0 || desiredMarginPct >= 100) return 0;
  const margin = desiredMarginPct / 100;
  const tx = txFee / 100;
  let price = totalCost * 3;
  for (let i = 0; i < 80; i++) {
    const { rate: commission, fixed } = shopeeCommission(price);
    const denom = 1 - commission - tx - margin;
    if (denom <= 0) return 0;
    const next = (totalCost + packaging + shipping + fixed) / denom;
    if (Math.abs(next - price) < 0.001) return Math.max(next, 0);
    price = next;
    if (!isFinite(price)) return 0;
  }
  return Math.max(price, 0);
}

// Mode 3: iterate until price converges to guarantee minProfit R$
function solvePriceByMinProfit(
  totalCost: number, packaging: number, shipping: number,
  txFee: number, minProfit: number
): number {
  if (totalCost <= 0) return 0;
  const tx = txFee / 100;
  let price = totalCost + minProfit + packaging + shipping;
  for (let i = 0; i < 80; i++) {
    const { rate: commission, fixed } = shopeeCommission(price);
    const denom = 1 - commission - tx;
    if (denom <= 0) return 0;
    const next = (totalCost + packaging + shipping + fixed + minProfit) / denom;
    if (Math.abs(next - price) < 0.001) return Math.max(next, 0);
    price = next;
    if (!isFinite(price)) return 0;
  }
  return Math.max(price, 0);
}

function VariationWizard({
  product,
  accountId,
  onSave,
  onClose,
}: {
  product: any;
  accountId: number;
  onSave: (group: VariationGroup) => void;
  onClose: () => void;
}) {
  const [step, setStep]                   = useState<WizardStep>("A");
  const [selectedType, setSelectedType]   = useState<VariationType | null>(null);
  const [optionLabels, setOptionLabels]   = useState<string[]>([""]);
  const [optionDetails, setOptionDetails] = useState<VariationOption[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [qtyFactors, setQtyFactors]       = useState<string[]>([]);
  const [pricingMode, setPricingMode]     = useState<PricingMode>("multiplier");
  // Per-variation parameter overrides (multiplier / margin% / profit R$)
  const [perVarParam, setPerVarParam]     = useState<string[]>([]);
  const [perVarEnabled, setPerVarEnabled] = useState<boolean[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<(number | null)[]>([]);
  const [autoGenAlerts, setAutoGenAlerts]   = useState<{ idx: number; label: string; oldPrice: number; newPrice: number }[]>([]);
  const [manuallyEdited, setManuallyEdited] = useState<Set<string>>(new Set());
  const [autoGenerated, setAutoGenerated]   = useState<Set<string>>(new Set());
  const [baseWeightOverride, setBaseWeightOverride] = useState<string>("");
  const [baseLengthOverride, setBaseLengthOverride] = useState<string>("");
  const [baseWidthOverride, setBaseWidthOverride]   = useState<string>("");
  const [baseHeightOverride, setBaseHeightOverride] = useState<string>("");
  const [inlinePriceEdits, setInlinePriceEdits]     = useState<Record<string, string>>({});
  const [inlineLabelEdits, setInlineLabelEdits]     = useState<Record<string, string>>({});
  const [attributeValues, setAttributeValues]       = useState<Record<number, { valueId: number; originalValue: string }>>({});
  const [aiFillingAttrs, setAiFillingAttrs]         = useState(false);

  const [pricing, setPricing] = useState<PricingGlobals>({
    unitCost: "",
    batchCost: "",
    baseProductQty: "1",
    packagingCost: "",
    shippingCost: "",
    transactionFee: "2",
    minMarginPct: "15",
    marginMultiplier: "2.5",
    defaultDiscount: "1",
    desiredMargin: "30",
    minProfit: "20",
    globalStock: "",
  });

  const optimizeMutation     = trpc.shopee.optimizeTitle.useMutation();
  const generateAdMutation   = trpc.shopee.generateAdContent.useMutation();
  const generateAllMutation  = trpc.shopee.generateAllContent.useMutation();
  const publishMutation      = trpc.shopee.createProductFromWizard.useMutation();
  const fillAttrsMutation    = trpc.ai.fillAttributes.useMutation();

  // Categoria efetiva: começa do produto e fica editável no fluxo CREATE.
  // Em UPDATE/PROMOTE a Shopee bloqueia mudança (CATEGORY_CHANGED), então o
  // picker aparece desabilitado com tooltip explicativo.
  const initialCategoryId = product.categoryId ? Number(product.categoryId) : null;
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(initialCategoryId);
  // product.categoryName é o nome da folha (sem hierarquia) ou null pra
  // produtos sincronizados antes do cache de árvore. Resolvemos o
  // breadcrumb completo via tRPC abaixo quando há ID mas falta breadcrumb.
  const [selectedCategoryBreadcrumb, setSelectedCategoryBreadcrumb] = useState<string>(product.categoryName || "");
  const { data: resolvedBreadcrumb } = trpc.shopee.resolveCategoryBreadcrumb.useQuery(
    { accountId, categoryId: selectedCategoryId! },
    {
      enabled: !!selectedCategoryId && !selectedCategoryBreadcrumb.includes(" > "),
      staleTime: 24 * 60 * 60 * 1000, // 1d — tree is shared/rarely changes
    },
  );
  useEffect(() => {
    if (resolvedBreadcrumb && resolvedBreadcrumb.breadcrumb) {
      setSelectedCategoryBreadcrumb(resolvedBreadcrumb.breadcrumb);
    }
  }, [resolvedBreadcrumb]);
  // Brand é renderizado como atributo de categoria na Etapa 3 (Especificações),
  // quando o backend devolve um item com input_type=BRAND. NÃO mais um picker
  // separado na Etapa 4. Veja routers.ts → ensureBrandAttribute.
  const categoryId = selectedCategoryId;
  // Whether this publish will CREATE (vs update/promote). `publishMode` is
  // resolved by the backend from product.itemId; when the wizard picks
  // "Criar novo" in the decision modal, overrideMode="create" also makes
  // this a CREATE — category becomes editable in both cases.
  const { data: publishModeData } = trpc.shopee.getPublishMode.useQuery(
    { productId: product.id },
    { staleTime: 60_000 },
  );
  // Pre-flight: does the Shopee listing already carry tier_variation? If so,
  // we lack a UI for editing existing variations (init_tier_variation rejects
  // with "tier-variation not change"), so we block the publish button and
  // show a banner directing the user to the Shopee seller dashboard.
  const { data: existingVariation, isLoading: variationCheckLoading } =
    trpc.shopee.checkExistingVariation.useQuery(
      { productId: product.id },
      { staleTime: 30_000 },
    );
  const hasExistingVariation = existingVariation?.hasVariation === true;
  const { data: categoryAttributes, isLoading: attrLoading, error: attrError } =
    trpc.shopee.getCategoryAttributes.useQuery(
      { accountId, categoryId: categoryId! },
      { enabled: !!categoryId, staleTime: 5 * 60 * 1000 }
    );
  const [publishStatus, setPublishStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [publishResult, setPublishResult] = useState<{ itemId: number; itemUrl: string; mode?: "create" | "update" | "promote" } | null>(null);
  const [publishError, setPublishError]   = useState<string>("");
  // Decision modal for the simple→variated ambiguous case. Mirrors the
  // ProductDetail logic — if any new callsite of createProductFromWizard is
  // added, it MUST also handle NEEDS_USER_DECISION or the raw error leaks
  // into the UI (see fix commit for grep guard).
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [overrideMode, setOverrideMode] = useState<"create" | "promote" | undefined>(undefined);
  const [showNameEditor, setShowNameEditor] = useState(false);
  const [newItemName, setNewItemName] = useState("");

  const [adContent, setAdContent]       = useState<any>(null);
  const [adLoadingSection, setAdLoadingSection] = useState<"all"|"title"|"desc"|"tags"|null>(null);
  // Undo snapshot captured right before a "Gerar tudo com IA" run. The toast
  // gives the user 10s to roll back if the regeneration overwrote manually
  // edited title/description/variation names.
  const [undoSnapshot, setUndoSnapshot] = useState<{
    title: string;
    description: string;
    optionLabels: Array<{ id: string; label: string }>;
  } | null>(null);
  const [undoToastVisible, setUndoToastVisible] = useState(false);
  const adLoading = adLoadingSection === "all";
  const [adTab, setAdTab]               = useState<"titulo"|"descricao"|"tags"|"keywords"|"score">("titulo");
  const [selectedTitle, setSelectedTitle] = useState<string>("");
  const [editingDesc, setEditingDesc]   = useState(false);
  const [editedDesc, setEditedDesc]     = useState("");

  const STEPS: { key: WizardStep; label: string }[] = [
    { key: "A", label: "Tipo" },
    { key: "B", label: "Opções" },
    { key: "C", label: "Detalhes" },
    { key: "D", label: "Revisão" },
  ];

  const currentStepIndex = STEPS.findIndex(s => s.key === step);
  const typeName = VARIATION_TYPES.find(t => t.type === selectedType)?.label ?? "";

  // ── Motor de precificação ──────────────────────────────────────────────────

  function computePricing(opt: VariationOption, idx: number): ComputedPricing {
    const isQty          = selectedType === "quantidade";
    const qty            = isQty ? extractQty(opt.label) : 1;
    // Custo efetivo: batchCost/baseProductQty ou unitCost direto
    const batchCostVal   = parseFloat(pricing.batchCost) || 0;
    const batchQty       = Math.max(parseFloat(pricing.baseProductQty) || 1, 0.001);
    const unitCost       = batchCostVal > 0 ? batchCostVal / batchQty : (parseFloat(pricing.unitCost) || 0);
    const packaging      = parseFloat(pricing.packagingCost)  || 0;
    const shipping       = parseFloat(pricing.shippingCost)   || 0;
    const txFee          = parseFloat(pricing.transactionFee) || 0;
    const autoDiscount   = (idx + 1) * (parseFloat(pricing.defaultDiscount) || 0);
    const hasQtyFactor   = qtyFactors[idx] !== undefined && qtyFactors[idx] !== "";
    const effectiveDisc  = hasQtyFactor ? (parseFloat(qtyFactors[idx]) || 0) : autoDiscount;
    // factor aplica em TODOS os modos como desconto sobre o preço final
    const factor         = Math.max(1 - effectiveDisc / 100, 0.01);
    const totalProductCost = unitCost * qty;

    // Effective per-variation param (override or global)
    const useOverride = perVarEnabled[idx] ?? false;
    const paramOverride = useOverride ? (perVarParam[idx] ?? "") : "";

    let price = 0;
    if (pricingMode === "multiplier") {
      const multiplier = parseFloat(paramOverride || pricing.marginMultiplier) || 1;
      price = totalProductCost * multiplier;
    } else if (pricingMode === "margin") {
      const desiredMarginPct = parseFloat(paramOverride || pricing.desiredMargin) || 0;
      price = solvePriceByMargin(totalProductCost, packaging, shipping, txFee, desiredMarginPct);
    } else {
      const minProfit = parseFloat(paramOverride || pricing.minProfit) || 0;
      price = solvePriceByMinProfit(totalProductCost, packaging, shipping, txFee, minProfit);
    }

    // Aplica margem mínima desejada (piso) sobre o preço base
    let minMarginAdjusted = false;
    const minMarginFloor = parseFloat(pricing.minMarginPct) || 0;
    if (minMarginFloor > 0 && price > 0 && totalProductCost > 0) {
      const { rate: cr, fixed: cf } = shopeeCommission(price);
      const pc = price * (cr + txFee / 100) + cf + packaging + shipping;
      const curMargin = price > 0 ? ((price - totalProductCost - pc) / price) * 100 : 0;
      if (curMargin < minMarginFloor) {
        const adjusted = solvePriceByMargin(totalProductCost, packaging, shipping, txFee, minMarginFloor);
        if (adjusted > price) { price = adjusted; minMarginAdjusted = true; }
      }
    }

    // Aplica teto de 4× Shopee se definido (anula desconto progressivo nesse caso)
    if (priceOverrides[idx] != null) {
      price = priceOverrides[idx]!;
      minMarginAdjusted = false;
    } else {
      // Aplica desconto progressivo sobre o preço final
      price = Math.max(price * factor, 0.01);
    }

    const { rate: commissionRate, fixed: commissionFixed } = shopeeCommission(price);
    const platformCost    = price * (commissionRate + txFee / 100) + commissionFixed + packaging + shipping;
    const marginContribution = price - totalProductCost - platformCost;
    const profitPct       = price > 0 ? (marginContribution / price) * 100 : 0;

    // Dimensions
    const baseL         = parseFloat(baseLengthOverride || product.dimensionLength) || 0;
    const baseW         = parseFloat(baseWidthOverride  || product.dimensionWidth)  || 0;
    const baseH         = parseFloat(baseHeightOverride || product.dimensionHeight) || 0;
    const baseWeight    = parseFloat(baseWeightOverride || product.weight)          || 0;
    const baseProductQty = Math.max(parseFloat(pricing.baseProductQty) || 1, 0.001);
    const dimRatio      = isQty ? qty / baseProductQty : 1;
    const scaleF        = Math.cbrt(dimRatio);
    let weight = opt.weight ? parseFloat(opt.weight) : (isQty ? baseWeight * dimRatio : baseWeight);
    let length = opt.length ? parseFloat(opt.length) : 0;
    let width  = opt.width  ? parseFloat(opt.width)  : 0;
    let height = opt.height ? parseFloat(opt.height) : 0;
    if (isQty && !opt.length && baseL && baseW && baseH) {
      length = parseFloat((baseL * scaleF).toFixed(1));
      width  = parseFloat((baseW * scaleF).toFixed(1));
      height = parseFloat((baseH * scaleF).toFixed(1));
    }

    return { qty, price, totalProductCost, platformCost, commissionRate, commissionFixed, marginContribution, profitPct, weight, length, width, height, factor, effectiveDisc, minMarginAdjusted };
  }

  function profitBadge(pct: number) {
    if (pct >= 20) return { bg: "bg-green-100 text-green-700 border-green-300",    dot: "bg-green-500"  };
    if (pct >= 10) return { bg: "bg-yellow-100 text-yellow-700 border-yellow-300", dot: "bg-yellow-500" };
    return             { bg: "bg-red-100 text-red-700 border-red-300",             dot: "bg-red-500"    };
  }

  function updateOptionLabel(id: string, value: string) {
    setOptionDetails(opts => opts.map(o => o.id === id ? { ...o, label: value } : o));
  }

  function autoGenerateFromFirst() {
    if (!optionDetails.length) return;
    const first = optionDetails[0];
    const firstQty = extractQty(first.label);
    if (firstQty <= 0) return;
    const fw = parseFloat(first.weight) || 0;
    const fl = parseFloat(first.length) || 0;
    const fw2 = parseFloat(first.width)  || 0;
    const fh  = parseFloat(first.height) || 0;
    const newAutoGen = new Set<string>();
    setOptionDetails(opts => opts.map((opt, idx) => {
      if (idx === 0) return opt;
      if (manuallyEdited.has(opt.id)) return opt;
      const qty = extractQty(opt.label);
      if (qty <= 0) return opt;
      const ratio = qty / firstQty;
      const cbrtR = Math.cbrt(ratio);
      newAutoGen.add(opt.id);
      return {
        ...opt,
        weight: fw  > 0 ? (fw  * ratio).toFixed(2) : opt.weight,
        length: fl  > 0 ? (fl  * cbrtR).toFixed(1) : opt.length,
        width:  fw2 > 0 ? (fw2 * cbrtR).toFixed(1) : opt.width,
        height: fh  > 0 ? (fh  * cbrtR).toFixed(1) : opt.height,
      };
    }));
    setAutoGenerated(newAutoGen);
  }

  function applyFourTimesRule() {
    const batchCostVal = parseFloat(pricing.batchCost) || 0;
    const batchQty     = Math.max(parseFloat(pricing.baseProductQty) || 1, 0.001);
    const baseUc       = batchCostVal > 0 ? batchCostVal / batchQty : (parseFloat(pricing.unitCost) || 0);
    if (optionDetails.length < 2 || !baseUc) return;
    const rawPrices = optionDetails.map((opt, idx) => {
      const isQty = selectedType === "quantidade";
      const qty   = isQty ? extractQty(opt.label) : 1;
      const pkg   = parseFloat(pricing.packagingCost)  || 0;
      const ship  = parseFloat(pricing.shippingCost)   || 0;
      const tx    = parseFloat(pricing.transactionFee) || 0;
      const autoDisc2   = (idx + 1) * (parseFloat(pricing.defaultDiscount) || 0);
      const hasQtyOvr2  = qtyFactors[idx] !== undefined && qtyFactors[idx] !== "";
      const effectDisc2 = hasQtyOvr2 ? (parseFloat(qtyFactors[idx]) || 0) : autoDisc2;
      const factor = pricingMode === "multiplier" ? Math.max(1 - effectDisc2 / 100, 0.01) : 1;
      const totalCost = baseUc * qty;
      const useOvr = perVarEnabled[idx] ?? false;
      const paramOvr = useOvr ? (perVarParam[idx] ?? "") : "";
      let p = 0;
      if (pricingMode === "multiplier") {
        p = totalCost * (parseFloat(paramOvr || pricing.marginMultiplier) || 1) * factor;
      } else if (pricingMode === "margin") {
        p = solvePriceByMargin(totalCost, pkg, ship, tx, parseFloat(paramOvr || pricing.desiredMargin) || 0);
      } else {
        p = solvePriceByMinProfit(totalCost, pkg, ship, tx, parseFloat(paramOvr || pricing.minProfit) || 0);
      }
      return p;
    });
    const validPrices = rawPrices.filter(p => p > 0);
    if (validPrices.length < 2) return;
    const minP = Math.min(...validPrices);
    const maxAllowed = minP * 4;
    const newOverrides = rawPrices.map(p => p > maxAllowed && p > 0 ? maxAllowed : null);
    const alerts = optionDetails
      .map((opt, i) => rawPrices[i] > maxAllowed
        ? { idx: i, label: opt.label, oldPrice: rawPrices[i], newPrice: maxAllowed }
        : null)
      .filter((x): x is NonNullable<typeof x> => x !== null);
    setPriceOverrides(newOverrides);
    setAutoGenAlerts(alerts);
  }

  // Bloqueia avanço se alguma variação tiver margem negativa
  const hasNegativeMargin = pricing.unitCost
    ? optionDetails.some((o, i) => computePricing(o, i).marginContribution < 0)
    : false;

  function priceRangeAlert(): string | null {
    if (!pricing.unitCost || optionDetails.length < 2) return null;
    const prices = optionDetails.map((o, i) => computePricing(o, i).price).filter(p => p > 0);
    if (prices.length < 2) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (max > min * 4) {
      const maxIdx = prices.indexOf(max);
      return `"${optionDetails[maxIdx]?.label}" está ${(max / min).toFixed(1)}× mais caro que a menor variação — revise os parâmetros.`;
    }
    return null;
  }

  // ── Etapa A ──
  function goAtoB() { if (selectedType) setStep("B"); }

  // ── Etapa B ──
  function updateLabel(idx: number, val: string) {
    setOptionLabels(labels => labels.map((l, i) => (i === idx ? val : l)));
  }
  function addLabel()               { setOptionLabels(l => [...l, ""]); }
  function removeLabel(idx: number) { setOptionLabels(l => l.filter((_, i) => i !== idx)); }

  async function suggestWithAI() {
    try {
      const result = await optimizeMutation.mutateAsync({ productId: product.id });
      setAiSuggestions(result.keywords?.slice(0, 5) ?? []);
    } catch { setAiSuggestions([]); }
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
    const baseName = product.itemName || "produto";
    const transformed = selectedType === "quantidade"
      ? filled.map(l => {
          const n = parseFloat(l);
          return isNaN(n) ? l : `${n} Unidades de ${baseName}`;
        })
      : filled;
    const opts = transformed.map(label => emptyOption(truncateVariationName(label)));
    setOptionDetails(opts);
    setQtyFactors(opts.map(() => ""));
    setPerVarParam(opts.map(() => ""));
    setPerVarEnabled(opts.map(() => false));
    setPriceOverrides(opts.map(() => null));
    setAutoGenAlerts([]);
    setManuallyEdited(new Set());
    setAutoGenerated(new Set());
    setStep("C");
  }

  // ── Etapa C ──
  function updateDetail(id: string, field: keyof Omit<VariationOption, "id" | "label">, value: string) {
    setOptionDetails(opts => opts.map(o => (o.id === id ? { ...o, [field]: value } : o)));
  }

  function suggestDimensions(id: string) {
    setOptionDetails(opts => opts.map(o => {
      if (o.id !== id) return o;
      const isQty = selectedType === "quantidade";
      const qty = isQty ? extractQty(o.label) : 1;
      const baseProductQty = Math.max(parseFloat(pricing.baseProductQty) || 1, 0.001);
      const baseWeight = parseFloat(baseWeightOverride || product.weight) || 0.5;
      const baseL = parseFloat(baseLengthOverride || product.dimensionLength) || 20;
      const baseW = parseFloat(baseWidthOverride  || product.dimensionWidth)  || 15;
      const baseH = parseFloat(baseHeightOverride || product.dimensionHeight) || 10;
      const ratio = isQty ? qty / baseProductQty : 1;
      const scale = Math.cbrt(ratio);
      return {
        ...o,
        weight: o.weight || (baseWeight * ratio).toFixed(2),
        length: o.length || (baseL * scale).toFixed(1),
        width:  o.width  || (baseW * scale).toFixed(1),
        height: o.height || (baseH * scale).toFixed(1),
      };
    }));
  }

  // Auto-hide undo toast after 10s (user has that window to restore).
  useEffect(() => {
    if (!undoToastVisible) return;
    const t = setTimeout(() => {
      setUndoToastVisible(false);
      setUndoSnapshot(null);
    }, 10_000);
    return () => clearTimeout(t);
  }, [undoToastVisible]);

  // "Gerar tudo com IA" — single LLM call that yields title, description, and
  // a short (≤20ch) name for each local variation. Captures an undo snapshot
  // first so the user can restore manually-edited content within 10s.
  async function handleGenerateAll() {
    if (optionDetails.length === 0) return;

    setUndoSnapshot({
      title: selectedTitle || (adContent?.titulo_principal ?? ""),
      description: editedDesc || (adContent?.descricao ?? ""),
      optionLabels: optionDetails.map((o) => ({ id: o.id, label: o.label })),
    });

    setAdLoadingSection("all");
    try {
      const attributes = Object.entries(attributeValues)
        .filter(([, v]) => v.originalValue.trim() !== "")
        .map(([attrId, v]) => {
          const def = Array.isArray(categoryAttributes)
            ? (categoryAttributes as any[]).find((a) => Number(a.attribute_id) === Number(attrId))
            : null;
          return {
            name: def?.display_attribute_name ?? def?.original_attribute_name ?? `attr_${attrId}`,
            value: v.originalValue,
          };
        });

      const variations = optionDetails.map((opt, idx) => {
        const c = computePricing(opt, idx);
        return {
          label: opt.label,
          qty: c.qty,
          weight: opt.weight || c.weight.toFixed(2),
          dimensions: `${opt.length || c.length.toFixed(1)}×${opt.width || c.width.toFixed(1)}×${opt.height || c.height.toFixed(1)}`,
          price: c.price.toFixed(2),
        };
      });

      const result = await generateAllMutation.mutateAsync({
        productName: product.itemName || "Produto",
        category: product.categoryName ?? undefined,
        brand: (product as any).brand ?? undefined,
        variationType: typeName,
        variations,
        attributes: attributes.length > 0 ? attributes : undefined,
      });

      setSelectedTitle(result.title);
      setEditedDesc(result.description);
      setEditingDesc(false);
      setAdContent((prev: any) => prev
        ? { ...prev, titulo_principal: result.title, descricao: result.description }
        : {
            titulo_principal: result.title,
            titulos_alternativos: [],
            descricao: result.description,
            hashtags: [],
            tags_seo: [],
            keywords_principais: [],
            score: { titulo: 0, descricao: 0, tags: 0, variacoes: 0, total: 0, nivel: "-", sugestoes: [] },
          });
      setAdTab("titulo");

      // Apply generated variation names. Server already trims to 20 chars but
      // we respect the same limit here to be defensive.
      const byLabel = new Map<string, string>();
      for (const v of result.variationNames) byLabel.set(v.originalLabel, v.generatedName);
      setOptionDetails((opts) =>
        opts.map((o) => {
          const name = byLabel.get(o.label);
          return name ? { ...o, label: name.slice(0, 20) } : o;
        }),
      );

      setUndoToastVisible(true);
    } catch {
      // On failure there's nothing to undo — drop the snapshot.
      setUndoSnapshot(null);
    } finally {
      setAdLoadingSection(null);
    }
  }

  function handleUndoGenerate() {
    if (!undoSnapshot) return;
    setSelectedTitle(undoSnapshot.title);
    setEditedDesc(undoSnapshot.description);
    setEditingDesc(false);
    setAdContent((prev: any) => prev
      ? { ...prev, titulo_principal: undoSnapshot.title, descricao: undoSnapshot.description }
      : prev);
    setOptionDetails((opts) => {
      const byId = new Map(undoSnapshot.optionLabels.map((o) => [o.id, o.label]));
      return opts.map((o) => ({ ...o, label: byId.get(o.id) ?? o.label }));
    });
    setUndoSnapshot(null);
    setUndoToastVisible(false);
  }

  // ── Etapa D ──
  async function generateAdSection(section: "all"|"title"|"desc"|"tags") {
    setAdLoadingSection(section);
    try {
      const variations = optionDetails.map((opt, idx) => {
        const c = computePricing(opt, idx);
        return {
          label: opt.label,
          qty: c.qty,
          weight: opt.weight || c.weight.toFixed(2),
          dimensions: `${opt.length || c.length.toFixed(1)}×${opt.width || c.width.toFixed(1)}×${opt.height || c.height.toFixed(1)}`,
          price: c.price.toFixed(2),
        };
      });
      const result = await generateAdMutation.mutateAsync({
        productName: product.itemName || "Produto",
        category: product.categoryName ?? undefined,
        variationType: typeName,
        variations,
      });
      if (section === "all" || section === "title") {
        setAdContent((prev: any) => prev
          ? { ...prev, titulo_principal: result.titulo_principal, titulos_alternativos: result.titulos_alternativos }
          : result);
        setSelectedTitle(result.titulo_principal || "");
        if (section === "all") setAdTab("titulo");
      }
      if (section === "all" || section === "desc") {
        setAdContent((prev: any) => prev
          ? { ...prev, descricao: result.descricao }
          : result);
        setEditedDesc(result.descricao || "");
        setEditingDesc(false);
        if (section === "desc") setAdTab("descricao");
      }
      if (section === "all" || section === "tags") {
        setAdContent((prev: any) => prev
          ? { ...prev, hashtags: result.hashtags, tags_seo: result.tags_seo, keywords_principais: result.keywords_principais, score: result.score }
          : result);
        if (section === "tags") setAdTab("tags");
      }
      // Para "all", inicializa tudo do resultado
      if (section === "all" && !adContent) {
        setAdContent(result);
        setSelectedTitle(result.titulo_principal || "");
        setEditedDesc(result.descricao || "");
        setEditingDesc(false);
        setAdTab("titulo");
      }
    } catch {
      // erro silencioso — usuário pode tentar novamente
    } finally {
      setAdLoadingSection(null);
    }
  }

  function handleSave() {
    const opts = optionDetails.map((o, i) => {
      const c = computePricing(o, i);
      return {
        ...o,
        label:  inlineLabelEdits[o.id] ?? o.label,
        weight: o.weight || c.weight.toFixed(2),
        length: o.length || c.length.toFixed(1),
        width:  o.width  || c.width.toFixed(1),
        height: o.height || c.height.toFixed(1),
        price:  inlinePriceEdits[o.id] || o.price || (c.price > 0 ? c.price.toFixed(2) : ""),
      };
    });
    onSave({ id: uid(), type: selectedType!, typeName, options: opts });
  }

  async function handlePublishToShopee(
    overrideModeArg?: "create" | "promote",
    newItemNameArg?: string,
  ) {
    // overrideModeArg / newItemNameArg bypass React's async setState —
    // pickDecision uses them to fire the mutation with the freshly-chosen
    // values without waiting for a re-render.
    const effectiveOverrideMode = overrideModeArg ?? overrideMode;
    const effectiveNewItemName = newItemNameArg ?? newItemName;
    const opts = optionDetails.map((o, i) => {
      const c = computePricing(o, i);
      const rawPrice = inlinePriceEdits[o.id] || o.price || (c.price > 0 ? c.price.toFixed(2) : "0");
      const rawWeight = o.weight || c.weight.toFixed(2);
      const rawLength = o.length || c.length.toFixed(1);
      const rawWidth  = o.width  || c.width.toFixed(1);
      const rawHeight = o.height || c.height.toFixed(1);
      return {
        label:  inlineLabelEdits[o.id] ?? o.label,
        price:  Math.max(parseFloat(rawPrice)  || 0, 0.01),
        stock:  Math.max(parseInt(o.stock || "0", 10), 0),
        weight: Math.max(parseFloat(rawWeight) || 0.1, 0.01),
        length: parseFloat(rawLength) > 0 ? parseFloat(rawLength) : undefined,
        width:  parseFloat(rawWidth)  > 0 ? parseFloat(rawWidth)  : undefined,
        height: parseFloat(rawHeight) > 0 ? parseFloat(rawHeight) : undefined,
        sku:    o.sku.trim() || undefined,
        ean:    o.ean.trim() || undefined,
      };
    });

    // Client-side EAN validation. Server validates too, but we want a nicer
    // message than the raw "EAN inválido" thrown from the publish module.
    for (const v of opts) {
      if (v.ean && !isValidEan(v.ean)) {
        setPublishError(`EAN "${v.ean}" inválido: deve ter 8, 12, 13 ou 14 dígitos.`);
        setPublishStatus("error");
        return;
      }
    }

    const validOpts = opts.filter(v => v.price > 0);
    if (validOpts.length === 0) return;

    const title = selectedTitle || adContent?.titulo_principal || product.itemName || "";
    const description = editedDesc || adContent?.descricao || product.description || "";
    const hashtags: string[] = adContent?.hashtags ?? [];

    // Build attribute_list from Ficha Técnica values
    const attributes = Object.entries(attributeValues)
      .filter(([, v]) => v.originalValue.trim() !== "")
      .map(([attrId, v]) => ({
        attributeId: parseInt(attrId),
        attributeValueList: [{ valueId: v.valueId, originalValueName: v.originalValue }],
      }));

    setPublishStatus("loading");
    setPublishError("");
    try {
      const result = await publishMutation.mutateAsync({
        accountId,
        sourceProductId: product.id,
        variationTypeName: typeName,
        variations: validOpts,
        title,
        description,
        hashtags,
        attributes: attributes.length > 0 ? attributes : undefined,
        overrideMode: effectiveOverrideMode,
        newItemName: effectiveOverrideMode === "create" ? effectiveNewItemName : undefined,
        // Only forward categoryId if the user actually changed it — avoids
        // no-op overrides on the happy-path update.
        categoryId:
          selectedCategoryId && selectedCategoryId !== initialCategoryId
            ? selectedCategoryId
            : undefined,
        // Brand: extraído dos attributes da Etapa 3 (input_type=BRAND), não
        // mais de um picker separado. O backend já lê brand via attribute_list.
      });
      setPublishResult({ itemId: result.itemId, itemUrl: result.itemUrl, mode: result.mode });
      setPublishStatus("success");
    } catch (e: any) {
      const msg: string = e?.message || "";
      // Tolerant substring match: the server may or may not keep the [brackets]
      // across error formatters/wrappers, so we match the bare code.
      if (msg.includes("NEEDS_USER_DECISION")) {
        setPublishStatus("idle");
        setOverrideMode(undefined);
        setShowDecisionModal(true);
        return;
      }
      setPublishError(msg || "Erro desconhecido ao publicar");
      setPublishStatus("error");
    }
  }

  function pickDecision(mode: "create" | "promote", name?: string) {
    setOverrideMode(mode);
    setShowDecisionModal(false);
    setShowNameEditor(false);
    if (mode === "create" && name) setNewItemName(name);
    void handlePublishToShopee(mode, mode === "create" ? name : undefined);
  }

  function stepBack() {
    const prev = ({ B: "A", C: "B", D: "C" } as Record<string, WizardStep>)[step];
    if (prev) setStep(prev);
  }

  function removeVariationInReview(id: string) {
    const idx = optionDetails.findIndex(o => o.id === id);
    if (idx === -1) return;
    setOptionDetails(opts => opts.filter((_, i) => i !== idx));
    setQtyFactors(f => f.filter((_, i) => i !== idx));
    setPerVarParam(p => p.filter((_, i) => i !== idx));
    setPerVarEnabled(e => e.filter((_, i) => i !== idx));
    setPriceOverrides(p => p.filter((_, i) => i !== idx));
    setInlinePriceEdits(edits => { const n = { ...edits }; delete n[id]; return n; });
    setInlineLabelEdits(edits => { const n = { ...edits }; delete n[id]; return n; });
  }

  const rangeAlert   = step === "C" ? priceRangeAlert() : null;
  const hasPricing   = parseFloat(pricing.unitCost) > 0 || parseFloat(pricing.batchCost) > 0;

  function replicateGlobalParams() {
    setPerVarEnabled(optionDetails.map(() => false));
    setPerVarParam(optionDetails.map(() => ""));
    setPriceOverrides(optionDetails.map(() => null));
    setQtyFactors(optionDetails.map(() => ""));
    setAutoGenAlerts([]);
    if (pricing.globalStock) {
      setOptionDetails(opts => opts.map(o => ({ ...o, stock: pricing.globalStock })));
    }
  }

  async function autoFillAttributes() {
    if (!categoryAttributes || (categoryAttributes as any[]).length === 0) return;
    setAiFillingAttrs(true);
    try {
      const attrs = categoryAttributes as Array<{
        attribute_id: number;
        display_attribute_name: string;
        is_mandatory: boolean;
        input_type: string;
        attribute_value_list: Array<{ value_id: number; display_value_name: string }>;
      }>;
      const suggestions = await fillAttrsMutation.mutateAsync({
        product: {
          name: product.itemName || "",
          description: (product.description || "").slice(0, 2000),
          features: {},
          category: product.categoryName || "",
        },
        requiredAttributes: attrs.map(a => ({
          name: a.display_attribute_name,
          id: String(a.attribute_id),
          required: a.is_mandatory,
          options: (a.attribute_value_list ?? []).slice(0, 30).map(o => o.display_value_name),
        })),
        marketplace: "shopee",
      });
      setAttributeValues(prev => {
        const next = { ...prev };
        for (const s of suggestions) {
          if (!s.value) continue;
          const attrId = parseInt(s.attributeId);
          const attrDef = attrs.find(a => a.attribute_id === attrId);
          if (!attrDef) continue;
          if (attrDef.input_type === "DROP_DOWN") {
            const valueLower = s.value.toLowerCase();
            const match = (attrDef.attribute_value_list ?? []).find(
              o => o.display_value_name.toLowerCase() === valueLower
            ) ?? (attrDef.attribute_value_list ?? []).find(
              o => o.display_value_name.toLowerCase().includes(valueLower) ||
                   valueLower.includes(o.display_value_name.toLowerCase())
            );
            if (match) next[attrId] = { valueId: match.value_id, originalValue: match.display_value_name };
          } else {
            next[attrId] = { valueId: 0, originalValue: s.value };
          }
        }
        return next;
      });
    } catch {
      // silent — user can fill manually
    }
    setAiFillingAttrs(false);
  }

  // Labels por modo
  const modeParamLabel = pricingMode === "multiplier" ? "Multiplicador" : pricingMode === "margin" ? "Margem %" : "Lucro mín. R$";
  const modeGlobalKey  = pricingMode === "multiplier" ? "marginMultiplier" as const : pricingMode === "margin" ? "desiredMargin" as const : "minProfit" as const;
  const modeGlobalPlaceholder = pricingMode === "multiplier" ? "2.5" : pricingMode === "margin" ? "30" : "20";

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
                  step === s.key ? "bg-orange-500 border-orange-500 text-white"
                  : currentStepIndex > i ? "bg-orange-100 border-orange-300 text-orange-600"
                  : "bg-gray-100 border-gray-300 text-gray-400"
                }`}>
                  {currentStepIndex > i ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${step === s.key ? "text-orange-600" : "text-gray-400"}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 rounded-full ${currentStepIndex > i ? "bg-orange-300" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── ETAPA A – Tipo ── */}
          {step === "A" && (
            <div>
              <p className="text-sm text-gray-600 mb-4">Qual tipo de variação você quer criar?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {VARIATION_TYPES.map(vt => (
                  <button key={vt.type} onClick={() => setSelectedType(vt.type)}
                    className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                      selectedType === vt.type ? "border-orange-500 bg-orange-50" : "border-gray-200 hover:border-orange-300 bg-white"
                    }`}>
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

          {/* ── ETAPA B – Opções ── */}
          {step === "B" && (
            <div>
              <p className="text-sm text-gray-600 mb-1">
                Digite cada opção <span className="font-semibold text-gray-800">({typeName})</span>:
              </p>
              <p className="text-xs text-gray-400 mb-4">Ex: "100 unidades", "Azul", "Grande"...</p>
              <div className="space-y-2 mb-3">
                {optionLabels.map((label, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input type="text" value={label} onChange={e => updateLabel(idx, e.target.value)} placeholder={`Opção ${idx + 1}`}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
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
                  <button onClick={suggestWithAI} disabled={optimizeMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg transition disabled:opacity-60">
                    {optimizeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Sugerir com IA
                  </button>
                </div>
                {aiSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {aiSuggestions.map(s => (
                      <button key={s} onClick={() => applySuggestion(s)} className="px-2.5 py-1 bg-white border border-orange-300 text-orange-700 text-xs rounded-full hover:bg-orange-100 transition">+ {s}</button>
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

          {/* ── ETAPA C – Detalhes + Precificação ── */}
          {step === "C" && (
            <div className="space-y-5">

              {/* Alertas */}
              {hasNegativeMargin && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-300 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 font-medium">Uma ou mais variações com margem negativa — revise os parâmetros antes de avançar.</p>
                </div>
              )}
              {rangeAlert && !hasNegativeMargin && autoGenAlerts.length === 0 && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">{rangeAlert}</p>
                </div>
              )}
              {autoGenAlerts.length > 0 && (
                <div className="space-y-1.5">
                  {autoGenAlerts.map(a => (
                    <div key={a.idx} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
                      <span>Preço da variação <b>{a.idx + 1} "{a.label}"</b> ajustado de <b>R${a.oldPrice.toFixed(2)}</b> para <b>R${a.newPrice.toFixed(2)}</b> para respeitar o limite 4× da Shopee.</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Seletor de modo ── */}
              <div className="flex rounded-xl overflow-hidden border border-gray-200">
                {([
                  { key: "multiplier" as PricingMode, label: "Multiplicador" },
                  { key: "margin"     as PricingMode, label: "Margem %"      },
                  { key: "profit"     as PricingMode, label: "Lucro R$"      },
                ] as const).map(m => (
                  <button key={m.key} onClick={() => setPricingMode(m.key)}
                    className={`flex-1 py-2 text-sm font-semibold transition-all ${
                      pricingMode === m.key
                        ? "bg-orange-500 text-white"
                        : "bg-white text-gray-500 hover:bg-orange-50"
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Descrição do modo */}
              <div className="text-xs text-gray-500 -mt-2 px-1">
                {pricingMode === "multiplier" && "Preço = custo × quantidade × multiplicador. Desconto por faixa reduz o multiplicador a cada variação."}
                {pricingMode === "margin"     && "Preço calculado via iteração para atingir exatamente a margem desejada, considerando a tabela de comissões Shopee 2026."}
                {pricingMode === "profit"     && "Preço calculado via iteração para garantir o lucro mínimo em R$ por variação, considerando todos os custos da Shopee."}
              </div>

              {/* ── Produto base ── */}
              {selectedType === "quantidade" && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Produto base cadastrado</p>
                  <p className="text-xs text-blue-500 mb-3">
                    Quantas unidades o produto "{product.itemName}" representa? Peso e dimensões serão calculados proporcionalmente.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1 font-medium">Qtd. do produto base (un.)</label>
                      <input
                        type="number" min="0.001" step="1" placeholder="1"
                        value={pricing.baseProductQty}
                        onChange={e => setPricing(p => ({ ...p, baseProductQty: e.target.value }))}
                        className="w-full px-3 py-2 border border-blue-300 bg-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1 font-medium">Custo total do lote (R$)</label>
                      <input
                        type="number" min="0" step="0.01" placeholder="ex: 50.00"
                        value={pricing.batchCost}
                        onChange={e => setPricing(p => ({ ...p, batchCost: e.target.value }))}
                        className="w-full px-3 py-2 border border-blue-300 bg-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      {pricing.batchCost && pricing.baseProductQty && (
                        <p className="text-xs text-blue-700 mt-0.5 font-medium">
                          Custo unit.: R${(parseFloat(pricing.batchCost) / Math.max(parseFloat(pricing.baseProductQty) || 1, 0.001)).toFixed(4)}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-blue-600 space-y-0.5 pt-5">
                      {product.weight       && <p>Peso base: <b>{product.weight} kg</b></p>}
                      {product.dimensionLength && <p>Dims: <b>{product.dimensionLength}×{product.dimensionWidth}×{product.dimensionHeight} cm</b></p>}
                    </div>
                  </div>
                  {(() => {
                    const bq = Math.max(parseFloat(pricing.baseProductQty) || 1, 0.001);
                    const bw = parseFloat(baseWeightOverride || product.weight) || 0;
                    const bl = parseFloat(baseLengthOverride || product.dimensionLength) || 0;
                    const bwi = parseFloat(baseWidthOverride  || product.dimensionWidth)  || 0;
                    const bh = parseFloat(baseHeightOverride  || product.dimensionHeight) || 0;
                    const exampleQty = extractQty(optionDetails[0]?.label ?? "") || bq;
                    const ratio = exampleQty / bq;
                    const sc = Math.cbrt(ratio);
                    if (!bw && !bl) return null;
                    return (
                      <div className="mt-3 pt-3 border-t border-blue-200 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-blue-700">
                        <span className="bg-white border border-blue-100 rounded px-2 py-1">
                          Ex. {exampleQty}un → Peso: <b>{bw > 0 ? (bw * ratio).toFixed(2) : "—"} kg</b>
                        </span>
                        <span className="bg-white border border-blue-100 rounded px-2 py-1">
                          Comp: <b>{bl > 0 ? (bl * sc).toFixed(1) : "—"} cm</b>
                        </span>
                        <span className="bg-white border border-blue-100 rounded px-2 py-1">
                          Larg: <b>{bwi > 0 ? (bwi * sc).toFixed(1) : "—"} cm</b>
                        </span>
                        <span className="bg-white border border-blue-100 rounded px-2 py-1">
                          Alt: <b>{bh > 0 ? (bh * sc).toFixed(1) : "—"} cm</b>
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Campos globais ── */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Parâmetros globais</p>
                  {optionDetails.length > 1 && (
                    <button onClick={replicateGlobalParams}
                      className="flex items-center gap-1.5 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 px-3 py-1.5 rounded-lg transition">
                      ↺ Replicar para todas as variações
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Custo unitário (R$)</label>
                    <input type="number" min="0" step="0.001" placeholder="0.50" value={pricing.unitCost}
                      onChange={e => setPricing(p => ({ ...p, unitCost: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                    <p className="text-xs text-gray-400 mt-0.5">Custo por unidade individual</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Custo embalagem (R$)</label>
                    <input type="number" min="0" step="0.01" placeholder="2.00" value={pricing.packagingCost}
                      onChange={e => setPricing(p => ({ ...p, packagingCost: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Taxa transação (%)</label>
                    <input type="number" min="0" step="0.1" placeholder="2" value={pricing.transactionFee}
                      onChange={e => setPricing(p => ({ ...p, transactionFee: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  </div>

                  {/* Parâmetro específico do modo */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      {modeParamLabel} {pricingMode !== "profit" ? "(global)" : "mín. R$ (global)"}
                    </label>
                    <input type="number" min="0" step={pricingMode === "multiplier" ? "0.1" : "1"} placeholder={modeGlobalPlaceholder}
                      value={pricing[modeGlobalKey]}
                      onChange={e => setPricing(p => ({ ...p, [modeGlobalKey]: e.target.value }))}
                      className="w-full px-3 py-2 border border-orange-300 bg-orange-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 font-medium" />
                  </div>

                  {/* Desconto por faixa — só modo 1 */}
                  {pricingMode === "multiplier" && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Desconto por faixa (%)</label>
                      <input type="number" min="0" max="50" step="0.1" placeholder="1" value={pricing.defaultDiscount}
                        onChange={e => setPricing(p => ({ ...p, defaultDiscount: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                    </div>
                  )}
                  {/* Margem mínima desejada */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Margem mínima desejada (%)</label>
                    <input type="number" min="0" max="99" step="1" placeholder="15" value={pricing.minMarginPct}
                      onChange={e => setPricing(p => ({ ...p, minMarginPct: e.target.value }))}
                      className="w-full px-3 py-2 border border-green-300 bg-green-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400 font-medium" />
                    <p className="text-xs text-gray-400 mt-0.5">Preço sobe automaticamente se cair abaixo</p>
                  </div>
                  {/* Estoque global */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Estoque global</label>
                    <input type="number" min="0" step="1" placeholder="0" value={pricing.globalStock}
                      onChange={e => setPricing(p => ({ ...p, globalStock: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                    <p className="text-xs text-gray-400 mt-0.5">Replicar para todas ao clicar no botão</p>
                  </div>
                </div>

                {/* Frete */}
                <div className="border-t border-gray-200 pt-3">
                  <label className="block text-xs text-gray-500 mb-1">
                    Custo de envio estimado (R$)
                    <span className="ml-1 text-gray-400 font-normal">— integração API Shopee em breve</span>
                  </label>
                  <input type="number" min="0" step="0.01" placeholder="0.00" value={pricing.shippingCost}
                    onChange={e => setPricing(p => ({ ...p, shippingCost: e.target.value }))}
                    className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>

                {/* Medidas do produto base — editáveis */}
                <div className="border-t border-gray-200 pt-3 mt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Medidas do produto base (sobrescrever)</p>
                  <p className="text-xs text-gray-400 mb-2">Deixe em branco para usar os dados do produto Shopee. Usado no cálculo proporcional de cada variação.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Peso (kg)</label>
                      <input type="number" min="0" step="0.001"
                        placeholder={product.weight || "0.5"}
                        value={baseWeightOverride}
                        onChange={e => setBaseWeightOverride(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Comp. (cm)</label>
                      <input type="number" min="0" step="0.1"
                        placeholder={product.dimensionLength || "20"}
                        value={baseLengthOverride}
                        onChange={e => setBaseLengthOverride(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Larg. (cm)</label>
                      <input type="number" min="0" step="0.1"
                        placeholder={product.dimensionWidth || "15"}
                        value={baseWidthOverride}
                        onChange={e => setBaseWidthOverride(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Alt. (cm)</label>
                      <input type="number" min="0" step="0.1"
                        placeholder={product.dimensionHeight || "10"}
                        value={baseHeightOverride}
                        onChange={e => setBaseHeightOverride(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                  </div>
                </div>

                {/* Tabela de comissões (informativo) */}
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <p className="text-xs text-gray-400 font-semibold mb-1">Composição do custo Shopee 2026:</p>
                  <div className="space-y-1.5 text-xs text-gray-500">
                    <div className="flex flex-wrap gap-2">
                      <span className="bg-orange-50 border border-orange-100 rounded px-2 py-1">
                        <b className="text-gray-700">Comissão Shopee:</b> &lt; R$8 → 50%+R$0 · R$8–79 → 20%+R$4 · R$80–99 → 14%+R$16 · R$100–199 → 14%+R$20 · R$200+ → 14%+R$26
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="bg-white border border-gray-200 rounded px-2 py-0.5"><b className="text-gray-600">Taxa de Pagamento:</b> configurável no campo acima (padrão 2%)</span>
                      <span className="bg-white border border-gray-200 rounded px-2 py-0.5"><b className="text-gray-600">Embalagem:</b> custo da sua operação (campo acima)</span>
                      <span className="bg-white border border-gray-200 rounded px-2 py-0.5"><b className="text-gray-600">Frete:</b> estimativa manual (API em breve)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Especificações do Produto (Ficha Técnica) ── */}
              {categoryId && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-700">📋 Especificações do Produto</span>
                      {attrLoading && <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
                      {!attrLoading && categoryAttributes && (categoryAttributes as any[]).length > 0 && (
                        <span className="text-xs text-gray-400">
                          {(categoryAttributes as any[]).filter((a: any) => a.is_mandatory).length} obrigatório(s)
                        </span>
                      )}
                    </div>
                    {!attrLoading && categoryAttributes && (categoryAttributes as any[]).length > 0 && (
                      <button
                        onClick={autoFillAttributes}
                        disabled={aiFillingAttrs}
                        className="flex items-center gap-1.5 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 px-3 py-1.5 rounded-lg transition">
                        {aiFillingAttrs
                          ? <><Loader2 className="w-3 h-3 animate-spin" /> Preenchendo…</>
                          : <><Sparkles className="w-3 h-3" /> ✨ Preencher com IA</>}
                      </button>
                    )}
                  </div>

                  {/* Form body */}
                  <div className="p-4 space-y-4">
                    {attrError && (
                      <p className="text-xs text-red-500">Erro ao carregar atributos da categoria.</p>
                    )}
                    {!attrLoading && !attrError && (!categoryAttributes || (categoryAttributes as any[]).length === 0) && (
                      <p className="text-xs text-gray-400">Nenhum atributo disponível para esta categoria.</p>
                    )}

                    {!attrLoading && !attrError && categoryAttributes && (categoryAttributes as any[]).length > 0 && (() => {
                      const attrs = categoryAttributes as Array<{
                        attribute_id: number;
                        display_attribute_name: string;
                        is_mandatory: boolean;
                        input_type: string;
                        attribute_value_list: Array<{ value_id: number; display_value_name: string }>;
                      }>;
                      const mandatory = attrs.filter(a => a.is_mandatory);
                      const optional  = attrs.filter(a => !a.is_mandatory);

                      function renderAttrField(attr: typeof attrs[number]) {
                        const current = attributeValues[attr.attribute_id];
                        const isEmpty = !current || current.originalValue.trim() === "";
                        const border  = attr.is_mandatory && isEmpty ? "border-orange-400" : "border-gray-200";
                        const bg      = attr.is_mandatory && isEmpty ? "bg-orange-50"      : "bg-white";
                        const values: Array<{ value_id: number; display_value_name: string; original_value_name?: string }> =
                          (attr.attribute_value_list as any) ?? (attr as any).options_list ?? [];

                        return (
                          <div key={attr.attribute_id} className="space-y-1">
                            <label className="text-xs font-medium text-gray-600">
                              {attr.display_attribute_name}
                              {attr.is_mandatory && <span className="text-orange-500 ml-0.5">*</span>}
                            </label>
                            {attr.input_type === "BRAND" ? (
                              <input
                                type="text"
                                readOnly
                                value={values[0]?.display_value_name ?? values[0]?.original_value_name ?? ""}
                                className={`w-full text-xs rounded-lg border ${border} bg-gray-50 px-2 py-1.5 text-gray-600`}
                              />
                            ) : attr.input_type === "DROP_DOWN" ? (
                              <select
                                value={current?.valueId ?? ""}
                                onChange={e => {
                                  const opt = values.find(o => o.value_id === Number(e.target.value));
                                  if (opt) {
                                    setAttributeValues(prev => ({ ...prev, [attr.attribute_id]: { valueId: opt.value_id, originalValue: opt.display_value_name } }));
                                  } else {
                                    setAttributeValues(prev => { const n = { ...prev }; delete n[attr.attribute_id]; return n; });
                                  }
                                }}
                                className={`w-full text-xs rounded-lg border ${border} ${bg} px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                              >
                                <option value="">Selecionar…</option>
                                {values.map(o => (
                                  <option key={o.value_id} value={o.value_id}>{o.display_value_name}</option>
                                ))}
                              </select>
                            ) : attr.input_type === "INT_TYPE" ? (
                              <input type="number" step={1}
                                value={current?.originalValue ?? ""}
                                onChange={e => setAttributeValues(prev => ({ ...prev, [attr.attribute_id]: { valueId: 0, originalValue: e.target.value } }))}
                                placeholder="0"
                                className={`w-full text-xs rounded-lg border ${border} ${bg} px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                              />
                            ) : attr.input_type === "FLOAT_TYPE" ? (
                              <input type="number" step={0.01}
                                value={current?.originalValue ?? ""}
                                onChange={e => setAttributeValues(prev => ({ ...prev, [attr.attribute_id]: { valueId: 0, originalValue: e.target.value } }))}
                                placeholder="0.00"
                                className={`w-full text-xs rounded-lg border ${border} ${bg} px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                              />
                            ) : (
                              <input type="text"
                                value={current?.originalValue ?? ""}
                                onChange={e => setAttributeValues(prev => ({ ...prev, [attr.attribute_id]: { valueId: 0, originalValue: e.target.value } }))}
                                placeholder="Digitar…"
                                className={`w-full text-xs rounded-lg border ${border} ${bg} px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                              />
                            )}
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-4">
                          {mandatory.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-orange-600 mb-2">Obrigatórios *</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {mandatory.map(renderAttrField)}
                              </div>
                            </div>
                          )}
                          {optional.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 mb-2">Opcionais</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {optional.map(renderAttrField)}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* ── Cards por variação ── */}
              {optionDetails.map((opt, idx) => {
                const c     = computePricing(opt, idx);
                const badge = profitBadge(c.profitPct);
                const isNeg = c.marginContribution < 0;

                return (
                  <div key={opt.id} className={`border rounded-xl overflow-hidden ${isNeg ? "border-red-300" : "border-gray-200"}`}>
                    {/* Cabeçalho */}
                    <div className={`flex items-center justify-between px-4 py-3 border-b ${isNeg ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
                      <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
                        <span className="text-orange-500 text-sm font-bold flex-shrink-0">{idx + 1}.</span>
                        <input
                          type="text"
                          value={opt.label}
                          onChange={e => {
                            const val = e.target.value.slice(0, 20);
                            updateOptionLabel(opt.id, val);
                            if (idx > 0) {
                              setManuallyEdited(s => new Set(s).add(opt.id));
                              setAutoGenerated(s => { const n = new Set(s); n.delete(opt.id); return n; });
                            }
                          }}
                          className="flex-1 min-w-0 text-sm font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-orange-400 focus:outline-none px-0.5 py-0.5 truncate"
                        />
                        <span className={`flex-shrink-0 text-xs font-mono ${opt.label.length >= 18 ? "text-amber-500 font-semibold" : "text-gray-300"}`}>
                          {opt.label.length}/20
                        </span>
                        {idx > 0 && autoGenerated.has(opt.id) && (
                          <span className="flex-shrink-0 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">⚡ Auto</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {c.effectiveDisc > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                            -{c.effectiveDisc.toFixed(1)}%
                          </span>
                        )}
                        {hasPricing && isNeg && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white border border-red-700 animate-pulse">
                            PREJUÍZO
                          </span>
                        )}
                        {hasPricing && !isNeg && (
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${badge.bg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                            {c.profitPct.toFixed(1)}% lucro
                            {c.minMarginAdjusted && <span className="ml-0.5 text-green-600" title="Preço ajustado para atingir margem mínima">↑</span>}
                          </span>
                        )}
                        {idx === 0 && optionDetails.length > 1 && (
                          <button onClick={autoGenerateFromFirst}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-2 py-1 bg-white transition">
                            <Sparkles className="w-3 h-3" /> Propagar para demais
                          </button>
                        )}
                        <button onClick={() => suggestDimensions(opt.id)}
                          className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 border border-orange-200 rounded-lg px-2 py-1 bg-white transition">
                          <Sparkles className="w-3 h-3" /> IA dimensões
                        </button>
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Override por variação */}
                      <div className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-100 rounded-lg">
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600 select-none">
                          <input type="checkbox" checked={perVarEnabled[idx] ?? false}
                            onChange={e => setPerVarEnabled(arr => { const n = [...arr]; n[idx] = e.target.checked; return n; })}
                            className="accent-orange-500 w-3.5 h-3.5" />
                          {modeParamLabel} individual para esta variação
                        </label>
                        {(perVarEnabled[idx] ?? false) && (
                          <input type="number" min="0" step={pricingMode === "multiplier" ? "0.1" : "1"}
                            placeholder={modeGlobalPlaceholder}
                            value={perVarParam[idx] ?? ""}
                            onChange={e => setPerVarParam(arr => { const n = [...arr]; n[idx] = e.target.value; return n; })}
                            className="w-24 px-2 py-1.5 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white font-medium" />
                        )}
                        {!(perVarEnabled[idx] ?? false) && (
                          <span className="text-xs text-gray-400">usando global: <b className="text-gray-600">{pricing[modeGlobalKey] || modeGlobalPlaceholder}</b></span>
                        )}
                      </div>

                      {/* Campos de dimensão + estoque */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {([
                          { field: "weight" as const, label: "Peso (kg)",        ph: c.weight > 0 ? c.weight.toFixed(2) : "0.50",            sv: "0.01", integer: false },
                          { field: "length" as const, label: "Comprimento (cm)", ph: c.length > 0 ? String(Math.round(c.length)) : "20",     sv: "1",    integer: true  },
                          { field: "width"  as const, label: "Largura (cm)",     ph: c.width  > 0 ? String(Math.round(c.width))  : "15",     sv: "1",    integer: true  },
                          { field: "height" as const, label: "Altura (cm)",      ph: c.height > 0 ? String(Math.round(c.height)) : "10",     sv: "1",    integer: true  },
                          { field: "stock"  as const, label: "Estoque",          ph: "0",                                                     sv: "1",    integer: false },
                        ]).map(({ field, label, ph, sv, integer }) => (
                          <div key={field}>
                            <label className="block text-xs text-gray-500 mb-1">{label}</label>
                            <input type="number" min={integer ? "1" : "0"} step={sv} placeholder={ph} value={(opt as any)[field]}
                              onKeyDown={integer ? (e) => { if (e.key === "." || e.key === ",") e.preventDefault(); } : undefined}
                              onChange={e => {
                                let v = e.target.value;
                                if (integer && v !== "") v = String(Math.floor(Number(v) || 0));
                                updateDetail(opt.id, field, v);
                                if (idx > 0) {
                                  setManuallyEdited(s => new Set(s).add(opt.id));
                                  setAutoGenerated(s => { const n = new Set(s); n.delete(opt.id); return n; });
                                }
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                            {integer && <p className="text-[10px] text-gray-400 mt-0.5">Apenas números inteiros (cm)</p>}
                          </div>
                        ))}
                        {pricingMode === "multiplier" && (
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
                              Desconto faixa (%)
                              <span className="ml-1 text-gray-400 font-normal">
                                auto: {((idx + 1) * (parseFloat(pricing.defaultDiscount) || 0)).toFixed(1)}%
                              </span>
                            </label>
                            <input type="number" min="0" max="100" step="0.1"
                              placeholder={String(((idx + 1) * (parseFloat(pricing.defaultDiscount) || 0)).toFixed(1))}
                              value={qtyFactors[idx] ?? ""}
                              onChange={e => setQtyFactors(f => { const n = [...f]; n[idx] = e.target.value; return n; })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                          </div>
                        )}
                      </div>

                      {/* Identificação (SKU, EAN) + preço manual por variação */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">SKU <span className="text-gray-400 font-normal">(opcional)</span></label>
                          <input
                            type="text"
                            maxLength={64}
                            placeholder={product.itemSku ? `${product.itemSku}-${idx + 1}` : "Ex: SAC-15L-100"}
                            value={opt.sku}
                            onChange={(e) => updateDetail(opt.id, "sku", e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            Preço manual (R$) <span className="text-gray-400 font-normal">(sobrescreve calculado)</span>
                          </label>
                          <input
                            type="number" min="0.01" step="0.01"
                            placeholder={c.price > 0 ? c.price.toFixed(2) : "0.00"}
                            value={opt.price}
                            onChange={(e) => updateDetail(opt.id, "price", e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                          />
                        </div>
                        {/* EAN: Shopee só aceita GTIN a nível de produto, não por model.
                            Mostra só quando há uma única variação. */}
                        {optionDetails.length === 1 ? (
                          <div className="sm:col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">
                              EAN / GTIN <span className="text-gray-400 font-normal">(8, 12, 13 ou 14 dígitos)</span>
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={14}
                              placeholder="7891234567890"
                              value={opt.ean}
                              onChange={(e) => updateDetail(opt.id, "ean", e.target.value.replace(/\D/g, ""))}
                              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono ${
                                opt.ean && !isValidEan(opt.ean) ? "border-red-400" : "border-gray-300"
                              }`}
                            />
                            {opt.ean && !isValidEan(opt.ean) && (
                              <p className="text-[10px] text-red-500 mt-0.5">
                                EAN inválido: deve ter 8, 12, 13 ou 14 dígitos.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="sm:col-span-2 bg-gray-50 border border-dashed border-gray-300 rounded-lg p-2 text-[11px] text-gray-500">
                            💡 A Shopee só permite EAN a nível de produto, não por variação. Com {optionDetails.length} variações, o EAN fica desabilitado.
                          </div>
                        )}
                      </div>

                      {/* Painel de resultado calculado */}
                      {hasPricing && (
                        <div className={`border rounded-lg p-3 ${isNeg ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-100"}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                              <TrendingUp className="w-3.5 h-3.5 text-orange-500" /> Preço calculado
                            </span>
                            <span className={`text-lg font-bold ${isNeg ? "text-red-600" : "text-orange-600"}`}>
                              R$ {c.price.toFixed(2)}
                            </span>
                          </div>
                          {(() => {
                            const commissionAmt = c.price * c.commissionRate + c.commissionFixed;
                            const txAmt  = c.price * ((parseFloat(pricing.transactionFee) || 0) / 100);
                            const pkgAmt = parseFloat(pricing.packagingCost) || 0;
                            const shipAmt = parseFloat(pricing.shippingCost) || 0;
                            return (
                              <div className="space-y-1.5 text-xs text-gray-500">
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                  <span>Qtd. vendida: <b className="text-gray-700">{c.qty}×</b></span>
                                  <span>Custo do produto: <b className="text-gray-700">R$ {c.totalProductCost.toFixed(2)}</b></span>
                                </div>
                                <div className="border-t border-gray-100 pt-1 space-y-1">
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                    <span title="Comissão percentual + valor fixo por faixa de preço">
                                      Comissão Shopee: <b className="text-gray-700">R$ {commissionAmt.toFixed(2)}</b>
                                      <span className="block text-gray-400" style={{fontSize:"10px"}}>{shopeeCommissionLabel(c.price)}</span>
                                    </span>
                                    <span title="Taxa da processadora de pagamento">Taxa de pagamento: <b className="text-gray-700">R$ {txAmt.toFixed(2)}</b></span>
                                    {pkgAmt > 0 && <span title="Custo de embalagem da sua operação">Embalagem: <b className="text-gray-700">R$ {pkgAmt.toFixed(2)}</b></span>}
                                    {shipAmt > 0 && <span title="Frete subsidiado / estimativa de envio">Frete estimado: <b className="text-gray-700">R$ {shipAmt.toFixed(2)}</b></span>}
                                    <span className="col-span-2 border-t border-gray-100 pt-1">
                                      Total custos plataforma: <b className="text-gray-700">R$ {c.platformCost.toFixed(2)}</b>
                                    </span>
                                  </div>
                                </div>
                                <div className="border-t border-gray-100 pt-1 grid grid-cols-2 gap-x-4 font-medium">
                                  <span>Margem: <b className={c.marginContribution >= 0 ? "text-green-700" : "text-red-600"}>R$ {c.marginContribution.toFixed(2)}</b></span>
                                  <span>Lucro s/ preço: <b className={badge.bg.split(" ")[1]}>{c.profitPct.toFixed(1)}%</b></span>
                                </div>
                              </div>
                            );
                          })()}
                          {isNeg && (
                            <p className="text-xs text-red-600 font-semibold mt-2 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" /> Margem negativa — ajuste o custo ou o parâmetro de precificação.
                            </p>
                          )}
                          {!isNeg && c.minMarginAdjusted && (
                            <p className="text-xs text-green-700 font-medium mt-2 flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" /> Preço ajustado para atingir margem mínima de {pricing.minMarginPct}%
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── ETAPA D – Revisão + Geração IA ── */}
          {step === "D" && (
            <div className="space-y-4">

              {/* Banner: produto já tem variação na Shopee (modo edição não disponível) */}
              {hasExistingVariation && existingVariation && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex gap-3 items-start">
                  <span className="text-2xl flex-shrink-0">⚠️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-900 mb-1">
                      Este produto já tem variação na Shopee
                    </p>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      Variação atual:&nbsp;
                      <b>{existingVariation.tierVariation?.[0]?.name || "—"}</b>
                      &nbsp;com&nbsp;
                      <b>{existingVariation.modelCount ?? 0} opção(ões)</b>.
                      O modo de edição de variações existentes ainda não está implementado.
                      Pra alterar variações deste produto, use o painel oficial da Shopee.
                    </p>
                    {existingVariation.itemId && (
                      <a
                        href={`https://seller.shopee.com.br/portal/product/${existingVariation.itemId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-amber-700 hover:text-amber-900 underline"
                      >
                        Abrir na Shopee →
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Resumo das variações */}
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                    {typeName} · {optionDetails.length} opção(ões)
                  </p>
                  <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded px-2 py-0.5">
                    {pricingMode === "multiplier" ? "Multiplicador" : pricingMode === "margin" ? "Margem %" : "Lucro R$"}
                  </span>
                </div>
                <div className="space-y-2">
                  {optionDetails.map((opt, idx) => {
                    const c = computePricing(opt, idx);
                    const badge = profitBadge(c.profitPct);
                    return (
                      <div key={opt.id} className="bg-white rounded-lg border border-orange-100 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          {/* Label editável inline */}
                          <div className="flex-1 min-w-0">
                            {inlineLabelEdits[opt.id] !== undefined ? (
                              <div className="flex items-center gap-1">
                                <span className="text-orange-500 text-sm font-bold flex-shrink-0">{idx + 1}.</span>
                                <input
                                  type="text" maxLength={20}
                                  value={inlineLabelEdits[opt.id]}
                                  onChange={e => setInlineLabelEdits(p => ({ ...p, [opt.id]: e.target.value.slice(0, 20) }))}
                                  onBlur={() => {
                                    const v = inlineLabelEdits[opt.id].trim();
                                    if (v) setOptionDetails(opts => opts.map(o => o.id === opt.id ? { ...o, label: v } : o));
                                    setInlineLabelEdits(p => { const n = { ...p }; delete n[opt.id]; return n; });
                                  }}
                                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                  className="flex-1 min-w-0 text-sm font-semibold text-gray-800 border border-orange-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
                                  autoFocus
                                />
                                <span className="text-xs text-gray-400 font-mono">{inlineLabelEdits[opt.id].length}/20</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => setInlineLabelEdits(p => ({ ...p, [opt.id]: opt.label }))}
                                className="text-sm font-semibold text-gray-800 hover:text-orange-600 text-left truncate w-full"
                                title="Clique para editar o nome"
                              >
                                <span className="text-orange-500">{idx + 1}.</span> {opt.label}
                                <span className="ml-1 text-gray-300 text-xs">✏️</span>
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {c.effectiveDisc > 0 && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 font-semibold">
                                -{c.effectiveDisc.toFixed(1)}%
                              </span>
                            )}
                            {hasPricing && (
                              <>
                                {inlinePriceEdits[opt.id] !== undefined ? (
                                  <input
                                    type="number" min="0" step="0.01"
                                    value={inlinePriceEdits[opt.id]}
                                    onChange={e => setInlinePriceEdits(p => ({ ...p, [opt.id]: e.target.value }))}
                                    onBlur={() => {
                                      if (!inlinePriceEdits[opt.id]) {
                                        setInlinePriceEdits(p => { const n = { ...p }; delete n[opt.id]; return n; });
                                      }
                                    }}
                                    className="w-24 px-2 py-1 border border-orange-400 rounded text-sm font-bold text-orange-600 focus:outline-none focus:ring-1 focus:ring-orange-400"
                                    autoFocus
                                  />
                                ) : (
                                  <button
                                    onClick={() => setInlinePriceEdits(p => ({ ...p, [opt.id]: c.price.toFixed(2) }))}
                                    className="text-sm font-bold text-orange-600 hover:underline hover:text-orange-700 transition"
                                    title="Clique para editar o preço"
                                  >
                                    R$ {c.price.toFixed(2)}
                                  </button>
                                )}
                                <span className={`text-xs px-1.5 py-0.5 rounded-full border font-semibold ${badge.bg}`}>{c.profitPct.toFixed(1)}%</span>
                              </>
                            )}
                            <button
                              onClick={() => removeVariationInReview(opt.id)}
                              className="text-gray-300 hover:text-red-500 transition"
                              title="Remover variação"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-400">
                          <span>{opt.weight || c.weight.toFixed(2)} kg</span>
                          <span>{opt.length || c.length.toFixed(1)}×{opt.width || c.width.toFixed(1)}×{opt.height || c.height.toFixed(1)} cm</span>
                          {opt.stock && <span>Estoque: {opt.stock}</span>}
                          {hasPricing && <span className={c.marginContribution >= 0 ? "text-green-600" : "text-red-500"}>Margem: R${c.marginContribution.toFixed(2)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Metadados do anúncio (categoria, marca futura) ──────────── */}
              {(() => {
                // CREATE when: product has no item_id OR user picked "Criar novo".
                const isCreateFlow =
                  !publishModeData?.itemId || overrideMode === "create";
                const categoryDisabledReason = !isCreateFlow
                  ? "Para mudar a categoria, recrie o produto na Shopee (a API bloqueia mudança de categoria em update)."
                  : undefined;
                return (
                  <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
                    <p className="text-sm font-semibold text-gray-700">🏷️ Metadados do anúncio</p>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Categoria Shopee</label>
                      <CategoryPicker
                        accountId={accountId}
                        value={selectedCategoryId}
                        valueBreadcrumb={selectedCategoryBreadcrumb}
                        disabled={!isCreateFlow}
                        disabledReason={categoryDisabledReason}
                        onChange={(id, crumb) => {
                          setSelectedCategoryId(id);
                          setSelectedCategoryBreadcrumb(crumb);
                        }}
                      />
                    </div>
                    {/* Marca foi removida daqui — vira atributo de categoria
                        na Etapa 3 (Especificações), seguindo a UX da Shopee. */}
                  </div>
                );
              })()}

              {/* Ficha Técnica dinâmica */}
              {categoryId && (
                <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-700">📋 Ficha Técnica</span>
                    {selectedCategoryBreadcrumb && (
                      <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full truncate max-w-[60%]">{selectedCategoryBreadcrumb}</span>
                    )}
                    {attrLoading && <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin ml-auto" />}
                    {attrError && <span className="text-xs text-red-500 ml-auto">Erro ao carregar atributos</span>}
                  </div>

                  {!attrLoading && !attrError && categoryAttributes && categoryAttributes.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {(categoryAttributes as Array<{
                        attribute_id: number;
                        display_attribute_name: string;
                        is_mandatory: boolean;
                        input_type: string;
                        attribute_value_list: Array<{ value_id: number; display_value_name: string }>;
                      }>).map(attr => {
                        const current = attributeValues[attr.attribute_id];
                        const isEmpty = !current || current.originalValue.trim() === "";
                        const isMandatory = attr.is_mandatory;
                        const borderClass = isMandatory && isEmpty ? "border-red-400" : "border-gray-200";
                        const values: Array<{ value_id: number; display_value_name: string; original_value_name?: string }> =
                          (attr.attribute_value_list as any) ?? (attr as any).options_list ?? [];

                        return (
                          <div key={attr.attribute_id} className="space-y-1">
                            <label className="text-xs font-medium text-gray-600">
                              {attr.display_attribute_name}
                              {isMandatory && <span className="text-red-500 ml-0.5">*</span>}
                            </label>

                            {attr.input_type === "BRAND" ? (
                              <input
                                type="text"
                                readOnly
                                value={values[0]?.display_value_name ?? values[0]?.original_value_name ?? ""}
                                className={`w-full text-xs rounded-lg border ${borderClass} bg-gray-50 px-2 py-1.5 text-gray-600`}
                              />
                            ) : attr.input_type === "DROP_DOWN" ? (
                              <select
                                value={current?.valueId ?? ""}
                                onChange={e => {
                                  const opt = values.find(o => o.value_id === Number(e.target.value));
                                  if (opt) {
                                    setAttributeValues(prev => ({
                                      ...prev,
                                      [attr.attribute_id]: { valueId: opt.value_id, originalValue: opt.display_value_name },
                                    }));
                                  } else {
                                    setAttributeValues(prev => {
                                      const next = { ...prev };
                                      delete next[attr.attribute_id];
                                      return next;
                                    });
                                  }
                                }}
                                className={`w-full text-xs rounded-lg border ${borderClass} bg-white px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                              >
                                <option value="">Selecionar…</option>
                                {values.map(opt => (
                                  <option key={opt.value_id} value={opt.value_id}>{opt.display_value_name}</option>
                                ))}
                              </select>
                            ) : attr.input_type === "INT_TYPE" ? (
                              <input
                                type="number"
                                step={1}
                                value={current?.originalValue ?? ""}
                                onChange={e => setAttributeValues(prev => ({
                                  ...prev,
                                  [attr.attribute_id]: { valueId: 0, originalValue: e.target.value },
                                }))}
                                placeholder="0"
                                className={`w-full text-xs rounded-lg border ${borderClass} bg-white px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                              />
                            ) : attr.input_type === "FLOAT_TYPE" ? (
                              <input
                                type="number"
                                step={0.01}
                                value={current?.originalValue ?? ""}
                                onChange={e => setAttributeValues(prev => ({
                                  ...prev,
                                  [attr.attribute_id]: { valueId: 0, originalValue: e.target.value },
                                }))}
                                placeholder="0.00"
                                className={`w-full text-xs rounded-lg border ${borderClass} bg-white px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                              />
                            ) : (
                              /* TEXT_FIELD, COMBO_BOX, and anything else */
                              <input
                                type="text"
                                value={current?.originalValue ?? ""}
                                onChange={e => setAttributeValues(prev => ({
                                  ...prev,
                                  [attr.attribute_id]: { valueId: 0, originalValue: e.target.value },
                                }))}
                                placeholder="Digitar…"
                                className={`w-full text-xs rounded-lg border ${borderClass} bg-white px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!attrLoading && !attrError && (!categoryAttributes || categoryAttributes.length === 0) && (
                    <p className="text-xs text-gray-400">Nenhum atributo disponível para esta categoria.</p>
                  )}
                </div>
              )}

              {/* Botões de geração IA */}
              {!adContent && adLoadingSection === null && (() => {
                // "Variações preenchidas" = all local options have a label
                // AND at least one option exists. This gates the main button.
                const variationsReady =
                  optionDetails.length >= 1 &&
                  optionDetails.every((o) => o.label.trim().length > 0);
                return (
                <div className="space-y-2">
                  {/* Botão principal — gera título + descrição + nomes das variações em 1 chamada */}
                  <button
                    onClick={handleGenerateAll}
                    disabled={!variationsReady}
                    title={variationsReady ? "" : "Preencha as variações primeiro"}
                    className="w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-bold text-base transition shadow-lg shadow-orange-200 disabled:shadow-none">
                    <Sparkles className="w-5 h-5" /> ✨ Gerar tudo com IA
                  </button>
                  {/* Botões individuais — caso o usuário queira regerar só 1 seção */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: "title" as const, label: "✨ Gerar Título" },
                      { key: "desc"  as const, label: "✨ Gerar Descrição" },
                      { key: "tags"  as const, label: "✨ Gerar Tags" },
                    ].map(b => (
                      <button key={b.key} onClick={() => generateAdSection(b.key)}
                        className="flex items-center justify-center gap-1 py-2 rounded-xl border border-orange-300 text-orange-600 bg-orange-50 hover:bg-orange-100 text-xs font-semibold transition">
                        {b.label}
                      </button>
                    ))}
                  </div>
                  {/* Publicar sem IA */}
                  <button
                    onClick={() => handlePublishToShopee()}
                    disabled={publishStatus === "loading" || optionDetails.length === 0 || variationCheckLoading || hasExistingVariation}
                    title={hasExistingVariation ? "Produto já tem variação na Shopee — edição não disponível ainda." : ""}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-green-400 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition">
                    {publishStatus === "loading" || variationCheckLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {publishStatus === "loading"
                      ? "Publicando..."
                      : variationCheckLoading
                      ? "Verificando..."
                      : hasExistingVariation
                      ? "Bloqueado (já tem variação)"
                      : "Publicar sem conteúdo IA"}
                  </button>
                  {publishStatus === "success" && publishResult && (
                    <div className="bg-green-50 border border-green-300 rounded-xl p-3 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-green-800">
                        <p className="font-semibold">Produto {publishResult.mode === "promote" ? "promovido" : publishResult.mode === "update" ? "atualizado" : "publicado"} com sucesso!</p>
                        <a href={publishResult.itemUrl} target="_blank" rel="noopener noreferrer"
                          className="text-green-700 underline hover:text-green-900 flex items-center gap-1 mt-1">
                          Ver produto na Shopee <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  )}
                  {publishStatus === "error" && (
                    <div className="bg-red-50 border border-red-300 rounded-xl p-3 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-red-800">
                        <p className="font-semibold">Erro ao publicar</p>
                        <p className="mt-0.5 text-red-700">{publishError}</p>
                        <button onClick={() => setPublishStatus("idle")} className="text-xs text-red-600 underline mt-1">Tentar novamente</button>
                      </div>
                    </div>
                  )}
                </div>
                );
              })()}

              {/* Loading */}
              {adLoadingSection === "all" && (
                <div className="flex flex-col items-center justify-center py-12 gap-4 bg-orange-50 border border-orange-100 rounded-xl">
                  <Loader2 className="w-10 h-10 text-orange-500 animate-spin" />
                  <p className="text-sm font-semibold text-orange-700">✨ A IA está criando seu anúncio profissional...</p>
                  <p className="text-xs text-gray-400">Analisando produto e variações, aguarde alguns segundos</p>
                </div>
              )}
              {adLoadingSection !== null && adLoadingSection !== "all" && (
                <div className="flex items-center justify-center gap-2 py-3 bg-orange-50 border border-orange-100 rounded-xl text-sm text-orange-700 font-medium">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Gerando {adLoadingSection === "title" ? "título" : adLoadingSection === "desc" ? "descrição" : "tags"}...
                </div>
              )}

              {/* Erro */}
              {generateAdMutation.isError && adLoadingSection === null && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Erro ao gerar conteúdo. Tente novamente.
                </div>
              )}

              {/* Conteúdo gerado */}
              {adContent && adLoadingSection !== "all" && (
                <div className="space-y-3">

                  {/* Abas */}
                  <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-semibold">
                    {([
                      { key: "titulo"    as const, label: "📝 Título"     },
                      { key: "descricao" as const, label: "📄 Descrição"  },
                      { key: "tags"      as const, label: "🏷️ Tags"       },
                      { key: "keywords"  as const, label: "🔑 Keywords"   },
                      { key: "score"     as const, label: "📊 Score"      },
                    ]).map(t => (
                      <button key={t.key} onClick={() => setAdTab(t.key)}
                        className={`flex-1 py-2.5 transition-all ${adTab === t.key ? "bg-orange-500 text-white" : "bg-white text-gray-500 hover:bg-orange-50"}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* ── ABA TÍTULO ── */}
                  {adTab === "titulo" && (
                    <div className="space-y-3">
                      {[adContent.titulo_principal, ...(adContent.titulos_alternativos ?? [])].map((t: string, i: number) => {
                        const len = t?.length ?? 0;
                        const lenColor = len >= 80 && len <= 100 ? "text-green-600" : len < 80 ? "text-yellow-600" : "text-red-600";
                        const isSelected = selectedTitle === t;
                        return (
                          <div key={i} className={`border rounded-xl p-3 transition-all ${isSelected ? "border-orange-400 bg-orange-50" : "border-gray-200 bg-white"}`}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${i === 0 ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600"}`}>
                                {i === 0 ? "Principal" : `Alt. ${i}`}
                              </span>
                              <span className={`text-xs font-bold ${lenColor}`}>{len} chars {len >= 80 && len <= 100 ? "✓" : len < 80 ? "⚠ curto" : "⚠ longo"}</span>
                            </div>
                            <p className="text-sm text-gray-800 font-medium leading-snug mb-3">{t}</p>
                            <div className="flex gap-2">
                              <button onClick={() => navigator.clipboard?.writeText(t)}
                                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1 bg-white transition">
                                📋 Copiar
                              </button>
                              <button onClick={() => setSelectedTitle(t)}
                                className={`flex items-center gap-1 text-xs font-semibold rounded-lg px-2 py-1 transition border ${isSelected ? "bg-orange-500 text-white border-orange-500" : "border-orange-300 text-orange-600 hover:bg-orange-50"}`}>
                                {isSelected ? "✅ Selecionado" : "Selecionar"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── ABA DESCRIÇÃO ── */}
                  {adTab === "descricao" && (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <p className="text-xs text-gray-500">{(editedDesc || adContent.descricao)?.length ?? 0} caracteres</p>
                        <div className="flex gap-2">
                          <button onClick={() => navigator.clipboard?.writeText(editedDesc || adContent.descricao)}
                            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1 bg-white transition">
                            📋 Copiar descrição
                          </button>
                          <button onClick={() => { setEditingDesc(v => !v); if (!editingDesc) setEditedDesc(adContent.descricao); }}
                            className="text-xs text-orange-600 hover:text-orange-700 border border-orange-200 rounded-lg px-2 py-1 bg-white transition">
                            {editingDesc ? "👁 Preview" : "✏️ Editar"}
                          </button>
                        </div>
                      </div>
                      {editingDesc ? (
                        <textarea
                          value={editedDesc}
                          onChange={e => setEditedDesc(e.target.value)}
                          rows={14}
                          className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none font-mono"
                        />
                      ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                          {editedDesc || adContent.descricao}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── ABA TAGS ── */}
                  {adTab === "tags" && (
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Hashtags ({adContent.hashtags?.length ?? 0})</p>
                          <button onClick={() => navigator.clipboard?.writeText((adContent.hashtags ?? []).join(" "))}
                            className="text-xs text-orange-600 hover:text-orange-700 border border-orange-200 rounded-lg px-2 py-1 bg-white transition">
                            📋 Copiar hashtags
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(adContent.hashtags ?? []).map((h: string) => (
                            <span key={h} className="px-2.5 py-1 bg-orange-500 text-white text-xs rounded-full font-medium">{h}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tags SEO ({adContent.tags_seo?.length ?? 0})</p>
                          <button onClick={() => navigator.clipboard?.writeText((adContent.tags_seo ?? []).join(", "))}
                            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2 py-1 bg-white transition">
                            📋 Copiar tags SEO
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(adContent.tags_seo ?? []).map((t: string) => (
                            <span key={t} className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs rounded-full border border-gray-200">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── ABA KEYWORDS ── */}
                  {adTab === "keywords" && (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500">Use estas palavras no título, descrição e tags para maximizar o ranking de busca.</p>
                      {(adContent.keywords_principais ?? []).map((kw: string, i: number) => (
                        <div key={kw} className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-100 rounded-xl">
                          <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-800">{kw}</p>
                            <p className="text-xs text-gray-400">Use no título e nas primeiras linhas da descrição</p>
                          </div>
                          <button onClick={() => navigator.clipboard?.writeText(kw)}
                            className="text-xs text-gray-400 hover:text-gray-600 transition">📋</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── ABA SCORE ── */}
                  {adTab === "score" && (() => {
                    const s = adContent.score ?? {};
                    const total: number = s.total ?? 0;
                    const nivel: string = s.nivel ?? "C";
                    const nivelColor = { A: "bg-green-500", B: "bg-blue-500", C: "bg-yellow-500", D: "bg-orange-500", F: "bg-red-500" }[nivel] ?? "bg-gray-400";
                    const barColor = total >= 80 ? "bg-green-500" : total >= 60 ? "bg-yellow-500" : "bg-red-500";
                    const cats = [
                      { label: "Título",    val: s.titulo    ?? 0, max: 25 },
                      { label: "Descrição", val: s.descricao ?? 0, max: 25 },
                      { label: "Tags",      val: s.tags      ?? 0, max: 10 },
                      { label: "Variações", val: s.variacoes ?? 0, max: 20 },
                    ];
                    return (
                      <div className="space-y-4">
                        <div className="flex items-center gap-4 p-4 bg-gray-50 border border-gray-200 rounded-xl">
                          <span className={`w-16 h-16 rounded-xl ${nivelColor} text-white text-3xl font-black flex items-center justify-center flex-shrink-0`}>{nivel}</span>
                          <div className="flex-1">
                            <div className="flex items-end justify-between mb-1">
                              <p className="text-sm font-semibold text-gray-700">Score total</p>
                              <p className="text-2xl font-black text-gray-800">{total}<span className="text-sm text-gray-400">/100</span></p>
                            </div>
                            <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                              <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(total, 100)}%` }} />
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {cats.map(c => (
                            <div key={c.label} className="bg-white border border-gray-200 rounded-xl p-3">
                              <div className="flex justify-between mb-1 text-xs">
                                <span className="text-gray-600 font-medium">{c.label}</span>
                                <span className="font-bold text-gray-800">{c.val}/{c.max}</span>
                              </div>
                              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${c.val / c.max >= 0.8 ? "bg-green-500" : c.val / c.max >= 0.6 ? "bg-yellow-500" : "bg-red-400"}`}
                                  style={{ width: `${(c.val / c.max) * 100}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        {(s.sugestoes ?? []).length > 0 && (
                          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Sugestões de melhoria</p>
                            {(s.sugestoes ?? []).map((sg: string, i: number) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-blue-700">
                                <span className="font-bold flex-shrink-0">{i + 1}.</span>
                                <span>{sg}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Botões globais */}
                  <div className="space-y-2 pt-1">
                    {/* Regenerar por seção */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        { key: "title" as const, label: "✨ Título" },
                        { key: "desc"  as const, label: "✨ Descrição" },
                        { key: "tags"  as const, label: "✨ Tags" },
                      ]).map(b => (
                        <button key={b.key}
                          onClick={() => generateAdSection(b.key)}
                          disabled={adLoadingSection !== null}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-lg border border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100 text-xs font-semibold disabled:opacity-50 transition">
                          {adLoadingSection === b.key ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          {b.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => generateAdSection("all")}
                        disabled={adLoadingSection !== null}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-orange-300 text-orange-600 text-sm font-semibold hover:bg-orange-50 disabled:opacity-50 transition">
                        {adLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        🔄 Regenerar tudo
                      </button>
                      <button
                        onClick={() => handlePublishToShopee()}
                        disabled={publishStatus === "loading" || optionDetails.length === 0 || variationCheckLoading || hasExistingVariation}
                        title={hasExistingVariation ? "Produto já tem variação na Shopee — edição não disponível ainda." : ""}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition">
                        {publishStatus === "loading" || variationCheckLoading
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <CheckCircle2 className="w-4 h-4" />}
                        {publishStatus === "loading"
                          ? "Publicando..."
                          : variationCheckLoading
                          ? "Verificando..."
                          : hasExistingVariation
                          ? "Bloqueado (já tem variação)"
                          : "Confirmar e Publicar"}
                      </button>
                    </div>
                  </div>
                  {publishStatus === "success" && publishResult && (
                    <div className="bg-green-50 border border-green-300 rounded-xl p-3 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-green-800">
                        <p className="font-semibold">Produto {publishResult.mode === "promote" ? "promovido" : publishResult.mode === "update" ? "atualizado" : "publicado"} com sucesso!</p>
                        <a href={publishResult.itemUrl} target="_blank" rel="noopener noreferrer"
                          className="text-green-700 underline hover:text-green-900 flex items-center gap-1 mt-1">
                          Ver produto na Shopee <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  )}
                  {publishStatus === "error" && (
                    <div className="bg-red-50 border border-red-300 rounded-xl p-3 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-red-800">
                        <p className="font-semibold">Erro ao publicar</p>
                        <p className="mt-0.5 text-red-700">{publishError}</p>
                        <button onClick={() => setPublishStatus("idle")} className="text-xs text-red-600 underline mt-1">Tentar novamente</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer de navegação */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
          {step !== "A" ? (
            <button onClick={stepBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
          ) : <div />}

          {step === "A" && (
            <button onClick={goAtoB} disabled={!selectedType}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition">
              Próximo <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === "B" && (
            <button onClick={goBtoC} disabled={optionLabels.every(l => l.trim() === "")}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition">
              Próximo <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === "C" && (
            <div className="flex items-center gap-3 flex-wrap">
              {hasNegativeMargin && (
                <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Corrija margens negativas
                </span>
              )}
              {!hasNegativeMargin && (() => {
                const mandatoryEmpty = categoryAttributes
                  ? (categoryAttributes as any[]).filter((a: any) =>
                      a.is_mandatory && (!attributeValues[a.attribute_id] || !attributeValues[a.attribute_id].originalValue.trim())
                    ).length
                  : 0;
                return mandatoryEmpty > 0 ? (
                  <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> {mandatoryEmpty} atributo{mandatoryEmpty > 1 ? "s" : ""} obrigatório{mandatoryEmpty > 1 ? "s" : ""} vazio{mandatoryEmpty > 1 ? "s" : ""}
                  </span>
                ) : null;
              })()}
              {!hasNegativeMargin && hasPricing && optionDetails.length >= 2 && (
                <button onClick={applyFourTimesRule}
                  className="flex items-center gap-1 text-xs text-amber-700 border border-amber-300 rounded-lg px-3 py-2 bg-amber-50 hover:bg-amber-100 transition">
                  <AlertTriangle className="w-3 h-3" /> Verificar 4×
                </button>
              )}
              <button onClick={() => { applyFourTimesRule(); setStep("D"); }} disabled={hasNegativeMargin}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition">
                Revisar <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
          {step === "D" && (
            <button onClick={handleSave}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl transition">
              <Check className="w-4 h-4" /> Salvar variação
            </button>
          )}
        </div>
      </div>

      {/* ── Undo toast após "Gerar tudo com IA" ──────────────────────── */}
      {undoToastVisible && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 max-w-md animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
          <span className="text-sm flex-1">Conteúdo regerado com base nas variações</span>
          <button
            onClick={handleUndoGenerate}
            className="text-xs font-semibold text-orange-400 hover:text-orange-300 uppercase tracking-wide px-2 py-1 rounded transition"
          >
            Desfazer
          </button>
          <button
            onClick={() => { setUndoToastVisible(false); setUndoSnapshot(null); }}
            className="text-gray-400 hover:text-white transition"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Modal de decisão: criar novo vs. promover existente ─────────── */}
      {showDecisionModal && !showNameEditor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Como publicar este produto?</h3>
              <button onClick={() => setShowDecisionModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              O produto na Shopee é <b>simples</b> (sem variações) e localmente você montou <b>{optionDetails.length} variações</b>.
              Escolha uma ação:
            </p>

            <button
              onClick={() => {
                setNewItemName(suggestNewName(product.itemName || ""));
                setShowNameEditor(true);
              }}
              className="w-full text-left border-2 border-blue-200 hover:border-blue-400 bg-blue-50 hover:bg-blue-100 rounded-xl p-4 transition"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0 text-lg">🆕</div>
                <div className="flex-1">
                  <p className="font-semibold text-blue-900 text-sm">Criar novo produto na Shopee</p>
                  <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                    Mantém o produto antigo intocado. Cria um novo anúncio com as variações.
                    Recomendado se você quer migrar pra um novo listing sem perder o antigo.
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => pickDecision("promote")}
              className="w-full text-left border-2 border-amber-300 hover:border-amber-500 bg-amber-50 hover:bg-amber-100 rounded-xl p-4 transition"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center flex-shrink-0 text-lg">⚠️</div>
                <div className="flex-1">
                  <p className="font-semibold text-amber-900 text-sm">
                    Adicionar variações ao produto existente <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded ml-1">IRREVERSÍVEL</span>
                  </p>
                  <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                    O produto simples vai passar a ter {optionDetails.length} variações. Histórico de vendas e avaliações são preservados,
                    mas <b>não dá pra voltar pra produto simples</b>.
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setShowDecisionModal(false)}
              className="w-full py-2.5 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Editor de nome (sub-view, opção "Criar novo") ───────────────── */}
      {showDecisionModal && showNameEditor && (() => {
        const nameLen = newItemName.length;
        const nameValid = nameLen >= 1 && nameLen <= 120;
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-gray-900">Nome do novo produto na Shopee</h3>
                <button onClick={() => { setShowDecisionModal(false); setShowNameEditor(false); }} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-1.5">
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value.slice(0, 120))}
                  maxLength={120}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 focus:border-blue-400 rounded-xl text-sm outline-none transition"
                  placeholder="Nome do produto na Shopee"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Edite se quiser. O nome deve ser diferente do anúncio atual para evitar duplicata.
                  </p>
                  <span className={`text-xs font-mono flex-shrink-0 ${nameLen > 110 ? "text-amber-600" : nameLen < 1 ? "text-red-500" : "text-gray-400"}`}>
                    {nameLen}/120
                  </span>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowNameEditor(false)}
                  className="flex-1 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition"
                >
                  Voltar
                </button>
                <button
                  onClick={() => pickDecision("create", newItemName)}
                  disabled={!nameValid}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition"
                >
                  🆕 Confirmar Criação
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
