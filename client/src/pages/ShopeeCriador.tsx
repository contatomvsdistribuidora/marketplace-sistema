import { useState, useEffect } from "react";
import { trpc } from "../lib/trpc";
import {
  Search, Package, ChevronRight, Star, Loader2,
  Plus, Trash2, Sparkles, Hash, Ruler, Layers,
  Palette, PenLine, ArrowLeft, ArrowRight, Check,
  CheckCircle2, X, PlusCircle, AlertTriangle, TrendingUp,
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

type PricingMode = "multiplier" | "margin" | "profit";

interface PricingGlobals {
  unitCost: string;
  baseProductQty: string;   // quantas unidades o produto base representa
  packagingCost: string;
  shippingCost: string;
  transactionFee: string;
  // mode 1
  marginMultiplier: string;
  defaultDiscount: string;
  // mode 2
  desiredMargin: string;
  // mode 3
  minProfit: string;
}

interface ComputedPricing {
  qty: number;
  price: number;
  totalProductCost: number;
  platformCost: number;
  commissionRate: number;
  marginContribution: number;
  profitPct: number;
  weight: number;
  length: number;
  width: number;
  height: number;
  factor: number;
}

function extractQty(label: string): number {
  const m = label.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 1;
}

// Shopee Brazil 2026 commission tiers
function shopeeCommissionRate(price: number): number {
  if (price <  50) return 0.18;
  if (price < 100) return 0.16;
  if (price < 500) return 0.14;
  return 0.12;
}

function shopeeCommissionLabel(price: number): string {
  if (price <  50) return "18% (até R$49)";
  if (price < 100) return "16% (R$50–99)";
  if (price < 500) return "14% (R$100–499)";
  return "12% (acima R$500)";
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
    const commission = shopeeCommissionRate(price);
    const denom = 1 - commission - tx - margin;
    if (denom <= 0) return 0;
    const next = (totalCost + packaging + shipping) / denom;
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
    const commission = shopeeCommissionRate(price);
    const denom = 1 - commission - tx;
    if (denom <= 0) return 0;
    const next = (totalCost + packaging + shipping + minProfit) / denom;
    if (Math.abs(next - price) < 0.001) return Math.max(next, 0);
    price = next;
    if (!isFinite(price)) return 0;
  }
  return Math.max(price, 0);
}

function VariationWizard({
  product,
  onSave,
  onClose,
}: {
  product: any;
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

  const [pricing, setPricing] = useState<PricingGlobals>({
    unitCost: "",
    baseProductQty: "1",
    packagingCost: "",
    shippingCost: "",
    transactionFee: "2",
    marginMultiplier: "2.5",
    defaultDiscount: "1",
    desiredMargin: "30",
    minProfit: "20",
  });

  const optimizeMutation = trpc.shopee.optimizeTitle.useMutation();

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
    const unitCost       = parseFloat(pricing.unitCost)       || 0;
    const packaging      = parseFloat(pricing.packagingCost)  || 0;
    const shipping       = parseFloat(pricing.shippingCost)   || 0;
    const txFee          = parseFloat(pricing.transactionFee) || 0;
    const discountPct    = parseFloat(qtyFactors[idx] ?? (idx === 0 ? "0" : pricing.defaultDiscount)) || 0;
    const factor         = pricingMode === "multiplier" ? Math.max(1 - (discountPct / 100) * idx, 0.01) : 1;
    const totalProductCost = unitCost * qty;

    // Effective per-variation param (override or global)
    const useOverride = perVarEnabled[idx] ?? false;
    const paramOverride = useOverride ? (perVarParam[idx] ?? "") : "";

    let price = 0;
    if (pricingMode === "multiplier") {
      const multiplier = parseFloat(paramOverride || pricing.marginMultiplier) || 1;
      price = totalProductCost * multiplier * factor;
    } else if (pricingMode === "margin") {
      const desiredMarginPct = parseFloat(paramOverride || pricing.desiredMargin) || 0;
      price = solvePriceByMargin(totalProductCost, packaging, shipping, txFee, desiredMarginPct);
    } else {
      const minProfit = parseFloat(paramOverride || pricing.minProfit) || 0;
      price = solvePriceByMinProfit(totalProductCost, packaging, shipping, txFee, minProfit);
    }

    // Aplica teto de 4× Shopee se definido
    if (priceOverrides[idx] != null) {
      price = priceOverrides[idx]!;
    }

    const commissionRate  = shopeeCommissionRate(price);
    const platformCost    = price * (commissionRate + txFee / 100) + packaging + shipping;
    const marginContribution = price - totalProductCost - platformCost;
    const profitPct       = price > 0 ? (marginContribution / price) * 100 : 0;

    // Dimensions
    const baseL         = parseFloat(product.dimensionLength) || 0;
    const baseW         = parseFloat(product.dimensionWidth)  || 0;
    const baseH         = parseFloat(product.dimensionHeight) || 0;
    const baseWeight    = parseFloat(product.weight)          || 0;
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

    return { qty, price, totalProductCost, platformCost, commissionRate, marginContribution, profitPct, weight, length, width, height, factor };
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
    if (optionDetails.length < 2 || !pricing.unitCost) return;
    const rawPrices = optionDetails.map((opt, idx) => {
      const isQty = selectedType === "quantidade";
      const qty   = isQty ? extractQty(opt.label) : 1;
      const uc    = parseFloat(pricing.unitCost)       || 0;
      const pkg   = parseFloat(pricing.packagingCost)  || 0;
      const ship  = parseFloat(pricing.shippingCost)   || 0;
      const tx    = parseFloat(pricing.transactionFee) || 0;
      const disc  = parseFloat(qtyFactors[idx] ?? String(idx === 0 ? 0 : idx)) || 0;
      const factor = pricingMode === "multiplier" ? Math.max(1 - (disc / 100) * idx, 0.01) : 1;
      const totalCost = uc * qty;
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
    const opts = transformed.map(label => emptyOption(label));
    setOptionDetails(opts);
    setQtyFactors(opts.map((_, i) => i === 0 ? "0" : pricing.defaultDiscount));
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
      const baseWeight = parseFloat(product.weight) || 0.5;
      const baseL = parseFloat(product.dimensionLength) || 20;
      const baseW = parseFloat(product.dimensionWidth)  || 15;
      const baseH = parseFloat(product.dimensionHeight) || 10;
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

  // ── Etapa D ──
  function handleSave() {
    const opts = optionDetails.map((o, i) => {
      const c = computePricing(o, i);
      return {
        ...o,
        weight: o.weight || c.weight.toFixed(2),
        length: o.length || c.length.toFixed(1),
        width:  o.width  || c.width.toFixed(1),
        height: o.height || c.height.toFixed(1),
        price:  o.price  || (c.price > 0 ? c.price.toFixed(2) : ""),
      };
    });
    onSave({ id: uid(), type: selectedType!, typeName, options: opts });
  }

  function stepBack() {
    const prev = ({ B: "A", C: "B", D: "C" } as Record<string, WizardStep>)[step];
    if (prev) setStep(prev);
  }

  const rangeAlert   = step === "C" ? priceRangeAlert() : null;
  const hasPricing   = parseFloat(pricing.unitCost) > 0;

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
                  <div className="flex items-end gap-4">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1 font-medium">Qtd. do produto base (un.)</label>
                      <input
                        type="number" min="0.001" step="1" placeholder="1"
                        value={pricing.baseProductQty}
                        onChange={e => setPricing(p => ({ ...p, baseProductQty: e.target.value }))}
                        className="w-32 px-3 py-2 border border-blue-300 bg-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 font-semibold"
                      />
                    </div>
                    <div className="text-xs text-blue-600 pb-2 space-y-0.5">
                      {product.weight       && <p>Peso base: <b>{product.weight} kg</b></p>}
                      {product.dimensionLength && <p>Dims base: <b>{product.dimensionLength}×{product.dimensionWidth}×{product.dimensionHeight} cm</b></p>}
                    </div>
                  </div>
                  {(() => {
                    const bq = Math.max(parseFloat(pricing.baseProductQty) || 1, 0.001);
                    const bw = parseFloat(product.weight) || 0;
                    const bl = parseFloat(product.dimensionLength) || 0;
                    const bwi = parseFloat(product.dimensionWidth) || 0;
                    const bh = parseFloat(product.dimensionHeight) || 0;
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
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Parâmetros globais</p>
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

                {/* Tabela de comissões (informativo) */}
                <div className="mt-3 border-t border-gray-200 pt-3">
                  <p className="text-xs text-gray-400 font-semibold mb-1">Tabela Shopee 2026 (auto aplicada):</p>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    <span className="bg-white border border-gray-200 rounded px-2 py-0.5">até R$49 → 18%</span>
                    <span className="bg-white border border-gray-200 rounded px-2 py-0.5">R$50–99 → 16%</span>
                    <span className="bg-white border border-gray-200 rounded px-2 py-0.5">R$100–499 → 14%</span>
                    <span className="bg-white border border-gray-200 rounded px-2 py-0.5">R$500+ → 12%</span>
                  </div>
                </div>
              </div>

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
                            updateOptionLabel(opt.id, e.target.value);
                            if (idx > 0) {
                              setManuallyEdited(s => new Set(s).add(opt.id));
                              setAutoGenerated(s => { const n = new Set(s); n.delete(opt.id); return n; });
                            }
                          }}
                          className="flex-1 min-w-0 text-sm font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-orange-400 focus:outline-none px-0.5 py-0.5 truncate"
                        />
                        {idx > 0 && autoGenerated.has(opt.id) && (
                          <span className="flex-shrink-0 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">⚡ Auto</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {hasPricing && (
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${badge.bg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                            {c.profitPct.toFixed(1)}% lucro
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
                          { field: "weight" as const, label: "Peso (kg)",        ph: c.weight > 0 ? c.weight.toFixed(2) : "0.50", sv: "0.01" },
                          { field: "length" as const, label: "Comprimento (cm)", ph: c.length > 0 ? c.length.toFixed(1) : "20",   sv: "0.1"  },
                          { field: "width"  as const, label: "Largura (cm)",     ph: c.width  > 0 ? c.width.toFixed(1)  : "15",   sv: "0.1"  },
                          { field: "height" as const, label: "Altura (cm)",      ph: c.height > 0 ? c.height.toFixed(1) : "10",   sv: "0.1"  },
                          { field: "stock"  as const, label: "Estoque",          ph: "0",                                          sv: "1"    },
                        ]).map(({ field, label, ph, sv }) => (
                          <div key={field}>
                            <label className="block text-xs text-gray-500 mb-1">{label}</label>
                            <input type="number" min="0" step={sv} placeholder={ph} value={(opt as any)[field]}
                              onChange={e => {
                                updateDetail(opt.id, field, e.target.value);
                                if (idx > 0) {
                                  setManuallyEdited(s => new Set(s).add(opt.id));
                                  setAutoGenerated(s => { const n = new Set(s); n.delete(opt.id); return n; });
                                }
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                          </div>
                        ))}
                        {pricingMode === "multiplier" && (
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Desconto faixa (%)</label>
                            <input type="number" min="0" max="100" step="0.1"
                              value={qtyFactors[idx] ?? (idx === 0 ? "0" : pricing.defaultDiscount)}
                              onChange={e => setQtyFactors(f => { const n = [...f]; n[idx] = e.target.value; return n; })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
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
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span>Qtd: <b className="text-gray-700">{c.qty}×</b></span>
                            <span>Comissão Shopee: <b className="text-gray-700">{shopeeCommissionLabel(c.price)}</b></span>
                            <span>Custo produto: <b className="text-gray-700">R$ {c.totalProductCost.toFixed(2)}</b></span>
                            <span>Custo plataforma: <b className="text-gray-700">R$ {c.platformCost.toFixed(2)}</b></span>
                            <span>Margem: <b className={c.marginContribution >= 0 ? "text-green-700" : "text-red-600"}>
                              R$ {c.marginContribution.toFixed(2)}
                            </b></span>
                            <span>Lucro: <b className={badge.bg.split(" ")[1]}>{c.profitPct.toFixed(1)}%</b></span>
                          </div>
                          {isNeg && (
                            <p className="text-xs text-red-600 font-semibold mt-2 flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" /> Margem negativa — ajuste o custo ou o parâmetro de precificação.
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

          {/* ── ETAPA D – Revisão ── */}
          {step === "D" && (
            <div>
              <p className="text-sm text-gray-600 mb-4">Revise antes de publicar:</p>
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                    {typeName} · {optionDetails.length} opção(ões)
                  </p>
                  <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded px-2 py-0.5">
                    Modo: {pricingMode === "multiplier" ? "Multiplicador" : pricingMode === "margin" ? "Margem %" : "Lucro R$"}
                  </span>
                </div>
                <div className="space-y-3">
                  {optionDetails.map((opt, idx) => {
                    const c = computePricing(opt, idx);
                    const badge = profitBadge(c.profitPct);
                    return (
                      <div key={opt.id} className="bg-white rounded-lg border border-orange-100 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold text-gray-800">
                            <span className="text-orange-500">{idx + 1}.</span> {opt.label}
                          </p>
                          {hasPricing && (
                            <div className="flex items-center gap-2">
                              <span className="text-base font-bold text-orange-600">R$ {c.price.toFixed(2)}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${badge.bg}`}>{c.profitPct.toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                          <span>Peso: <b className="text-gray-700">{opt.weight || c.weight.toFixed(2)} kg</b></span>
                          <span>Comp: <b className="text-gray-700">{opt.length || c.length.toFixed(1)} cm</b></span>
                          <span>Larg: <b className="text-gray-700">{opt.width  || c.width.toFixed(1)} cm</b></span>
                          <span>Alt: <b className="text-gray-700">{opt.height || c.height.toFixed(1)} cm</b></span>
                          {opt.stock && <span>Estoque: <b className="text-gray-700">{opt.stock}</b></span>}
                          {hasPricing && (
                            <span>Margem: <b className={c.marginContribution >= 0 ? "text-green-700" : "text-red-600"}>
                              R$ {c.marginContribution.toFixed(2)}
                            </b></span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <button onClick={() => alert("Publicação na Shopee em breve")}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition mb-3">
                <Sparkles className="w-4 h-4" /> Publicar na Shopee
              </button>
              <button onClick={() => setStep("C")}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 transition">
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
            <div className="flex items-center gap-3">
              {hasNegativeMargin && (
                <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Corrija margens negativas
                </span>
              )}
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
