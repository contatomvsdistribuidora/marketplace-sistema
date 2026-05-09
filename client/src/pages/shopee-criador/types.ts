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

export type PricingMode = "multiplier" | "margin" | "profit" | "blPrice";

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
  // Preco de venda no BaseLinker (mainPrice). Hidratado automatico ao
  // abrir Step 2 com produto BL. Usado pelo modo "blPrice": preco final
  // Shopee = blSalePrice × qty + frete + taxa.
  blSalePrice: string;
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
