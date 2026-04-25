/**
 * Tests for `shopee.checkExistingVariation` — verifies the read-only
 * variation enrichment used by the wizard's Etapa 4 banner + read-only
 * block. Mocks ./db (drizzle chain) and ./shopee (getValidToken,
 * getItemBaseInfo, getModelList) to run the procedure end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbResponse: { rows: any[] } = { rows: [] };

vi.mock("./_core/env", () => ({
  ENV: { shopeePartnerId: "1", shopeePartnerKey: "k", cookieSecret: "c" },
}));

vi.mock("./db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(dbResponse.rows)),
  };
  return {
    db: chain,
    getSetting: vi.fn(),
    setSetting: vi.fn(),
  };
});

const mockGetValidToken = vi.fn();
const mockGetItemBaseInfo = vi.fn();
const mockGetModelList = vi.fn();

vi.mock("./shopee", () => ({
  getValidToken: (...args: any[]) => mockGetValidToken(...args),
  getItemBaseInfo: (...args: any[]) => mockGetItemBaseInfo(...args),
  getModelList: (...args: any[]) => mockGetModelList(...args),
  getProductQualityStats: vi.fn(),
  getLocalProducts: vi.fn(),
  getProductCount: vi.fn(),
}));

async function makeCaller(userId: number) {
  const { appRouter } = await import("./routers");
  const ctx: any = {
    user: {
      id: userId,
      openId: `u-${userId}`,
      email: `u${userId}@ex.com`,
      name: "T",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  };
  return appRouter.createCaller(ctx);
}

describe("shopee.checkExistingVariation", () => {
  beforeEach(() => {
    dbResponse.rows = [];
    mockGetValidToken.mockReset();
    mockGetItemBaseInfo.mockReset();
    mockGetModelList.mockReset();
  });

  it("enriches with models[] when get_model_list succeeds", async () => {
    dbResponse.rows = [
      { product: { id: 933, itemId: 23598070827, shopeeAccountId: 7 }, accountId: 7 },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockGetItemBaseInfo.mockResolvedValueOnce([
      {
        item_id: 23598070827,
        has_model: true,
        tier_variation: [
          {
            name: "Cor",
            option_list: [
              { option: "Vermelho", image: { image_url: "https://example.com/red.jpg" } },
            ],
          },
        ],
      },
    ]);
    mockGetModelList.mockResolvedValueOnce([
      {
        model_id: 999001,
        model_sku: "BLO-LE22",
        tier_index: [0],
        price_info: [{ original_price: 35.0, current_price: 29.9 }],
        stock_info_v2: {
          summary_info: { total_available_stock: 986 },
          seller_stock: [{ stock: 986 }],
        },
      },
    ]);

    const caller = await makeCaller(1);
    const result = await caller.shopee.checkExistingVariation({ productId: 933 });

    expect(result.hasVariation).toBe(true);
    if (result.hasVariation === true) {
      expect(result.itemId).toBe(23598070827);
      expect(result.tierVariation).toHaveLength(1);
      expect(result.tierVariation[0]).toMatchObject({ name: "Cor" });
      expect(result.tierVariation[0].optionList[0]).toMatchObject({
        option: "Vermelho",
        image: "https://example.com/red.jpg",
      });
      expect(result.modelCount).toBe(1);
      expect(result.models).toHaveLength(1);
      expect(result.models[0]).toMatchObject({
        modelId: 999001,
        modelSku: "BLO-LE22",
        modelName: "Vermelho",
        currentPrice: 29.9,
        originalPrice: 35.0,
        currentStock: 986,
      });
    }
  });

  it("fail-soft: tier names returned + models=[] when get_model_list errors", async () => {
    dbResponse.rows = [
      { product: { id: 100, itemId: 1, shopeeAccountId: 7 }, accountId: 7 },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockGetItemBaseInfo.mockResolvedValueOnce([
      {
        item_id: 1,
        has_model: true,
        tier_variation: [{ name: "Cor", option_list: [{ option: "Azul" }] }],
      },
    ]);
    mockGetModelList.mockRejectedValueOnce(new Error("Shopee get_model_list failed: model_list_error - permission denied"));

    const caller = await makeCaller(1);
    const result = await caller.shopee.checkExistingVariation({ productId: 100 });

    expect(result.hasVariation).toBe(true);
    if (result.hasVariation === true) {
      expect(result.tierVariation[0].name).toBe("Cor");
      expect(result.tierVariation[0].optionList).toEqual([{ option: "Azul", image: null }]);
      expect(result.models).toEqual([]);
      // Falls back to headline option count when the authoritative model list is unavailable.
      expect(result.modelCount).toBe(1);
    }
  });

  it("falls back to display_name / original_name when tier.name is empty (parser fix for LE22-style payload)", async () => {
    dbResponse.rows = [
      { product: { id: 933, itemId: 23598070827, shopeeAccountId: 7 }, accountId: 7 },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockGetItemBaseInfo.mockResolvedValueOnce([
      {
        item_id: 23598070827,
        has_model: true,
        // Shopee's response sometimes leaves `name` empty and puts the
        // localized name in `display_name`. Same for options. The wizard
        // banner used to display "Variação 0" because of this.
        tier_variation: [
          {
            name: "",
            display_name: "Cor",
            option_list: [
              { option: "", display_option: "Vermelho" },
            ],
          },
        ],
      },
    ]);
    mockGetModelList.mockResolvedValueOnce([]);

    const caller = await makeCaller(1);
    const result = await caller.shopee.checkExistingVariation({ productId: 933 });

    expect(result.hasVariation).toBe(true);
    if (result.hasVariation === true) {
      expect(result.tierVariation[0].name).toBe("Cor");
      expect(result.tierVariation[0].optionList[0].option).toBe("Vermelho");
    }
  });

  it("returns hasVariation=false when has_model is false and tier_variation is empty", async () => {
    dbResponse.rows = [
      { product: { id: 50, itemId: 50, shopeeAccountId: 7 }, accountId: 7 },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockGetItemBaseInfo.mockResolvedValueOnce([
      { item_id: 50, has_model: false, tier_variation: [] },
    ]);

    const caller = await makeCaller(1);
    const result = await caller.shopee.checkExistingVariation({ productId: 50 });

    expect(result.hasVariation).toBe(false);
    expect(mockGetModelList).not.toHaveBeenCalled();
  });
});
