/**
 * ⚠️ ESPELHO EXATO de server/multi-product-publish.ts:122-165
 *    (função `applyPricingAdjustment`).
 *
 *    SE MUDAR LÁ, MUDAR AQUI.
 *    Divergência = bug invisível em produção (UI mostra um valor,
 *    backend publica outro — operador valida visualmente e confia).
 *
 *    Última sincronia: commit 5cd76c7 (Fase 6.1.B — pricing ativo).
 *
 * Fórmula (idêntica ao backend):
 *   factor = publicationMultiplier / listingMultiplier
 *   finalPrice = Math.max(clientPrice × factor, 1)
 *
 * Casos onde NÃO aplica (retorna clientPrice bit-for-bit):
 *  - cellPriceWasManual === true  (operador digitou opt.price → preço literal)
 *  - publicationMultiplier null / "" / inválido / <= 0
 *  - listingMultiplier null / "" / inválido / <= 0
 *
 * Sem logs (este código roda no client a cada keystroke; backend faz log).
 */
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
 * Helper de display: indica se o ajuste foi efetivamente aplicado pra essa
 * conta (vs. mostrar preço bruto). Usado pra renderizar badge "×fator".
 *
 * Retorna `null` quando: manual, sem multiplier na pub, listing multiplier
 * inválido, OU factor === 1 (mesmo multiplier que listing — não muda nada).
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
