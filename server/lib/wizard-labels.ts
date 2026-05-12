/**
 * Extrai labels ricos do wizard state para a 2a tier_variation Shopee.
 *
 * Prefere `optionDetailsMatrix[0][i].label` (texto rico editado no Step C / IA).
 * Faz fallback pra `optionLabels[i]` (texto cru do Step B) quando a celula
 * da matriz nao tem label preenchido — cobre listagens legadas e edits parciais.
 *
 * A ordem do retorno bate com a ordem das colunas da matriz (optIdx), o que
 * mantem alinhamento com `ws.optionDetailsMatrix[productIdx][optIdx]` usado
 * downstream pra preco/stock/sku.
 */
export function getRichOptionLabels(ws: any): string[] {
  const matrixRow0 = Array.isArray(ws?.optionDetailsMatrix?.[0])
    ? ws.optionDetailsMatrix[0]
    : null;
  const fallback: string[] = Array.isArray(ws?.optionLabels)
    ? ws.optionLabels
    : [];

  if (matrixRow0) {
    return matrixRow0
      .map((cell: any, i: number) => {
        const rich = String(cell?.label ?? "").trim();
        if (rich) return rich;
        const cru = String(fallback[i] ?? "").trim();
        return cru;
      })
      .filter((l: string) => l.length > 0);
  }

  return fallback
    .filter((l: any) => typeof l === "string" && l.trim())
    .map((l: string) => l.trim());
}
