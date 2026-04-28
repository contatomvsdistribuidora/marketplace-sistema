import type { VariationOption } from "./types";

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyOption(label = ""): VariationOption {
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
export function suggestNewName(original: string): string {
  const match = original.match(/^(.*?)\s*-\s*V(\d+)$/);
  const suffix = match ? ` - V${parseInt(match[2], 10) + 1}` : " - V2";
  const base = match ? match[1].trimEnd() : original;
  const combined = base + suffix;
  if (combined.length <= 120) return combined;
  const maxBase = Math.max(0, 120 - suffix.length);
  return base.slice(0, maxBase).trimEnd() + suffix;
}

// Abrevia nomes longos de variação para caber em 20 chars
export function truncateVariationName(name: string): string {
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
