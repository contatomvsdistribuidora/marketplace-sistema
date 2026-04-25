/**
 * Tests for `shopee.publishAsNewProduct` — verifies that:
 *  - the new itemId is persisted along with shopeeItemIdLegacy on success
 *  - the local row is NOT touched when add_item fails
 *  - missing source itemId still works (legacy stays null)
 *  - re-publishing as new overwrites legacy with the *current* itemId
 *
 * Mocks ./db (drizzle chain) and ./shopee-publish (publishProductFromWizard +
 * getLogisticsChannels). DB writes are recorded so we can assert the .set() shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbResponse: { rows: any[] } = { rows: [] };
const dbWrites: Array<{ table: string; payload: any; whereId?: number }> = [];

vi.mock("./_core/env", () => ({
  ENV: { shopeePartnerId: "1", shopeePartnerKey: "k", cookieSecret: "c" },
}));

vi.mock("./db", () => {
  const updateChain = (table: string) => {
    let pendingPayload: any = null;
    return {
      set: (payload: any) => {
        pendingPayload = payload;
        return {
          where: (..._args: any[]) => {
            dbWrites.push({ table, payload: pendingPayload });
            return Promise.resolve();
          },
        };
      },
    };
  };
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(dbResponse.rows)),
    update: vi.fn(() => updateChain("shopee_products")),
    insert: vi.fn(() => ({ values: vi.fn() })),
  };
  return { db: chain, getSetting: vi.fn(), setSetting: vi.fn() };
});

const mockGetValidToken = vi.fn();
vi.mock("./shopee", () => ({
  getValidToken: (...a: any[]) => mockGetValidToken(...a),
  getItemBaseInfo: vi.fn(),
  getModelList: vi.fn(),
  getProductQualityStats: vi.fn(),
  getLocalProducts: vi.fn(),
  getProductCount: vi.fn(),
}));

const mockPublishFromWizard = vi.fn();
const mockGetLogisticsChannels = vi.fn();
vi.mock("./shopee-publish", async () => {
  const actual = await vi.importActual<any>("./shopee-publish");
  return {
    ...actual,
    publishProductFromWizard: (...a: any[]) => mockPublishFromWizard(...a),
    getLogisticsChannels: (...a: any[]) => mockGetLogisticsChannels(...a),
  };
});

async function makeCaller(userId: number) {
  const { appRouter } = await import("./routers");
  const ctx: any = {
    user: {
      id: userId, openId: `u-${userId}`, email: `u${userId}@ex.com`, name: "T",
      loginMethod: "manus", role: "user",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  };
  return appRouter.createCaller(ctx);
}

const baseInput = {
  accountId: 1,
  sourceProductId: 933,
  variationTypeName: "Quantidade",
  variations: [{ label: "1 Un", price: 29.9, stock: 100, weight: 0.5 }],
  title: "Produto Novo",
  description: "Descrição longa o bastante para passar no filtro mínimo da Shopee no teste de unidade.",
};

describe("shopee.publishAsNewProduct", () => {
  beforeEach(() => {
    dbResponse.rows = [];
    dbWrites.length = 0;
    mockGetValidToken.mockReset();
    mockPublishFromWizard.mockReset();
    mockGetLogisticsChannels.mockReset();
  });

  it("happy path: persists new itemId and stashes the previous one in shopeeItemIdLegacy", async () => {
    dbResponse.rows = [
      {
        id: 933, itemId: 23598070827, shopeeAccountId: 7, categoryId: 101208,
        itemSku: "BLO-LE22", images: ["https://example.com/le22.jpg"], imageUrl: null,
      },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockGetLogisticsChannels.mockResolvedValueOnce([{ logistics_channel_id: 90016, enabled: true }]);
    mockPublishFromWizard.mockResolvedValueOnce({
      itemId: 99999, itemUrl: "https://shopee.com.br/product/12345/99999", mode: "create", imagesUploaded: 1,
    });

    const caller = await makeCaller(1);
    const result = await caller.shopee.publishAsNewProduct(baseInput);

    expect(result.itemId).toBe(99999);
    expect(result.legacyItemId).toBe(23598070827);

    // Forced create flag should reach the underlying publishProductFromWizard.
    const args = mockPublishFromWizard.mock.calls[0][2];
    expect(args.overrideMode).toBe("create");
    expect(args.sourceItemId).toBe(23598070827);

    // DB row was rewritten with new itemId + legacy preservado.
    expect(dbWrites).toHaveLength(1);
    expect(dbWrites[0].payload).toMatchObject({
      itemId: 99999,
      shopeeItemIdLegacy: 23598070827,
      itemStatus: "NORMAL",
    });
  });

  it("does NOT touch the DB when add_item fails (publishProductFromWizard throws)", async () => {
    dbResponse.rows = [
      {
        id: 933, itemId: 23598070827, shopeeAccountId: 7, categoryId: 101208,
        itemSku: "BLO-LE22", images: ["https://example.com/le22.jpg"], imageUrl: null,
      },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockGetLogisticsChannels.mockResolvedValueOnce([]);
    mockPublishFromWizard.mockRejectedValueOnce(new Error("Shopee API [/api/v2/product/add_item]: error_param - bad attributes"));

    const caller = await makeCaller(1);
    await expect(caller.shopee.publishAsNewProduct(baseInput)).rejects.toThrow(/add_item/);
    expect(dbWrites).toHaveLength(0);
  });

  it("works when the source product has no itemId yet (legacy stays null)", async () => {
    dbResponse.rows = [
      {
        id: 50, itemId: null, shopeeAccountId: 7, categoryId: 101208,
        itemSku: null, images: ["https://example.com/x.jpg"], imageUrl: null,
      },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockGetLogisticsChannels.mockResolvedValueOnce([]);
    mockPublishFromWizard.mockResolvedValueOnce({
      itemId: 12345, itemUrl: "https://shopee.com.br/product/12345/12345", mode: "create", imagesUploaded: 1,
    });

    const caller = await makeCaller(1);
    const result = await caller.shopee.publishAsNewProduct({ ...baseInput, sourceProductId: 50 });

    expect(result.legacyItemId).toBeNull();
    expect(dbWrites[0].payload).toMatchObject({ itemId: 12345, shopeeItemIdLegacy: null });
  });

  it("re-publishing as new overwrites legacy with the *current* itemId (not the original)", async () => {
    // Simulates a product that already has a legacy from a prior publishAsNew.
    // The current itemId becomes the new legacy; the old legacy is dropped.
    dbResponse.rows = [
      {
        id: 933, itemId: 99999 /* current */, shopeeItemIdLegacy: 23598070827 /* original */,
        shopeeAccountId: 7, categoryId: 101208,
        itemSku: "BLO-LE22-V1", images: ["https://example.com/v1.jpg"], imageUrl: null,
      },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockGetLogisticsChannels.mockResolvedValueOnce([]);
    mockPublishFromWizard.mockResolvedValueOnce({
      itemId: 11111, itemUrl: "https://shopee.com.br/product/12345/11111", mode: "create", imagesUploaded: 1,
    });

    const caller = await makeCaller(1);
    const result = await caller.shopee.publishAsNewProduct(baseInput);

    expect(result.itemId).toBe(11111);
    expect(result.legacyItemId).toBe(99999); // most-recent previous, not 23598070827
    expect(dbWrites[0].payload).toMatchObject({
      itemId: 11111,
      shopeeItemIdLegacy: 99999,
    });
  });
});
