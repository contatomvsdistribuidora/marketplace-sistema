export type VariationType = "quantidade" | "tamanho" | "material" | "cor" | "personalizado";

export type WizardStep = "A" | "B" | "C" | "D";

export interface VariationOption {
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

export interface VariationGroup {
  id: string;
  type: VariationType;
  typeName: string;
  options: VariationOption[];
}

export type PricingMode = "multiplier" | "margin" | "profit";

export interface PricingGlobals {
  unitCost: string;
  batchCost: string;
  baseProductQty: string;
  packagingCost: string;
  shippingCost: string;
  transactionFee: string;
  minMarginPct: string;
  marginMultiplier: string;
  defaultDiscount: string;
  desiredMargin: string;
  minProfit: string;
  globalStock: string;
}

export interface ComputedPricing {
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
