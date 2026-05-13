// Shopee Brazil 2026 commission tiers (taxa % + valor fixo)

export function shopeeCommission(price: number): { rate: number; fixed: number } {
  if (price <   8) return { rate: 0.50, fixed:  0 };
  if (price <  80) return { rate: 0.20, fixed:  4 };
  if (price < 100) return { rate: 0.14, fixed: 16 };
  if (price < 200) return { rate: 0.14, fixed: 20 };
  return              { rate: 0.14, fixed: 26 };
}

export function shopeeCommissionLabel(price: number): string {
  if (price <   8) return "50% + R$0 (< R$8)";
  if (price <  80) return "20% + R$4 (R$8–79)";
  if (price < 100) return "14% + R$16 (R$80–99)";
  if (price < 200) return "14% + R$20 (R$100–199)";
  return              "14% + R$26 (R$200+)";
}

// Mode 2: iterate until price converges to hit desired margin %
export function solvePriceByMargin(
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
export function solvePriceByMinProfit(
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

export function extractQty(label: string): number {
  const m = label.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 1;
}
