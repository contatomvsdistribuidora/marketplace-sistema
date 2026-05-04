import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "../../lib/trpc";
import { CategoryPicker } from "../../components/shopee/CategoryPicker";
import { VariationsReadOnly } from "../../components/shopee/VariationsReadOnly";
import { BrandPicker, type BrandValue } from "../../components/shopee/BrandPicker";
import {
  shopeeCommission, shopeeCommissionLabel,
  solvePriceByMargin, solvePriceByMinProfit,
  extractQty,
} from "@/lib/shopee-pricing";
import { InfoBox } from "@/components/shopee/atoms/InfoBox";
import type {
  VariationType, WizardStep, VariationOption, VariationGroup,
  PricingMode, PricingGlobals, ComputedPricing,
} from "../shopee-criador/types";
import {
  uid, emptyOption, isValidEan, suggestNewName, truncateVariationName,
} from "../shopee-criador/helpers";
import {
  Loader2, Plus, Trash2, Sparkles, Hash, Ruler, Layers,
  Palette, PenLine, ArrowLeft, ArrowRight, Check,
  CheckCircle2, X, PlusCircle, AlertTriangle, TrendingUp,
  ExternalLink, Settings,
} from "lucide-react";

const VARIATION_TYPES: { type: VariationType; label: string; icon: React.ReactNode; examples: string }[] = [
  { type: "quantidade",    label: "Quantidade",    icon: <Hash className="w-5 h-5" />,    examples: "50un, 100un, 200un" },
  { type: "tamanho",       label: "Tamanho",       icon: <Ruler className="w-5 h-5" />,   examples: "P, M, G ou 10L, 50L" },
  { type: "material",      label: "Material",      icon: <Layers className="w-5 h-5" />,  examples: "Plástico, Metal, Tecido" },
  { type: "cor",           label: "Cor",           icon: <Palette className="w-5 h-5" />, examples: "Vermelho, Azul, Preto" },
  { type: "personalizado", label: "Personalizado", icon: <PenLine className="w-5 h-5" />, examples: "Campo livre" },
];

import type { ResolvedProduct } from "./types";

export function CombinedWizard({
  products,
  multiListingId,
  accountId,
  principalIndex = 0,
  wizardStateJson,
  onSave,
  onClose,
}: {
  products: ResolvedProduct[];
  multiListingId: number;
  accountId: number;
  principalIndex?: number;
  wizardStateJson?: string | null;
  onSave: (group: VariationGroup) => void;
  onClose: () => void;
}) {
  // ============================================================
  // Helpers do produto principal (modo combinado)
  // ============================================================
  const principalProduct = products[principalIndex] ?? products[0];
  const productIds = products.map(p => `${p.source}:${p.sourceId}`);

  const getBaseName = () => principalProduct?.name ?? "";
  const getBaseSku = () => principalProduct?.sku ?? "";
  const getBaseWeight = () => principalProduct?.weight ?? "";
  const getBaseLength = () => principalProduct?.dimensionLength ?? "";
  const getBaseWidth = () => principalProduct?.dimensionWidth ?? "";
  const getBaseHeight = () => principalProduct?.dimensionHeight ?? "";

  // No modo combinado, sempre cria novo produto
  const createNewMode = true;

  // ============================================================

  const [step, setStep]                   = useState<WizardStep>("A");
  const [selectedType, setSelectedType]   = useState<VariationType | null>(null);
  const [optionLabels, setOptionLabels]   = useState<string[]>([""]);
  // Matriz 2D: optionDetailsMatrix[productIdx][optionIdx] = VariationOption
  // N produtos (linhas) x M opcoes (colunas)
  const [optionDetailsMatrix, setOptionDetailsMatrix] = useState<VariationOption[][]>([]);

  // Helpers de acesso
  const getOptionDetails = (productIdx: number = 0): VariationOption[] => {
    return optionDetailsMatrix[productIdx] ?? [];
  };

  const getCell = (productIdx: number, optionIdx: number): VariationOption | null => {
    return optionDetailsMatrix[productIdx]?.[optionIdx] ?? null;
  };

  // Backwards compat: alias optionDetails pra primeira linha (usado em codigo legado)
  const optionDetails = optionDetailsMatrix[0] ?? [];
  const setOptionDetails = (updater: VariationOption[] | ((prev: VariationOption[]) => VariationOption[])) => {
    setOptionDetailsMatrix(prev => {
      const newRow = typeof updater === "function" ? updater(prev[0] ?? []) : updater;
      const next = [...prev];
      next[0] = newRow;
      // Replicar para outras linhas se existirem
      for (let i = 1; i < next.length; i++) {
        if (next[i].length !== newRow.length) {
          next[i] = newRow.map(o => ({ ...o, id: `${o.id}_p${i}` }));
        }
      }
      return next;
    });
  };

  // Per-row config: peso/dim/baseQty por produto
  const [perRowBaseQty, setPerRowBaseQty] = useState<string[]>([]);
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
  const [attributeValues, setAttributeValues]       = useState<Record<number, { valueId: number; originalValue: string; displayValue?: string; valueUnit?: string }>>({});
  // Brand fica fora de attributeValues: o atributo BRAND sintético (attribute_id=-1
  // injetado por ensureBrandAttribute no backend) só serve pra renderizar o
  // campo. O brand_id real vai num campo separado no payload de add_item da
  // Shopee, então mantemos um estado dedicado e filtramos o sintético do
  // attribute_list enviado.
  const [brandValue, setBrandValue]                 = useState<BrandValue>({ brandId: 0, brandName: "No Brand" });
  const [aiFillingAttrs, setAiFillingAttrs]         = useState(false);
  const [, setLocation]                             = useLocation();

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

  // Per-product pricing: pricingPerProduct[productIdx] tem os parametros desse produto
  const [pricingPerProduct, setPricingPerProduct] = useState<PricingGlobals[]>([]);

  // Override do nome do produto (max 20 chars - limite Shopee var1)
  const [productNameOverrides, setProductNameOverrides] = useState<Record<number, string>>({});

  // Celula selecionada na matriz para mostrar card de calculo detalhado
  const [selectedCell, setSelectedCell] = useState<{ productIdx: number; optIdx: number } | null>(null);

  // Sincronizar pricingPerProduct quando products muda
  useEffect(() => {
    setPricingPerProduct(prev => {
      if (prev.length === products.length) return prev;
      return products.map((_, idx) => prev[idx] ?? { ...pricing });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  // Propaga globalStock per-product → opt.stock vazio das celulas
  useEffect(() => {
    setOptionDetailsMatrix(matrix => {
      let changed = false;
      const next = matrix.map((row, productIdx) => {
        const gs = pricingPerProduct[productIdx]?.globalStock;
        if (!gs || gs === "") return row;
        return row.map(opt => {
          // Nao sobrescreve se ja foi editado manualmente para um valor != 0
          const cur = opt.stock ?? "";
          if (cur !== "" && cur !== "0") return opt;
          changed = true;
          return { ...opt, stock: gs };
        });
      });
      return changed ? next : matrix;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingPerProduct]);

  // ── Auto-save: serializa state inteiro do wizard em JSON ──
  const updateListingMutation = trpc.multiProduct.updateMultiProductListing.useMutation();

  function serializeWizardState(): string {
    return JSON.stringify({
      version: 1,
      step,
      selectedType,
      optionLabels,
      optionDetailsMatrix,
      perRowBaseQty,
      pricingMode,
      pricing,
      pricingPerProduct,
      attributeValues,
      qtyFactors,
      perVarParam,
      perVarEnabled,
      priceOverrides,
      categoryId: selectedCategoryId,
      categoryBreadcrumb: selectedCategoryBreadcrumb,
      brandValue,
      productNameOverrides,
    });
  }

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated) return;
    if (!wizardStateJson) { setHydrated(true); return; }
    try {
      const s = JSON.parse(wizardStateJson);
      if (s.version !== 1) { setHydrated(true); return; }
      if (s.step !== undefined) setStep(s.step);
      if (s.selectedType !== undefined) setSelectedType(s.selectedType);
      if (s.optionLabels !== undefined) setOptionLabels(s.optionLabels);
      if (s.optionDetailsMatrix !== undefined) setOptionDetailsMatrix(s.optionDetailsMatrix);
      if (s.perRowBaseQty !== undefined) setPerRowBaseQty(s.perRowBaseQty);
      if (s.pricingMode !== undefined) setPricingMode(s.pricingMode);
      if (s.pricing !== undefined) setPricing(s.pricing);
      if (s.pricingPerProduct !== undefined) setPricingPerProduct(s.pricingPerProduct);
      if (s.attributeValues !== undefined) setAttributeValues(s.attributeValues);
      if (s.qtyFactors !== undefined) setQtyFactors(s.qtyFactors);
      if (s.perVarParam !== undefined) setPerVarParam(s.perVarParam);
      if (s.perVarEnabled !== undefined) setPerVarEnabled(s.perVarEnabled);
      if (s.priceOverrides !== undefined) setPriceOverrides(s.priceOverrides);
      if (s.categoryId !== undefined) setSelectedCategoryId(s.categoryId);
      if (s.categoryBreadcrumb !== undefined) setSelectedCategoryBreadcrumb(s.categoryBreadcrumb);
      if (s.brandValue !== undefined) setBrandValue(s.brandValue);
      if (s.productNameOverrides !== undefined) setProductNameOverrides(s.productNameOverrides);
    } catch (e) {
      console.warn("Falha ao hidratar wizard state:", e);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStateJson]);

  function autoSaveWizardState() {
    if (!multiListingId) return;
    updateListingMutation
      .mutateAsync({ id: multiListingId, wizardStateJson: serializeWizardState() })
      .catch(err => console.warn("Auto-save falhou:", err));
  }

  const updateProductPricing = (productIdx: number, field: keyof PricingGlobals, value: string) => {
    setPricingPerProduct(prev => {
      const next = [...prev];
      while (next.length <= productIdx) next.push({ ...pricing });
      next[productIdx] = { ...next[productIdx], [field]: value };
      return next;
    });
  };

  const replicateConfigToAll = (sourceIdx: number) => {
    setPricingPerProduct(prev => {
      const source = prev[sourceIdx];
      if (!source) return prev;
      return prev.map((_, i) => i === sourceIdx ? prev[i] : { ...source });
    });
  };

  const replicateWeightDimToAll = (sourceIdx: number) => {
    setOptionDetailsMatrix(matrix => {
      const sourceRow = matrix[sourceIdx];
      if (!sourceRow) return matrix;
      return matrix.map((row, p) => {
        if (p === sourceIdx) return row;
        return row.map((opt, optIdx) => {
          const sourceOpt = sourceRow[optIdx];
          if (!sourceOpt) return opt;
          return {
            ...opt,
            weight: sourceOpt.weight,
            length: sourceOpt.length,
            width: sourceOpt.width,
            height: sourceOpt.height,
          };
        });
      });
    });
  };

  const replicateSkusToAll = (sourceIdx: number) => {
    setOptionDetailsMatrix(matrix => {
      const sourceRow = matrix[sourceIdx];
      if (!sourceRow) return matrix;
      return matrix.map((row, p) => {
        if (p === sourceIdx) return row;
        const targetProduct = products[p];
        const targetSkuBase = targetProduct?.sku ?? "";
        return row.map((opt, optIdx) => {
          const sourceOpt = sourceRow[optIdx];
          if (!sourceOpt) return opt;
          const newSku = targetSkuBase ? `${targetSkuBase}-${optIdx + 1}` : sourceOpt.sku;
          return { ...opt, sku: newSku };
        });
      });
    });
  };

  const optimizeMutation     = trpc.shopee.optimizeTitle.useMutation();
  const generateAdMutation   = trpc.shopee.generateAdContent.useMutation();
  const generateAllMutation  = trpc.shopee.generateAllContent.useMutation();
  const publishMutation      = trpc.shopee.createProductFromWizard.useMutation();
  const publishAsNewMutation = trpc.shopee.publishAsNewProduct.useMutation();
  const fillAttrsMutation    = trpc.ai.fillAttributes.useMutation();
  const trpcUtils            = trpc.useUtils();

  // Categoria efetiva: começa do produto e fica editável no fluxo CREATE.
  // Em UPDATE/PROMOTE a Shopee bloqueia mudança (CATEGORY_CHANGED), então o
  // picker aparece desabilitado com tooltip explicativo.
  // Modo combinado: pre-preenche com categoria do 1o produto Shopee, ou null se nenhum tiver
  const initialCategoryId = products.find(p => p.source === "shopee" && p.categoryId)?.categoryId ?? null;
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(initialCategoryId);

  // Sincroniza categoryId quando products resolve assincronamente
  useEffect(() => {
    if (selectedCategoryId !== null) return;
    const fromShopee = products.find(p => p.source === "shopee" && p.categoryId)?.categoryId;
    if (fromShopee) setSelectedCategoryId(fromShopee);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);
  // categoryName é o nome da folha (sem hierarquia) ou null pra
  // produtos sincronizados antes do cache de árvore. Resolvemos o
  // breadcrumb completo via tRPC abaixo quando há ID mas falta breadcrumb.
  const [selectedCategoryBreadcrumb, setSelectedCategoryBreadcrumb] = useState<string>("");
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
    { productId: 0 },
    { enabled: false, staleTime: 60_000 },
  );
  // Pre-flight: does the Shopee listing already carry tier_variation? If so,
  // we lack a UI for editing existing variations (init_tier_variation rejects
  // with "tier-variation not change"), so we block the publish button and
  // show a banner directing the user to the Shopee seller dashboard.
  const { data: existingVariation, isLoading: variationCheckLoading } =
    trpc.shopee.checkExistingVariation.useQuery(
      { productId: 0 },
      { enabled: false, staleTime: 30_000 },
    );
  // hasExistingVariation bloqueia o botão Publicar do wizard SOMENTE quando
  // o usuário NÃO escolheu o modo "createNew" — nesse modo é exatamente o
  // que ele quer fazer (criar novo) e a guarda atrapalharia.
  const hasExistingVariation = existingVariation?.hasVariation === true && !createNewMode;
  const { data: categoryAttributes, isLoading: attrLoading, error: attrError } =
    trpc.shopee.getCategoryAttributesV2.useQuery(
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

  function computePricing(opt: VariationOption, idx: number, productIdx: number = 0): ComputedPricing {
    const p = pricingPerProduct[productIdx] ?? pricing;
    const isQty          = selectedType === "quantidade";
    const qty            = isQty ? extractQty(opt.label) : 1;
    // Custo efetivo: batchCost/baseProductQty ou unitCost direto
    const batchCostVal   = parseFloat(p.batchCost) || 0;
    const rowBaseQty     = parseFloat(perRowBaseQty[productIdx] ?? "") || 0;
    const fallbackBatchQty = Math.max(parseFloat(p.baseProductQty) || 1, 0.001);
    const batchQty       = rowBaseQty > 0 ? rowBaseQty : fallbackBatchQty;
    // "Custo" representa custo TOTAL da quantidade base (matching tooltip).
    // Ex: Custo=R$10 + Qty base=10 -> unitCost = R$1
    // Ex: Custo=R$0.50 + Qty base=1 -> unitCost = R$0.50
    const unitCost       = batchCostVal > 0 ? batchCostVal / batchQty : ((parseFloat(p.unitCost) || 0) / batchQty);
    const packaging      = parseFloat(p.packagingCost)  || 0;
    const shipping       = parseFloat(p.shippingCost)   || 0;
    const txFee          = parseFloat(p.transactionFee) || 0;
    const autoDiscount   = (idx + 1) * (parseFloat(p.defaultDiscount) || 0);
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
      const multiplier = parseFloat(paramOverride || p.marginMultiplier) || 1;
      price = totalProductCost * multiplier;
    } else if (pricingMode === "margin") {
      const desiredMarginPct = parseFloat(paramOverride || p.desiredMargin) || 0;
      price = solvePriceByMargin(totalProductCost, packaging, shipping, txFee, desiredMarginPct);
    } else {
      const minProfit = parseFloat(paramOverride || p.minProfit) || 0;
      price = solvePriceByMinProfit(totalProductCost, packaging, shipping, txFee, minProfit);
    }

    // Aplica margem mínima desejada (piso) sobre o preço base
    let minMarginAdjusted = false;
    const minMarginFloor = parseFloat(p.minMarginPct) || 0;
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

    // Dimensions — per-row: prioriza products[productIdx] sobre getBase*() (fallback)
    const product = products[productIdx];
    const baseL         = parseFloat(baseLengthOverride || product?.dimensionLength || getBaseLength()) || 0;
    const baseW         = parseFloat(baseWidthOverride  || product?.dimensionWidth  || getBaseWidth())  || 0;
    const baseH         = parseFloat(baseHeightOverride || product?.dimensionHeight || getBaseHeight()) || 0;
    const baseWeight    = parseFloat(baseWeightOverride || product?.weight          || getBaseWeight())          || 0;
    const baseProductQty = Math.max(parseFloat(p.baseProductQty) || 1, 0.001);
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

  function updateOptionLabel(id: string, value: string, productIdx: number = 0) {
    setOptionDetailsMatrix(matrix => matrix.map((row, p) =>
      p === productIdx ? row.map(o => o.id === id ? { ...o, label: value } : o) : row
    ));
  }

  function autoGenerateFromFirst(productIdx: number = 0) {
    const row = optionDetailsMatrix[productIdx] ?? [];
    if (!row.length) return;
    const first = row[0];
    const firstQty = extractQty(first.label);
    if (firstQty <= 0) return;
    const fw = parseFloat(first.weight) || 0;
    const fl = parseFloat(first.length) || 0;
    const fw2 = parseFloat(first.width)  || 0;
    const fh  = parseFloat(first.height) || 0;
    const newAutoGen = new Set<string>();
    setOptionDetailsMatrix(matrix => matrix.map((r, p) => {
      if (p !== productIdx) return r;
      return r.map((opt, idx) => {
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
      });
    }));
    // Merge com set existente — preserva ids autogerados de outras rows
    setAutoGenerated(prev => {
      const merged = new Set(prev);
      newAutoGen.forEach(id => merged.add(id));
      return merged;
    });
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
  function goAtoB() {
    if (!selectedType) return;
    autoSaveWizardState();
    setStep("B");
  }

  // ── Etapa B ──
  function updateLabel(idx: number, val: string) {
    setOptionLabels(labels => labels.map((l, i) => (i === idx ? val : l)));
  }
  function addLabel()               { setOptionLabels(l => [...l, ""]); }
  function removeLabel(idx: number) { setOptionLabels(l => l.filter((_, i) => i !== idx)); }

  async function suggestWithAI() {
    try {
      // No modo combinado, sem product.id unico — pular sugestao IA
      setAiSuggestions([]);
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
    const baseName = getBaseName() || "produto";
    const transformed = selectedType === "quantidade"
      ? filled.map(l => {
          const n = parseFloat(l);
          return isNaN(n) ? l : `${n} Unidades de ${baseName}`;
        })
      : filled;
    const labels = transformed.map(label => truncateVariationName(label));

    // Criar matriz N x M: 1 row por produto, M opcoes por linha
    const matrix: VariationOption[][] = products.map((_p, productIdx) =>
      labels.map((label, optIdx) => ({
        ...emptyOption(label),
        id: `p${productIdx}_o${optIdx}_${uid()}`,
      }))
    );
    setOptionDetailsMatrix(matrix);

    // Inicializar perRowBaseQty (1 valor por produto)
    setPerRowBaseQty(products.map(() => ""));

    // Compatibilidade: opts agora referencia a primeira row (pra setters paralelos)
    const opts = matrix[0] ?? [];
    setQtyFactors(opts.map(() => ""));
    setPerVarParam(opts.map(() => ""));
    setPerVarEnabled(opts.map(() => false));
    setPriceOverrides(opts.map(() => null));
    setAutoGenAlerts([]);
    setManuallyEdited(new Set());
    setAutoGenerated(new Set());
    autoSaveWizardState();
    setStep("C");
  }

  // ── Etapa C ──
  function updateDetail(id: string, field: keyof Omit<VariationOption, "id" | "label">, value: string, productIdx: number = 0) {
    setOptionDetailsMatrix(matrix => matrix.map((row, p) =>
      p === productIdx ? row.map(o => o.id === id ? { ...o, [field]: value } : o) : row
    ));
  }

  function suggestDimensions(id: string, productIdx: number = 0) {
    setOptionDetailsMatrix(matrix => matrix.map((row, p) => {
      if (p !== productIdx) return row;
      return row.map(o => {
        if (o.id !== id) return o;
        const product = products[productIdx];
        const isQty = selectedType === "quantidade";
        const qty = isQty ? extractQty(o.label) : 1;
        const rowBaseQty = parseFloat(perRowBaseQty[productIdx] ?? "") || 0;
        const fallbackBaseQty = Math.max(parseFloat(pricing.baseProductQty) || 1, 0.001);
        const baseProductQty = rowBaseQty > 0 ? rowBaseQty : fallbackBaseQty;
        const baseWeight = parseFloat(baseWeightOverride || product?.weight || getBaseWeight()) || 0.5;
        const baseL = parseFloat(baseLengthOverride || product?.dimensionLength || getBaseLength()) || 20;
        const baseW = parseFloat(baseWidthOverride  || product?.dimensionWidth  || getBaseWidth())  || 15;
        const baseH = parseFloat(baseHeightOverride || product?.dimensionHeight || getBaseHeight()) || 10;
        const ratio = isQty ? qty / baseProductQty : 1;
        const scale = Math.cbrt(ratio);
        return {
          ...o,
          weight: o.weight || (baseWeight * ratio).toFixed(2),
          length: o.length || (baseL * scale).toFixed(1),
          width:  o.width  || (baseW * scale).toFixed(1),
          height: o.height || (baseH * scale).toFixed(1),
        };
      });
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

  // Normaliza dimensões para inteiro (string ou number → string sem ".0").
  // Bate com a semântica do backend que faz Math.round em 2 camadas.
  const dim = (v: string | number | undefined) => String(Math.round(Number(v) || 0));

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
        .filter(([attrId, v]) => v.originalValue.trim() !== "" && parseInt(attrId) > 0)
        .map(([attrId, v]) => {
          const def = Array.isArray(categoryAttributes)
            ? (categoryAttributes as any[]).find((a) => Number(a.attribute_id) === Number(attrId))
            : null;
          // Para format_type=2 a IA precisa ver "60 cm" e não só "60", senão
          // perde contexto de unidade na descrição. Display PT-BR (quando
          // dropdown) também é mais útil pra IA do que o EN cru.
          const valueText = v.valueUnit
            ? `${v.originalValue} ${v.valueUnit}`
            : (v.displayValue ?? v.originalValue);
          return {
            name: def?.display_attribute_name ?? def?.original_attribute_name ?? `attr_${attrId}`,
            value: valueText,
          };
        });

      const variations = optionDetails.map((opt, idx) => {
        const c = computePricing(opt, idx);
        return {
          label: opt.label,
          qty: c.qty,
          weight: opt.weight || c.weight.toFixed(2),
          dimensions: `${dim(opt.length || c.length)}×${dim(opt.width || c.width)}×${dim(opt.height || c.height)}`,
          price: c.price.toFixed(2),
        };
      });

      const result = await generateAllMutation.mutateAsync({
        productName: getBaseName() || "Produto",
        category: selectedCategoryBreadcrumb || undefined,
        // Marca escolhida no BrandPicker (Etapa 3). brandId=0 com nome "No Brand"
        // significa "Sem marca" — não passa nada pra IA pra evitar alucinação.
        brand:
          brandValue.brandId !== 0 || brandValue.brandName !== "No Brand"
            ? brandValue.brandName
            : undefined,
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
          dimensions: `${dim(opt.length || c.length)}×${dim(opt.width || c.width)}×${dim(opt.height || c.height)}`,
          price: c.price.toFixed(2),
        };
      });
      const result = await generateAdMutation.mutateAsync({
        productName: getBaseName() || "Produto",
        category: selectedCategoryBreadcrumb || undefined,
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

    const title = selectedTitle || adContent?.titulo_principal || getBaseName() || "";
    const description = editedDesc || adContent?.descricao || "";
    const hashtags: string[] = adContent?.hashtags ?? [];

    // Build attribute_list from Ficha Técnica values. attribute_id<=0 é o
    // sintético BRAND (ensureBrandAttribute) — vai no campo `brand` separado,
    // não no attribute_list, então filtramos aqui.
    // Para format_type=2 (QUANTITATIVE_WITH_UNIT) a Shopee exige value_unit.
    // Cobrimos aqui os caminhos que não setam unit no estado (IA via
    // autoFillAttributes + edição no Bloco 2 da Revisão) defaultando para
    // o primeiro item de attribute_unit_list. Se categoryAttributes ainda
    // não carregou (def===undefined), preserva o comportamento anterior — não
    // injeta unit; o backend devolveria o mesmo erro de antes.
    const attrDefById = new Map<number, any>(
      Array.isArray(categoryAttributes)
        ? (categoryAttributes as any[]).map((a) => [Number(a.attribute_id), a])
        : [],
    );
    const attributes = Object.entries(attributeValues)
      .filter(([attrId, v]) => v.originalValue.trim() !== "" && parseInt(attrId) > 0)
      .map(([attrId, v]) => {
        const id = parseInt(attrId);
        const def = attrDefById.get(id);
        const unitFallback =
          !v.valueUnit &&
          def?.format_type === 2 &&
          Array.isArray(def.attribute_unit_list) &&
          def.attribute_unit_list.length > 0
            ? def.attribute_unit_list[0]
            : undefined;
        const valueUnit = v.valueUnit ?? unitFallback;
        return {
          attributeId: id,
          attributeValueList: [{
            valueId: v.valueId,
            originalValueName: v.originalValue,
            ...(valueUnit ? { valueUnit } : {}),
          }],
        };
      });

    setPublishStatus("loading");
    setPublishError("");
    try {
      const commonPayload = {
        accountId,
        sourceProductId: products[principalIndex]?.sourceId ?? 0,
        variationTypeName: typeName,
        variations: validOpts,
        title,
        description,
        hashtags,
        attributes: attributes.length > 0 ? attributes : undefined,
        categoryId:
          selectedCategoryId && selectedCategoryId !== initialCategoryId
            ? selectedCategoryId
            : undefined,
        // Brand vai como campo top-level do payload add_item (não como
        // attribute). Backend só consome no CREATE path; UPDATE preserva
        // a marca cadastrada no anúncio.
        brand: { brandId: brandValue.brandId, brandName: brandValue.brandName },
      };

      let result: { itemId: number; itemUrl: string; mode?: "create" | "update" | "promote" };
      if (createNewMode) {
        // Fluxo "Criar como novo produto" — força add_item, preserva o
        // itemId antigo em shopeeItemIdLegacy. Não passa overrideMode (a
        // procedure do backend já força create).
        await publishAsNewMutation.mutateAsync({
          ...commonPayload,
          newItemName: effectiveNewItemName || undefined,
        });
        // Diferente do fluxo normal (update/promote), o "publicar como novo"
        // troca o itemId do registro local pelo novo anúncio Shopee — o
        // usuário esperaria ver isso refletido na lista, então invalidamos a
        // query, mostramos toast e redirecionamos. Sai cedo pra não piscar o
        // card verde do publishStatus="success" antes da navegação.
        await trpcUtils.shopee.getProducts.invalidate();
        toast.success("Produto criado com sucesso na Shopee!");
        setLocation("/shopee-products");
        return;
      } else {
        const r = await publishMutation.mutateAsync({
          ...commonPayload,
          overrideMode: effectiveOverrideMode,
          newItemName: effectiveOverrideMode === "create" ? (effectiveNewItemName || undefined) : undefined,
        });
        result = { itemId: r.itemId, itemUrl: r.itemUrl, mode: r.mode };
      }
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
  // hasPricing global (legado): true se QUALQUER produto tem custos preenchidos
  const hasPricing   = pricingPerProduct.some(p => parseFloat(p?.unitCost) > 0 || parseFloat(p?.batchCost) > 0) || parseFloat(pricing.unitCost) > 0 || parseFloat(pricing.batchCost) > 0;

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
        attribute_value_list: Array<{ value_id: number; display_value_name: string; original_value_name?: string }>;
      }>;
      const suggestions = await fillAttrsMutation.mutateAsync({
        product: {
          name: getBaseName() || "",
          description: "",
          features: {},
          category: selectedCategoryBreadcrumb || "",
        },
        // Pula o BRAND sintético: marca é controlada pelo BrandPicker
        // dedicado, não pelo preenchimento de atributos.
        requiredAttributes: attrs
          .filter(a => a.input_type !== "BRAND")
          .map(a => ({
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
            if (match) next[attrId] = {
              valueId: match.value_id,
              originalValue: match.original_value_name ?? match.display_value_name,
              displayValue: match.display_value_name,
            };
          } else {
            // Para format_type=2 (QUANTITATIVE_WITH_UNIT) o usuário escolhe a
            // unidade no select; a IA não inferia unidade até agora.
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
    <div className="w-full">
      <div className="bg-white rounded-2xl shadow-md border w-full flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">{createNewMode ? "Publicar como Novo Produto" : "Criar Variação de Anúncio"}</h3>
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

              {/* Modo de pricing — global do anuncio (regra comum a todos os produtos) */}
              <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-xs font-semibold text-gray-700">Modo:</span>
                <div className="flex gap-1">
                  {(["multiplier", "margin", "profit"] as const).map(m => (
                    <button key={m} onClick={() => setPricingMode(m)}
                      className={`px-3 py-1.5 text-xs rounded border transition ${
                        pricingMode === m
                          ? "bg-orange-500 text-white border-orange-500"
                          : "bg-white text-gray-600 border-gray-200 hover:border-orange-300"
                      }`}>
                      {m === "multiplier" ? "× Multiplicador" : m === "margin" ? "% Margem" : "R$ Lucro"}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-500 flex-1">
                  {pricingMode === "multiplier" && "Preço = custo × multiplicador. Desconto reduz por faixa."}
                  {pricingMode === "margin"     && "Preço calculado para garantir margem percentual desejada após custos Shopee."}
                  {pricingMode === "profit"     && "Preço calculado para garantir lucro mínimo em R$ por variação."}
                </span>
              </div>

              {/* Categoria Shopee (selecao ou troca) */}
              <div className="border border-gray-200 rounded-xl bg-white p-4 mb-3">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  🏷️ Categoria Shopee
                </h3>
                <CategoryPicker
                  accountId={accountId}
                  value={selectedCategoryId}
                  valueBreadcrumb={selectedCategoryBreadcrumb}
                  onChange={(id, crumb) => {
                    setSelectedCategoryId(id);
                    setSelectedCategoryBreadcrumb(crumb);
                  }}
                />
              </div>

              {!categoryId && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-3 text-xs text-yellow-800">
                  💡 Selecione uma categoria acima para ver as especificacoes do produto.
                </div>
              )}

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
                        format_type?: number;
                        attribute_unit_list?: string[];
                        attribute_value_list: Array<{ value_id: number; display_value_name: string; original_value_name?: string }>;
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
                              <BrandPicker
                                accountId={accountId}
                                categoryId={categoryId}
                                value={brandValue}
                                onChange={setBrandValue}
                              />
                            ) : attr.input_type === "DROP_DOWN" ? (
                              <select
                                value={current?.valueId ?? ""}
                                onChange={e => {
                                  const opt = values.find(o => o.value_id === Number(e.target.value));
                                  if (opt) {
                                    // Shopee espera `original_value_name` (EN) no payload; o display
                                    // (PT-BR) é só pra UI. Guardamos os dois separados.
                                    setAttributeValues(prev => ({
                                      ...prev,
                                      [attr.attribute_id]: {
                                        valueId: opt.value_id,
                                        originalValue: opt.original_value_name ?? opt.display_value_name,
                                        displayValue: opt.display_value_name,
                                      },
                                    }));
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
                            ) : (attr.format_type === 2 && Array.isArray(attr.attribute_unit_list) && attr.attribute_unit_list.length > 0) ? (
                              // QUANTITATIVE_WITH_UNIT: número + select de unidade.
                              // Shopee exige value_unit no payload (ex: "60" + "cm").
                              <div className="flex gap-1.5">
                                <input type="number" step="any"
                                  value={current?.originalValue ?? ""}
                                  onChange={e => setAttributeValues(prev => ({
                                    ...prev,
                                    [attr.attribute_id]: {
                                      valueId: 0,
                                      originalValue: e.target.value,
                                      valueUnit: prev[attr.attribute_id]?.valueUnit ?? attr.attribute_unit_list![0],
                                    },
                                  }))}
                                  placeholder="0"
                                  className={`flex-1 text-xs rounded-lg border ${border} ${bg} px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                                />
                                <select
                                  value={current?.valueUnit ?? attr.attribute_unit_list[0]}
                                  onChange={e => setAttributeValues(prev => ({
                                    ...prev,
                                    [attr.attribute_id]: {
                                      valueId: 0,
                                      originalValue: prev[attr.attribute_id]?.originalValue ?? "",
                                      valueUnit: e.target.value,
                                    },
                                  }))}
                                  className={`text-xs rounded-lg border ${border} ${bg} px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-400`}
                                >
                                  {attr.attribute_unit_list.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                  ))}
                                </select>
                              </div>
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

              {/* ── CARDS DE CONFIGURACAO PER-PRODUCT (empilhados no topo) ── */}
              {products.map((product, productIdx) => (
                <div key={`cfg-${product.source}:${product.sourceId}`} className="border border-gray-200 rounded-xl bg-white p-4 mb-3">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-2 flex-1 min-w-0">
                      {product.imageUrl && (
                        <img src={product.imageUrl} alt={product.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      )}
                      <Settings className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      <span className="truncate">Configurações de {product.name}</span>
                    </h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedType === "quantidade" && (
                        <div className="flex items-center gap-1.5">
                          <label className="text-[11px] text-gray-600" title="Quantidade base do produto cadastrado (ex: pacote de 100un)">Qty base:</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder={pricingPerProduct[productIdx]?.baseProductQty || "1"}
                            value={perRowBaseQty[productIdx] ?? ""}
                            onChange={e => setPerRowBaseQty(arr => {
                              const next = [...arr];
                              while (next.length < products.length) next.push("");
                              next[productIdx] = e.target.value;
                              return next;
                            })}
                            className="w-16 text-[11px] rounded border border-gray-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
                          />
                        </div>
                      )}
                      {(optionDetailsMatrix[productIdx]?.length ?? 0) > 1 && (
                        <button onClick={() => autoGenerateFromFirst(productIdx)}
                          className="text-[11px] text-blue-600 hover:text-blue-700 border border-blue-200 rounded px-2 py-1 bg-white"
                          title="Replica peso/dim da 1a opcao pras demais deste produto">
                          ⚡ Propagar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Linha 1: Custos & taxas */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-2">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5" title="Custo total da quantidade base. Ex: comprou 10 unidades por R$5? Coloque 5.">Custo (R$)</label>
                      <input type="number" min="0" step="0.01" placeholder="0.00"
                        value={pricingPerProduct[productIdx]?.unitCost ?? ""}
                        onChange={e => updateProductPricing(productIdx, "unitCost", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5" title="Quantidade base do produto. Ex: comprou 10 unidades? Coloque 10. Ou 1 unidade individual? Coloque 1.">Qty base</label>
                      <input type="number" min="1" step="1" placeholder="1"
                        value={pricingPerProduct[productIdx]?.baseProductQty ?? ""}
                        onChange={e => updateProductPricing(productIdx, "baseProductQty", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5" title="Custo de embalagem por venda.">Embalagem (R$)</label>
                      <input type="number" min="0" step="0.01" placeholder="0.00"
                        value={pricingPerProduct[productIdx]?.packagingCost ?? ""}
                        onChange={e => updateProductPricing(productIdx, "packagingCost", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5" title="Custo de envio estimado.">Frete (R$)</label>
                      <input type="number" min="0" step="0.01" placeholder="0.00"
                        value={pricingPerProduct[productIdx]?.shippingCost ?? ""}
                        onChange={e => updateProductPricing(productIdx, "shippingCost", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5" title="Taxa da processadora (geralmente 2%).">Taxa transação (%)</label>
                      <input type="number" min="0" step="0.1" placeholder="2"
                        value={pricingPerProduct[productIdx]?.transactionFee ?? ""}
                        onChange={e => updateProductPricing(productIdx, "transactionFee", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                  </div>

                  {/* Linha 2: Pricing mode params */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5">{modeParamLabel}</label>
                      <input type="number" min="0" step={pricingMode === "multiplier" ? "0.1" : "1"}
                        placeholder={modeGlobalPlaceholder}
                        value={pricingPerProduct[productIdx]?.[modeGlobalKey] ?? ""}
                        onChange={e => updateProductPricing(productIdx, modeGlobalKey, e.target.value)}
                        className="w-full px-2 py-1.5 border border-orange-300 bg-orange-50 rounded text-xs font-medium focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    {pricingMode === "multiplier" && (
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-0.5" title="Desconto progressivo por faixa.">Desc. faixa (%)</label>
                        <input type="number" min="0" max="100" step="0.1" placeholder="0"
                          value={pricingPerProduct[productIdx]?.defaultDiscount ?? ""}
                          onChange={e => updateProductPricing(productIdx, "defaultDiscount", e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5" title="Se o calculo der margem abaixo disso, sobe o preco automaticamente.">Margem mín. (%)</label>
                      <input type="number" min="0" max="100" step="0.1" placeholder="15"
                        value={pricingPerProduct[productIdx]?.minMarginPct ?? ""}
                        onChange={e => updateProductPricing(productIdx, "minMarginPct", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-0.5" title="Estoque padrao aplicado a todas variacoes.">Estoque global</label>
                      <input type="number" min="0" placeholder="0"
                        value={pricingPerProduct[productIdx]?.globalStock ?? ""}
                        onChange={e => updateProductPricing(productIdx, "globalStock", e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400" />
                    </div>
                  </div>
                </div>
              ))}

              {/* ── TABELA UNICA com TODAS as combinacoes (Produto x Opcao) ── */}
              <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600 w-48">Produto</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Variação</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Peso (kg)</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Comp (cm)</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Larg (cm)</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Alt (cm)</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">SKU</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Preço</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Estoque</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-600">Lucro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optionDetailsMatrix.flatMap((row, productIdx) => {
                      const product = products[productIdx];
                      if (!product) return [];
                      return row.map((opt, idx) => {
                        const c = computePricing(opt, idx, productIdx);
                        const pp = pricingPerProduct[productIdx];
                        const hasPricingForRow = parseFloat(pp?.unitCost ?? "") > 0 || parseFloat(pp?.batchCost ?? "") > 0;
                        const badge = profitBadge(c.profitPct);
                        const isNeg = c.marginContribution < 0;
                        const isFirstInGroup = idx === 0;
                        const groupBorder = isFirstInGroup && productIdx > 0 ? "border-t-2 border-t-gray-300" : "";

                        const isSelected = selectedCell?.productIdx === productIdx && selectedCell?.optIdx === idx;
                        return (
                          <tr
                            key={opt.id}
                            onClick={() => setSelectedCell({ productIdx, optIdx: idx })}
                            className={`border-b border-gray-100 cursor-pointer transition ${
                              isSelected
                                ? "bg-orange-50 ring-2 ring-orange-300"
                                : isNeg
                                ? "bg-red-50"
                                : "hover:bg-gray-50/50"
                            } ${groupBorder}`}
                          >
                            {/* Coluna Produto: rowSpan SO na primeira linha do grupo */}
                            {isFirstInGroup ? (
                              <td rowSpan={row.length} className="px-2 py-2 align-top border-r border-gray-200 bg-gray-50/30">
                                <div className="flex items-start gap-2">
                                  {product.imageUrl && (
                                    <img src={product.imageUrl} alt={product.name} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <input
                                      type="text"
                                      maxLength={20}
                                      value={productNameOverrides[productIdx] ?? (product.name ?? "").slice(0, 20)}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const v = e.target.value.slice(0, 20);
                                        setProductNameOverrides(prev => ({ ...prev, [productIdx]: v }));
                                      }}
                                      className="w-full text-xs font-medium text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-orange-400 focus:outline-none px-0.5 py-0.5"
                                      title="Editavel - max 20 chars (limite Shopee para nome de variacao 1)"
                                    />
                                    {product.sku && <p className="text-[10px] text-gray-500 font-mono mt-0.5">{product.sku}</p>}
                                  </div>
                                </div>
                              </td>
                            ) : null}

                            {/* Variação (label) */}
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={opt.label}
                                maxLength={20}
                                onClick={(e) => e.stopPropagation()}
                                onChange={e => {
                                  updateOptionLabel(opt.id, e.target.value.slice(0, 20), productIdx);
                                  if (idx > 0) {
                                    setManuallyEdited(s => new Set(s).add(opt.id));
                                    setAutoGenerated(s => { const n = new Set(s); n.delete(opt.id); return n; });
                                  }
                                }}
                                className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                              />
                            </td>

                            {/* Peso/Comp/Larg/Alt */}
                            {([
                              { field: "weight" as const, ph: c.weight > 0 ? c.weight.toFixed(2) : "0.50", integer: false },
                              { field: "length" as const, ph: c.length > 0 ? String(Math.round(c.length)) : "20", integer: true },
                              { field: "width"  as const, ph: c.width  > 0 ? String(Math.round(c.width))  : "15", integer: true },
                              { field: "height" as const, ph: c.height > 0 ? String(Math.round(c.height)) : "10", integer: true },
                            ]).map(({ field, ph, integer }) => (
                              <td key={field} className="px-1.5 py-1.5">
                                <input
                                  type="number"
                                  min={integer ? "1" : "0"}
                                  step={integer ? "1" : "0.01"}
                                  placeholder={ph}
                                  value={(opt as any)[field]}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={integer ? (e) => { if (e.key === "." || e.key === ",") e.preventDefault(); } : undefined}
                                  onChange={e => {
                                    let v = e.target.value;
                                    if (integer && v !== "") v = String(Math.floor(Number(v) || 0));
                                    updateDetail(opt.id, field, v, productIdx);
                                    if (idx > 0) {
                                      setManuallyEdited(s => new Set(s).add(opt.id));
                                      setAutoGenerated(s => { const n = new Set(s); n.delete(opt.id); return n; });
                                    }
                                  }}
                                  className="w-16 px-1.5 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                                />
                              </td>
                            ))}

                            {/* SKU */}
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                maxLength={64}
                                placeholder={product.sku ? `${product.sku}-${idx + 1}` : "SKU"}
                                value={opt.sku}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateDetail(opt.id, "sku", e.target.value, productIdx)}
                                className="w-32 px-1.5 py-1 border border-gray-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-orange-400"
                              />
                            </td>

                            {/* Preço */}
                            <td className="px-2 py-1.5">
                              <div className="flex flex-col">
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  placeholder={c.price > 0 ? c.price.toFixed(2) : "0.00"}
                                  value={opt.price}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => updateDetail(opt.id, "price", e.target.value, productIdx)}
                                  className={`w-20 px-1.5 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400 ${
                                    isNeg ? "border-red-400" : "border-gray-200"
                                  }`}
                                />
                                {!opt.price && hasPricing && (
                                  <span className="text-[10px] text-gray-400 mt-0.5">calc: R$ {c.price.toFixed(2)}</span>
                                )}
                              </div>
                            </td>

                            {/* Estoque */}
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                min="0"
                                placeholder={pricingPerProduct[productIdx]?.globalStock || "0"}
                                value={opt.stock}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => updateDetail(opt.id, "stock", e.target.value, productIdx)}
                                className="w-16 px-1.5 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                              />
                            </td>

                            {/* Lucro */}
                            <td className="px-2 py-1.5">
                              {hasPricingForRow ? (
                                <div
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold cursor-help ${
                                    isNeg
                                      ? "bg-red-100 text-red-700 border border-red-300"
                                      : `${badge.bg}`
                                  }`}
                                  title={
                                    isNeg
                                      ? `PREJUÍZO\nMargem: R$ ${c.marginContribution.toFixed(2)}\nCusto: R$ ${c.totalProductCost.toFixed(2)}\nPlataforma: R$ ${c.platformCost.toFixed(2)}`
                                      : `Lucro: ${c.profitPct.toFixed(1)}%\nMargem: R$ ${c.marginContribution.toFixed(2)}\nCusto produto: R$ ${c.totalProductCost.toFixed(2)}\nCusto plataforma: R$ ${c.platformCost.toFixed(2)}\nQtd: ${c.qty}x`
                                  }
                                >
                                  {isNeg ? "PREJ." : `${c.profitPct.toFixed(0)}%`}
                                  {!isNeg && c.minMarginAdjusted && <span className="text-green-600">↑</span>}
                                </div>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>

              {/* Card de calculo da celula selecionada */}
              {selectedCell && (() => {
                const product = products[selectedCell.productIdx];
                const row = optionDetailsMatrix[selectedCell.productIdx];
                const opt = row?.[selectedCell.optIdx];
                if (!product || !opt) return null;
                const pp = pricingPerProduct[selectedCell.productIdx] ?? pricing;
                const c = computePricing(opt, selectedCell.optIdx, selectedCell.productIdx);

                const finalPrice = parseFloat(opt.price) > 0 ? parseFloat(opt.price) : c.price;
                const profit = finalPrice - c.totalProductCost - c.platformCost;
                const profitPct = finalPrice > 0 ? (profit / finalPrice) * 100 : 0;

                const modeLabel =
                  pricingMode === "multiplier" ? `Multiplicador ${pp.marginMultiplier}x`
                  : pricingMode === "margin"   ? `Margem desejada ${pp.desiredMargin}%`
                  : `Lucro minimo R$ ${pp.minProfit}`;

                const txFee = parseFloat(pp.transactionFee) || 0;
                const packaging = parseFloat(pp.packagingCost) || 0;
                const shipping = parseFloat(pp.shippingCost) || 0;
                const commissionValue = finalPrice * c.commissionRate + c.commissionFixed;
                const taxValue = finalPrice * (txFee / 100);
                const minMargin = parseFloat(pp.minMarginPct) || 0;

                return (
                  <div className="mt-4 border-2 border-orange-300 rounded-xl bg-orange-50/50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        Calculo: {productNameOverrides[selectedCell.productIdx] ?? product.name} — {opt.label || "(sem label)"}
                      </h4>
                      <button
                        onClick={() => setSelectedCell(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-white"
                      >
                        fechar
                      </button>
                    </div>
                    <div className="text-[10px] text-gray-500 mb-2">Modo: {modeLabel}</div>
                    <div className="space-y-1.5 text-xs font-mono">
                      <div className="flex justify-between">
                        <span className="text-gray-700">Custo produto (qtd {c.qty}x):</span>
                        <span className="text-gray-900">R$ {c.totalProductCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-700">+ Embalagem:</span>
                        <span className="text-gray-900">R$ {packaging.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-700">+ Frete:</span>
                        <span className="text-gray-900">R$ {shipping.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-700">+ Comissao Shopee ({(c.commissionRate * 100).toFixed(1)}% + R$ {c.commissionFixed.toFixed(2)}):</span>
                        <span className="text-gray-900">R$ {commissionValue.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-700">+ Taxa transacao ({txFee}%):</span>
                        <span className="text-gray-900">R$ {taxValue.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-300 pt-1.5 mt-1.5">
                        <span className="text-gray-800 font-semibold">Custo plataforma total:</span>
                        <span className="text-gray-900 font-semibold">R$ {c.platformCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-800 font-semibold">Custo total (produto + plataforma):</span>
                        <span className="text-gray-900 font-semibold">R$ {(c.totalProductCost + c.platformCost).toFixed(2)}</span>
                      </div>
                      {c.effectiveDisc !== 0 && (
                        <div className="flex justify-between text-blue-700">
                          <span>Desconto progressivo aplicado:</span>
                          <span>{c.effectiveDisc.toFixed(1)}% (fator {c.factor.toFixed(3)})</span>
                        </div>
                      )}
                      {c.minMarginAdjusted && minMargin > 0 && (
                        <div className="flex justify-between text-blue-700">
                          <span>Piso aplicado pela margem min ({minMargin}%):</span>
                          <span>↑ ajustado</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t-2 border-orange-400 pt-2 mt-2 text-base">
                        <span className="text-gray-900 font-bold">PRECO FINAL:</span>
                        <span className="text-orange-700 font-bold">R$ {finalPrice.toFixed(2)}</span>
                      </div>
                      <div className={`flex justify-between font-semibold ${profit < 0 ? "text-red-700" : "text-green-700"}`}>
                        <span>{profit < 0 ? "PREJUIZO" : "Lucro liquido"}:</span>
                        <span>R$ {profit.toFixed(2)} ({profitPct.toFixed(1)}%)</span>
                      </div>
                      <div className="flex justify-between text-gray-500 pt-1 mt-1 border-t border-gray-200">
                        <span>Peso/Dim:</span>
                        <span>{c.weight.toFixed(2)}kg · {c.length.toFixed(0)}×{c.width.toFixed(0)}×{c.height.toFixed(0)}cm</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── ETAPA D – Revisão (resumo do anuncio combinado) ── */}
          {step === "D" && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                📋 Resumo do Anuncio Combinado
              </h3>

              {/* Resumo das combinacoes 2D */}
              <div className="border border-gray-200 rounded-xl bg-white p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  VARIACOES — {products.length} produto{products.length > 1 ? "s" : ""} × varias opcoes = {optionDetailsMatrix.reduce((acc, row) => acc + row.length, 0)} combinacoes
                </h4>

                <div className="space-y-3">
                  {optionDetailsMatrix.map((row, productIdx) => {
                    const product = products[productIdx];
                    if (!product) return null;
                    return (
                      <div key={`rev-${productIdx}`} className="border-l-2 border-orange-300 pl-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          {product.imageUrl && (
                            <img src={product.imageUrl} alt={product.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                          )}
                          <span className="text-sm font-semibold text-gray-800 truncate">{product.name}</span>
                        </div>
                        <table className="w-full text-xs ml-10 border border-gray-200 rounded">
                          <thead className="bg-gray-50">
                            <tr className="text-left text-gray-600 text-[11px]">
                              <th className="px-2 py-1.5 border-b border-gray-200">Variação 1 (produto)</th>
                              <th className="px-2 py-1.5 border-b border-gray-200">Variação 2</th>
                              <th className="px-2 py-1.5 border-b border-gray-200 text-right">Preço</th>
                              <th className="px-2 py-1.5 border-b border-gray-200 text-right">Estoque</th>
                              <th className="px-2 py-1.5 border-b border-gray-200 text-right">Lucro</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.map((opt, idx) => {
                              const c = computePricing(opt, idx, productIdx);
                              const pp = pricingPerProduct[productIdx];
                              const hasPricingForRow = parseFloat(pp?.unitCost ?? "") > 0;
                              const isNeg = c.marginContribution < 0;
                              const productLabel = productNameOverrides[productIdx] ?? (product.name ?? "").slice(0, 20);
                              return (
                                <tr key={opt.id} className="border-b border-gray-100 last:border-b-0">
                                  <td className="px-2 py-1.5 text-gray-800">{productLabel}</td>
                                  <td className="px-2 py-1.5 text-gray-700 font-medium">{opt.label || "—"}</td>
                                  <td className="px-2 py-1.5 text-gray-800 font-semibold text-right">
                                    R$ {parseFloat(opt.price || c.price.toFixed(2) || "0").toFixed(2)}
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-600 text-right">
                                    {opt.stock || pp?.globalStock || "0"}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    {hasPricingForRow ? (
                                      <span className={`font-semibold ${isNeg ? "text-red-600" : "text-green-600"}`}>
                                        {isNeg ? "PREJ" : `${c.profitPct.toFixed(0)}%`}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Categoria */}
              <div className="border border-gray-200 rounded-xl bg-white p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">🏷️ Categoria Shopee</h4>
                <p className="text-xs text-gray-600">
                  {selectedCategoryBreadcrumb || (selectedCategoryId ? `ID: ${selectedCategoryId}` : "Nao selecionada")}
                </p>
              </div>

              {/* Resumo Ficha Tecnica */}
              <div className="border border-gray-200 rounded-xl bg-white p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">📋 Ficha Tecnica</h4>
                {(brandValue?.brandName || Object.keys(attributeValues).length > 0) ? (
                  <div className="space-y-1">
                    {brandValue?.brandName && (
                      <div className="flex items-start gap-2 text-xs">
                        <span className="text-gray-500 min-w-[120px] truncate">Marca:</span>
                        <span className="text-gray-800 font-medium flex-1">{brandValue.brandName}</span>
                      </div>
                    )}
                    {Object.entries(attributeValues).map(([attrIdStr, val]: [string, any]) => {
                      const attrId = Number(attrIdStr);
                      const attrDef = Array.isArray(categoryAttributes)
                        ? (categoryAttributes as any[]).find((a: any) => Number(a.attribute_id) === attrId)
                        : undefined;
                      const name = attrDef?.display_attribute_name ?? attrDef?.original_attribute_name ?? `Atributo ${attrId}`;
                      const display = val?.displayValue ?? val?.originalValue ?? "—";
                      const unit = val?.valueUnit ? ` ${val.valueUnit}` : "";
                      return (
                        <div key={attrIdStr} className="flex items-start gap-2 text-xs">
                          <span className="text-gray-500 min-w-[120px] truncate">{name}:</span>
                          <span className="text-gray-800 font-medium flex-1">{display}{unit}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Nenhum atributo preenchido</p>
                )}
              </div>

              {/* Acoes */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep("C")}
                  className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-xl text-sm font-medium transition"
                >
                  <ArrowLeft className="w-4 h-4" /> Voltar
                </button>

                <button
                  onClick={async () => {
                    autoSaveWizardState();
                    await new Promise(r => setTimeout(r, 300));
                    if (onSave) onSave({ name: "rascunho", productSourceIds: [], options: [] } as any);
                  }}
                  disabled={updateListingMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition"
                >
                  💾 Salvar Rascunho
                </button>
              </div>
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
              <button onClick={() => { applyFourTimesRule(); autoSaveWizardState(); setStep("D"); }} disabled={hasNegativeMargin}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition">
                Revisar <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
          {/* step === "D": acoes ficam dentro do conteudo da revisao (Salvar Rascunho) */}
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
                setNewItemName(suggestNewName(getBaseName() || ""));
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
