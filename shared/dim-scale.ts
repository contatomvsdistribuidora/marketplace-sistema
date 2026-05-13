/**
 * Escala dimensões de uma variação multiplicando pelo `qty` (fator de
 * quantidade), crescendo o LADO MAIOR primeiro até saturar em
 * INTERNAL_MAX_DIM_CM. Quando satura, passa o resto pro próximo lado.
 *
 * Usado pra estimar dimensões do pacote em variações tipo "quantidade"
 * (ex: combo 100un de saco de lixo: o pacote fica maior que o unitário).
 *
 * shared entre client (Step C do wizard multi-produto) e server
 * (motor de pricing da Fase 6.2 — pra recomputar shipping no publish).
 */

export const INTERNAL_MAX_DIM_CM = 90;
export const INTERNAL_MAX_PERIMETER_CM = 220;

export function scaleDimsLargestFirst(
  baseL: number,
  baseW: number,
  baseH: number,
  qty: number,
): { length: number; width: number; height: number; exceededPerimeter: boolean } {
  if (qty <= 1 || baseL <= 0 || baseW <= 0 || baseH <= 0) {
    return { length: baseL, width: baseW, height: baseH, exceededPerimeter: false };
  }
  const dims = [
    { key: "L", val: baseL },
    { key: "W", val: baseW },
    { key: "H", val: baseH },
  ].sort((a, b) => b.val - a.val);
  let factor = qty;
  let d0 = dims[0].val * factor;
  if (d0 <= INTERNAL_MAX_DIM_CM) {
    dims[0].val = d0;
  } else {
    const remaining = (dims[0].val * factor) / INTERNAL_MAX_DIM_CM;
    dims[0].val = INTERNAL_MAX_DIM_CM;
    let d1 = dims[1].val * remaining;
    if (d1 <= INTERNAL_MAX_DIM_CM) {
      dims[1].val = d1;
    } else {
      const remaining2 = (dims[1].val * remaining) / INTERNAL_MAX_DIM_CM;
      dims[1].val = INTERNAL_MAX_DIM_CM;
      dims[2].val = Math.min(dims[2].val * remaining2, INTERNAL_MAX_DIM_CM);
    }
  }
  const out = { length: baseL, width: baseW, height: baseH };
  for (const d of dims) {
    if (d.key === "L") out.length = parseFloat(d.val.toFixed(1));
    if (d.key === "W") out.width = parseFloat(d.val.toFixed(1));
    if (d.key === "H") out.height = parseFloat(d.val.toFixed(1));
  }
  const perimeter = out.length + out.width + out.height;
  return { ...out, exceededPerimeter: perimeter > INTERNAL_MAX_PERIMETER_CM };
}
