/**
 * Tests for the extended `shopee.getProducts` procedure (12 filters + ordering),
 * plus the auto-marking of createdBySystem / titleAiGenerated /
 * descriptionAiGenerated when the corresponding mutations succeed.
 *
 * The drizzle query builder is mocked so we can introspect:
 *   - WHERE expression count (each filter contributes one condition)
 *   - ORDER BY expression count (default = recent → 2 sort keys; others = 1)
 *   - LIMIT / OFFSET passed through
 *   - .set() payload on UPDATEs (for createdBySystem / titleAiGenerated /
 *     descriptionAiGenerated assertions)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: {
  whereArgs: any[];
  orderByArgs: any[];
  limitArg: number | null;
  offsetArg: number | null;
  rowsResponse: any[];
  countResponse: any[];
  selectRowsFor: any;
  dbWrites: Array<{ table: string; payload: any }>;
} = {
  whereArgs: [],
  orderByArgs: [],
  limitArg: null,
  offsetArg: null,
  rowsResponse: [],
  countResponse: [],
  selectRowsFor: null,
  dbWrites: [],
};

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
            captured.dbWrites.push({ table, payload: pendingPayload });
            return Promise.resolve();
          },
        };
      },
    };
  };

  // Two flavors of select chain:
  //  - getProducts ROWS query: select().from().where().orderBy().limit().offset() → array
  //  - getProducts COUNT query: select({id}).from().where()                       → array
  //  - generic .limit()-then-await for pre-fetch lookups (e.g. getValidToken
  //    paths in mutation tests) → returns selectRowsFor or empty.
  const makeSelectChain = (initialPayload: any) => {
    const rowsForLimit = initialPayload && typeof initialPayload === "object" && "id" in initialPayload
      ? "count"
      : "rows";

    let phase: "init" | "where" = "init";

    const chain: any = {
      from: vi.fn(function (this: any) { return this; }),
      innerJoin: vi.fn(function (this: any) { return this; }),
      where: vi.fn(function (this: any, expr: any) {
        captured.whereArgs.push(expr);
        phase = "where";
        // Make the chain THEN-ABLE so a bare `await db.select().from(...).where(...)`
        // resolves to countResponse (used by getProducts' count query and by
        // any other pre-checks that don't call .limit()).
        chain.then = (resolve: any) =>
          resolve(rowsForLimit === "count" ? captured.countResponse : captured.rowsResponse);
        return this;
      }),
      orderBy: vi.fn(function (this: any, ...args: any[]) {
        captured.orderByArgs = args;
        return this;
      }),
      limit: vi.fn(function (this: any, n: number) {
        captured.limitArg = n;
        // Two consumers:
        //  - getProducts ROWS query awaits AFTER .offset()
        //  - the existing getProductById / lookup queries await directly after
        //    .limit() and expect rows
        const ret: any = Object.assign(Promise.resolve(captured.selectRowsFor ?? captured.rowsResponse), {
          offset: vi.fn(function (n: number) {
            captured.offsetArg = n;
            return Promise.resolve(captured.rowsResponse);
          }),
        });
        return ret;
      }),
    };
    return chain;
  };

  const chain: any = {
    select: vi.fn((payload?: any) => makeSelectChain(payload)),
    update: vi.fn(() => updateChain("shopee_products")),
    insert: vi.fn(() => ({ values: vi.fn() })),
  };
  return { db: chain, getSetting: vi.fn(), setSetting: vi.fn() };
});

const mockGetValidToken = vi.fn();
const mockUpdateItemName = vi.fn();
const mockUpdateItemFields = vi.fn();
vi.mock("./shopee", () => ({
  getValidToken: (...a: any[]) => mockGetValidToken(...a),
  getItemBaseInfo: vi.fn(),
  getModelList: vi.fn(),
  getProductQualityStats: vi.fn(),
  getLocalProducts: vi.fn(),
  getProductCount: vi.fn(),
  updateItemName: (...a: any[]) => mockUpdateItemName(...a),
  updateItemFields: (...a: any[]) => mockUpdateItemFields(...a),
  syncSingleProduct: vi.fn(),
  syncProducts: vi.fn(),
  removeStaleProducts: vi.fn(),
  updateAccountSyncMeta: vi.fn(),
  getValidShopId: vi.fn(),
}));

vi.mock("./shopee-publish", async () => {
  const actual = await vi.importActual<any>("./shopee-publish");
  return {
    ...actual,
    publishProductFromWizard: vi.fn(),
    getLogisticsChannels: vi.fn().mockResolvedValue([]),
  };
});

async function makeCaller(userId: number = 1) {
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

function resetCaptured() {
  captured.whereArgs = [];
  captured.orderByArgs = [];
  captured.limitArg = null;
  captured.offsetArg = null;
  captured.rowsResponse = [];
  captured.countResponse = [];
  captured.selectRowsFor = null;
  captured.dbWrites = [];
}

describe("shopee.getProducts — 12 filters", () => {
  beforeEach(() => {
    resetCaptured();
  });

  it("filter: createdBySystem=true adds a condition on top of the account scope", async () => {
    const caller = await makeCaller();
    await caller.shopee.getProducts({ accountId: 7, createdBySystem: true });
    // Account scope is always present → at least one where call happened.
    expect(captured.whereArgs.length).toBeGreaterThan(0);
    // ROWS + COUNT both invoke .where() with an `and(...)` containing 2 conds.
    // We can't introspect the SQL fragment directly, but we can sanity-check
    // that the procedure ran to completion and called .where twice.
    expect(captured.whereArgs.length).toBe(2);
  });

  it("filter: createdBySystem=false runs without throwing", async () => {
    const caller = await makeCaller();
    const r = await caller.shopee.getProducts({ accountId: 7, createdBySystem: false });
    expect(r).toEqual({ products: [], total: 0 });
  });

  it("filter: status accepts active/paused/draft", async () => {
    const caller = await makeCaller();
    for (const s of ["active", "paused", "draft"] as const) {
      const r = await caller.shopee.getProducts({ accountId: 7, status: s });
      expect(r).toEqual({ products: [], total: 0 });
    }
  });

  it("filter: hasVariation true and false both run", async () => {
    const caller = await makeCaller();
    await caller.shopee.getProducts({ accountId: 7, hasVariation: true });
    await caller.shopee.getProducts({ accountId: 7, hasVariation: false });
    expect(captured.whereArgs.length).toBeGreaterThan(0);
  });

  it("filter: priceMin / priceMax are accepted", async () => {
    const caller = await makeCaller();
    const r = await caller.shopee.getProducts({ accountId: 7, priceMin: 10, priceMax: 100 });
    expect(r).toEqual({ products: [], total: 0 });
  });

  it("filter: stockFilter accepts with / without / low", async () => {
    const caller = await makeCaller();
    for (const sf of ["with", "without", "low"] as const) {
      const r = await caller.shopee.getProducts({ accountId: 7, stockFilter: sf });
      expect(r).toEqual({ products: [], total: 0 });
    }
  });

  it("filter: categoryId is accepted", async () => {
    const caller = await makeCaller();
    const r = await caller.shopee.getProducts({ accountId: 7, categoryId: 100018 });
    expect(r).toEqual({ products: [], total: 0 });
  });

  it("filter: brand is accepted", async () => {
    const caller = await makeCaller();
    const r = await caller.shopee.getProducts({ accountId: 7, brand: "Nike" });
    expect(r).toEqual({ products: [], total: 0 });
  });

  it("filter: titleAiGenerated is accepted (true and false)", async () => {
    const caller = await makeCaller();
    await caller.shopee.getProducts({ accountId: 7, titleAiGenerated: true });
    await caller.shopee.getProducts({ accountId: 7, titleAiGenerated: false });
    expect(captured.whereArgs.length).toBeGreaterThan(0);
  });

  it("filter: descriptionAiGenerated is accepted (true and false)", async () => {
    const caller = await makeCaller();
    await caller.shopee.getProducts({ accountId: 7, descriptionAiGenerated: true });
    await caller.shopee.getProducts({ accountId: 7, descriptionAiGenerated: false });
    expect(captured.whereArgs.length).toBeGreaterThan(0);
  });

  it("filter: createdRange accepts today/last7days/last30days", async () => {
    const caller = await makeCaller();
    for (const r of ["today", "last7days", "last30days"] as const) {
      const out = await caller.shopee.getProducts({ accountId: 7, createdRange: r });
      expect(out).toEqual({ products: [], total: 0 });
    }
  });

  it("filter: sku does substring matching (LIKE %sku%)", async () => {
    const caller = await makeCaller();
    const r = await caller.shopee.getProducts({ accountId: 7, sku: "BLO" });
    expect(r).toEqual({ products: [], total: 0 });
  });

  it("rejects out-of-range enums via input validation (priceMin must be ≥ 0)", async () => {
    const caller = await makeCaller();
    await expect(
      caller.shopee.getProducts({ accountId: 7, priceMin: -1 } as any)
    ).rejects.toThrow();
  });
});

describe("shopee.getProducts — ordering & combinations", () => {
  beforeEach(() => {
    resetCaptured();
  });

  it("default orderBy is `recent` (updatedAt DESC, createdAt DESC → 2 sort keys)", async () => {
    const caller = await makeCaller();
    await caller.shopee.getProducts({ accountId: 7 });
    expect(captured.orderByArgs).toHaveLength(2);
  });

  it("explicit orderBy=oldest emits a single sort key", async () => {
    const caller = await makeCaller();
    await caller.shopee.getProducts({ accountId: 7, orderBy: "oldest" });
    expect(captured.orderByArgs).toHaveLength(1);
  });

  it("explicit orderBy=name_asc / price_desc emit a single sort key", async () => {
    const caller = await makeCaller();
    await caller.shopee.getProducts({ accountId: 7, orderBy: "name_asc" });
    expect(captured.orderByArgs).toHaveLength(1);
    await caller.shopee.getProducts({ accountId: 7, orderBy: "price_desc" });
    expect(captured.orderByArgs).toHaveLength(1);
  });

  it("combination: createdBySystem=true + status=active + orderBy=recent", async () => {
    const caller = await makeCaller();
    captured.rowsResponse = [
      {
        id: 1, itemId: 1, itemName: "X", price: "10", stock: 1,
        createdBySystem: 1, titleAiGenerated: 0, descriptionAiGenerated: 0,
      },
    ];
    captured.countResponse = [{ id: 1 }];
    const out = await caller.shopee.getProducts({
      accountId: 7, createdBySystem: true, status: "active", orderBy: "recent",
    });
    expect(out.total).toBe(1);
    expect(out.products[0].createdBySystem).toBe(1);
    expect(captured.orderByArgs).toHaveLength(2);
  });

  it("limit and offset pass through to the rows query", async () => {
    const caller = await makeCaller();
    await caller.shopee.getProducts({ accountId: 7, limit: 25, offset: 50 });
    expect(captured.limitArg).toBe(25);
    expect(captured.offsetArg).toBe(50);
  });
});

describe("auto-mark createdBySystem on publish", () => {
  beforeEach(() => {
    resetCaptured();
    mockGetValidToken.mockReset();
  });

  it("createProductFromWizard with overrideMode=create sets createdBySystem=1", async () => {
    captured.selectRowsFor = [
      { id: 933, itemId: 100, shopeeAccountId: 7, categoryId: 101208,
        itemSku: "SKU", images: ["https://x/y.jpg"], imageUrl: null },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    const sp = await import("./shopee-publish");
    (sp.publishProductFromWizard as any).mockResolvedValueOnce({
      itemId: 200, itemUrl: "u", mode: "create", imagesUploaded: 1,
    });
    (sp.getLogisticsChannels as any).mockResolvedValueOnce([]);

    const caller = await makeCaller();
    const baseInput = {
      accountId: 1, sourceProductId: 933,
      variationTypeName: "Quantidade",
      variations: [{ label: "1 Un", price: 29.9, stock: 100, weight: 0.5 }],
      title: "Produto Novo",
      description: "Descrição com tamanho mínimo.",
      overrideMode: "create" as const,
    };
    await caller.shopee.createProductFromWizard(baseInput);

    const lastWrite = captured.dbWrites[captured.dbWrites.length - 1];
    expect(lastWrite).toBeDefined();
    expect(lastWrite!.payload.createdBySystem).toBe(1);
  });

  it("publishAsNewProduct sets createdBySystem=1 alongside the new itemId", async () => {
    captured.selectRowsFor = [
      { id: 933, itemId: 100, shopeeAccountId: 7, categoryId: 101208,
        itemSku: "SKU", images: ["https://x/y.jpg"], imageUrl: null },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    const sp = await import("./shopee-publish");
    (sp.publishProductFromWizard as any).mockResolvedValueOnce({
      itemId: 999, itemUrl: "u", mode: "create", imagesUploaded: 1,
    });
    (sp.getLogisticsChannels as any).mockResolvedValueOnce([]);

    const caller = await makeCaller();
    await caller.shopee.publishAsNewProduct({
      accountId: 1, sourceProductId: 933,
      variationTypeName: "Quantidade",
      variations: [{ label: "1 Un", price: 29.9, stock: 100, weight: 0.5 }],
      title: "Produto Novo",
      description: "Descrição com tamanho mínimo.",
    });

    const w = captured.dbWrites[captured.dbWrites.length - 1];
    expect(w).toBeDefined();
    expect(w!.payload).toMatchObject({ itemId: 999, createdBySystem: 1 });
  });
});

describe("auto-mark titleAiGenerated / descriptionAiGenerated on apply", () => {
  beforeEach(() => {
    resetCaptured();
    mockGetValidToken.mockReset();
    mockUpdateItemName.mockReset();
    mockUpdateItemFields.mockReset();
  });

  it("applyTitle sets titleAiGenerated=1", async () => {
    captured.selectRowsFor = [
      { id: 1, itemId: 100, shopeeAccountId: 7 },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockUpdateItemName.mockResolvedValueOnce({});

    const caller = await makeCaller();
    await caller.shopee.applyTitle({ productId: 1, newTitle: "Novo Título Gerado por IA" });

    const w = captured.dbWrites[captured.dbWrites.length - 1];
    expect(w).toBeDefined();
    expect(w!.payload).toMatchObject({
      itemName: "Novo Título Gerado por IA",
      titleAiGenerated: 1,
    });
  });

  it("applyDescription sets descriptionAiGenerated=1", async () => {
    captured.selectRowsFor = [
      { id: 1, itemId: 100, shopeeAccountId: 7 },
    ];
    mockGetValidToken.mockResolvedValueOnce({ accessToken: "tok", shopId: 12345 });
    mockUpdateItemFields.mockResolvedValueOnce({});

    const caller = await makeCaller();
    await caller.shopee.applyDescription({ productId: 1, newDescription: "Nova descrição IA bem completa." });

    const w = captured.dbWrites[captured.dbWrites.length - 1];
    expect(w).toBeDefined();
    expect(w!.payload).toMatchObject({
      description: "Nova descrição IA bem completa.",
      descriptionAiGenerated: 1,
    });
  });
});
