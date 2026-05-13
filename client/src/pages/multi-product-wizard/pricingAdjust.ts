/**
 * ⚠️ ESPELHO EXATO de server/multi-product-publish.ts (Fase 6.2).
 *    Funções espelhadas:
 *     - applyPricingAdjustment (linhas ~141-208 do server)
 *     - applyMinMarginFloor    (linhas ~231-309 do server)
 *     - resolveEffectiveMultiplier (linhas ~120-135 do server)
 *
 *    SE MUDAR LÁ, MUDAR AQUI.
 *    Divergência = bug invisível em produção (UI mostra um valor,
 *    backend publica outro — operador valida visualmente e confia).
 *
 *    Última sincronia: <COMMIT_FASE_6_2_HASH> (Fase 6.2 — motor pricing
 *    server + margem mín ATIVA + denominador da conta principal).
 *    Substitui referência antiga ao commit 5cd76c7 (Fase 6.1.B).
 *
 * Mudanças da Fase 6.2 vs Fase 6.1.B:
 *  - listingMultiplier agora é o mult EFETIVO DA CONTA PRINCIPAL
 *    (resolvido via resolveEffectiveMultiplier), não mais o
 *    ws.pricing.marginMultiplier global.
 *  - Nova função applyMinMarginFloor: aplica piso de margem mínima
 *    (MAX entre per-product e per-account) depois do ajuste de mult.
 *  - Preço manual (cellPriceWasManual) e modo blPrice continuam
 *    pulando AMBOS os ajustes — manual sempre vence.
 *
 * Fórmulas (idênticas ao backend):
 *
 *   1) applyPricingAdjustment:
 *      factor = publicationMultiplier / listingMultiplier
 *      finalPrice = max(clientPrice × factor, 1)
 *
 *   2) applyMinMarginFloor (DEPOIS do (1)):
 *      floor = max(productMinMargin, publicationMinMargin)
 *      curMargin = (adjusted - totalProductCost - platformCost) / adjusted × 100
 *      se curMargin < floor → bump via solvePriceByMargin
 *      caso retorne 0 → infeasible (caller deve falhar a conta)
 */
import {
  shopeeCommission, solvePriceByMargin,
} from "@shared/shopee-pricing";

/**
 * Resolve mult efetivo via chain pub → product → global.
 * Retorna string|undefined (espelho de resolveEffectiveMultiplier no server).
 */
export function resolveEffectiveMultiplier(
  publicationMultiplier: string | number | null | undefined,
  productMultiplier: string | number | null | undefined,
  globalMultiplier: string | number | null | undefined,
): string | undefined {
  const norm = (v: string | number | null | undefined): string | undefined => {
    if (v == null) return undefined;
    const s = typeof v === "string" ? v.trim() : String(v);
    if (s === "" || s === "0") return undefined;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return s;
  };
  return norm(publicationMultiplier) ?? norm(productMultiplier) ?? norm(globalMultiplier);
}

export function applyPricingAdjustment(params: {
  clientPrice: number;
  cellPriceWasManual: boolean;
  listingMultiplier: string | number | null | undefined;
  publicationMultiplier: string | number | null | undefined;
}): number {
  const { clientPrice, cellPriceWasManual, listingMultiplier, publicationMultiplier } = params;

  if (cellPriceWasManual) {
    return clientPrice;
  }

  const pubMult = publicationMultiplier == null || publicationMultiplier === ""
    ? null
    : Number(publicationMultiplier);
  const listingMult = listingMultiplier == null || listingMultiplier === ""
    ? null
    : Number(listingMultiplier);

  if (pubMult == null || !Number.isFinite(pubMult) || pubMult <= 0) {
    return clientPrice;
  }
  if (listingMult == null || !Number.isFinite(listingMult) || listingMult <= 0) {
    return clientPrice;
  }

  const factor = pubMult / listingMult;
  return Math.max(clientPrice * factor, 1);
}

/**
 * Helper de display: indica se o ajuste de mult foi efetivamente aplicado.
 * Retorna `null` quando: manual, sem pub mult, listing mult inválido, OU
 * factor === 1 (mesmo mult que principal — não muda nada).
 */
export function describePricingAdjustment(params: {
  cellPriceWasManual: boolean;
  listingMultiplier: string | number | null | undefined;
  publicationMultiplier: string | number | null | undefined;
}): { factor: number } | null {
  const { cellPriceWasManual, listingMultiplier, publicationMultiplier } = params;
  if (cellPriceWasManual) return null;

  const pubMult = publicationMultiplier == null || publicationMultiplier === ""
    ? null
    : Number(publicationMultiplier);
  const listingMult = listingMultiplier == null || listingMultiplier === ""
    ? null
    : Number(listingMultiplier);

  if (pubMult == null || !Number.isFinite(pubMult) || pubMult <= 0) return null;
  if (listingMult == null || !Number.isFinite(listingMult) || listingMult <= 0) return null;

  const factor = pubMult / listingMult;
  if (factor === 1) return null;
  return { factor };
}

/**
 * ESPELHO de server/multi-product-publish.ts applyMinMarginFloor.
 *
 * Aplicado DEPOIS de applyPricingAdjustment. Recomputa margem com base no
 * preço ajustado e custos da variação; se margem < floor → bump via
 * solvePriceByMargin (mesma função do server).
 *
 * floor = MAX(productMinMargin, publicationMinMargin)
 *
 * NÃO aplica (retorna { price: adjustedPrice, floored:false, infeasible:false }):
 *  - cellPriceWasManual (manual sempre vence)
 *  - pricingMode === "blPrice"
 *  - totalProductCost <= 0 (margem incalculável)
 *  - floor <= 0
 *
 * Sinaliza `infeasible: true` quando solvePriceByMargin retorna 0
 * (floor matematicamente inviável dado custos + comissão Shopee).
 */
export function applyMinMarginFloor(params: {
  adjustedPrice: number;
  cellPriceWasManual: boolean;
  pricingMode: string | undefined;
  totalProductCost: number;
  packaging: number;
  shipping: number;
  txFee: number;
  productMinMargin: string | number | null | undefined;
  publicationMinMargin: string | number | null | undefined;
}): { price: number; floored: boolean; infeasible: boolean; floorPct: number } {
  const {
    adjustedPrice, cellPriceWasManual, pricingMode, totalProductCost,
    packaging, shipping, txFee, productMinMargin, publicationMinMargin,
  } = params;

  if (cellPriceWasManual) {
    return { price: adjustedPrice, floored: false, infeasible: false, floorPct: 0 };
  }
  if (pricingMode === "blPrice") {
    return { price: adjustedPrice, floored: false, infeasible: false, floorPct: 0 };
  }
  if (totalProductCost <= 0) {
    return { price: adjustedPrice, floored: false, infeasible: false, floorPct: 0 };
  }

  const pmm = Number(productMinMargin ?? 0);
  const pubmm = Number(publicationMinMargin ?? 0);
  const productFloor = Number.isFinite(pmm) && pmm > 0 ? pmm : 0;
  const pubFloor = Number.isFinite(pubmm) && pubmm > 0 ? pubmm : 0;
  const floor = Math.max(productFloor, pubFloor);

  if (floor <= 0) {
    return { price: adjustedPrice, floored: false, infeasible: false, floorPct: 0 };
  }

  const { rate, fixed } = shopeeCommission(adjustedPrice);
  const platformCost = adjustedPrice * (rate + txFee / 100) + fixed + packaging + shipping;
  const curMargin = adjustedPrice > 0
    ? ((adjustedPrice - totalProductCost - platformCost) / adjustedPrice) * 100
    : -Infinity;

  if (curMargin >= floor) {
    return { price: adjustedPrice, floored: false, infeasible: false, floorPct: floor };
  }

  const bumped = solvePriceByMargin(totalProductCost, packaging, shipping, txFee, floor);
  if (!Number.isFinite(bumped) || bumped <= 0) {
    return { price: adjustedPrice, floored: false, infeasible: true, floorPct: floor };
  }
  if (bumped <= adjustedPrice) {
    return { price: adjustedPrice, floored: false, infeasible: false, floorPct: floor };
  }
  return { price: bumped, floored: true, infeasible: false, floorPct: floor };
}

/**
 * Helper de display: detecta se um preço MANUAL violaria o floor (margem
 * abaixo do mínimo). Usado pra mostrar badge "abaixo do mínimo" sem
 * sobrescrever o valor manual (manual sempre vence).
 *
 * Retorna `null` se: sem floor configurado, custo inválido, ou margem ok.
 */
export function describeMarginViolation(params: {
  manualPrice: number;
  totalProductCost: number;
  packaging: number;
  shipping: number;
  txFee: number;
  productMinMargin: string | number | null | undefined;
  publicationMinMargin: string | number | null | undefined;
}): { floorPct: number; curMargin: number } | null {
  const { manualPrice, totalProductCost, packaging, shipping, txFee, productMinMargin, publicationMinMargin } = params;
  if (manualPrice <= 0 || totalProductCost <= 0) return null;

  const pmm = Number(productMinMargin ?? 0);
  const pubmm = Number(publicationMinMargin ?? 0);
  const floor = Math.max(
    Number.isFinite(pmm) && pmm > 0 ? pmm : 0,
    Number.isFinite(pubmm) && pubmm > 0 ? pubmm : 0,
  );
  if (floor <= 0) return null;

  const { rate, fixed } = shopeeCommission(manualPrice);
  const platformCost = manualPrice * (rate + txFee / 100) + fixed + packaging + shipping;
  const curMargin = ((manualPrice - totalProductCost - platformCost) / manualPrice) * 100;
  if (curMargin >= floor) return null;
  return { floorPct: floor, curMargin };
}
