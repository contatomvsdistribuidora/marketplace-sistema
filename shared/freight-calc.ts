export type FreightTier = { maxWeight: number; cost: number };
export type SubsidyTier = { maxPrice: number; subsidy: number };

export const DEFAULT_FREIGHT_TABLE: FreightTier[] = [
  { maxWeight: 0.5,  cost: 14 },
  { maxWeight: 1,    cost: 17 },
  { maxWeight: 2,    cost: 22 },
  { maxWeight: 5,    cost: 28 },
  { maxWeight: 10,   cost: 38 },
  { maxWeight: 20,   cost: 55 },
  { maxWeight: 30,   cost: 75 },
];

export const DEFAULT_SUBSIDY_TABLE: SubsidyTier[] = [
  { maxPrice: 79.99,  subsidy: 20 },
  { maxPrice: 99.99,  subsidy: 25 },
  { maxPrice: 199.99, subsidy: 30 },
  { maxPrice: Infinity, subsidy: 40 },
];

// Peso volumétrico Shopee = (L × W × H) / 6000
export function calculateBillableWeight(weightKg: number, lengthCm: number, widthCm: number, heightCm: number): number {
  const volWeight = (lengthCm * widthCm * heightCm) / 6000;
  return Math.max(weightKg, volWeight);
}

// Lookup faixa de frete pelo peso cobrável
export function lookupFreightCost(billableWeight: number, table: FreightTier[]): number {
  const sorted = [...table].sort((a, b) => a.maxWeight - b.maxWeight);
  for (const tier of sorted) {
    if (billableWeight <= tier.maxWeight) return tier.cost;
  }
  return sorted[sorted.length - 1]?.cost ?? 0;
}

// Lookup subsídio Shopee pelo preço de venda
export function lookupSubsidy(salePrice: number, table: SubsidyTier[]): number {
  const sorted = [...table].sort((a, b) => a.maxPrice - b.maxPrice);
  for (const tier of sorted) {
    if (salePrice <= tier.maxPrice) return tier.subsidy;
  }
  return sorted[sorted.length - 1]?.subsidy ?? 0;
}

// Custo final de frete pro vendedor (após subsídio Shopee)
export function calculateSellerFreightCost(
  weightKg: number,
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  salePrice: number,
  freightTable: FreightTier[] = DEFAULT_FREIGHT_TABLE,
  subsidyTable: SubsidyTier[] = DEFAULT_SUBSIDY_TABLE,
): { billableWeight: number; freightReal: number; subsidy: number; sellerCost: number } {
  const billableWeight = calculateBillableWeight(weightKg, lengthCm, widthCm, heightCm);
  const freightReal = lookupFreightCost(billableWeight, freightTable);
  const subsidy = lookupSubsidy(salePrice, subsidyTable);
  const sellerCost = Math.max(0, freightReal - subsidy);
  return { billableWeight, freightReal, subsidy, sellerCost };
}
