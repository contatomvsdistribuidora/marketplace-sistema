/**
 * Focused test for `shopee.getProductById` — verifies the ownership guard
 * (user can't fetch another user's product) and the happy path.
 *
 * Mocks the `./db` module so the router runs against a scripted select
 * chain instead of a live MySQL. Keeps the test isolated from the rest of
 * routers.test.ts (which assumes a real DB for many procedures and fails
 * in CI environments without DATABASE_URL).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Programmable response for the .limit(1) call at the end of the select chain.
const dbResponse: { rows: any[] } = { rows: [] };

vi.mock("./_core/env", () => ({
  ENV: {
    shopeePartnerId: "1",
    shopeePartnerKey: "k",
    cookieSecret: "c",
  },
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

// Defer router import so the mocks above take effect first.
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

describe("shopee.getProductById", () => {
  beforeEach(() => {
    dbResponse.rows = [];
  });

  it("returns the product when it belongs to the current user", async () => {
    dbResponse.rows = [
      {
        product: {
          id: 42,
          itemName: "Produto Teste",
          shopeeAccountId: 7,
          categoryId: 101220,
        },
        accountUserId: 1,
      },
    ];
    const caller = await makeCaller(1);
    const result = await caller.shopee.getProductById({ productId: 42 });
    expect(result).toMatchObject({ id: 42, itemName: "Produto Teste", shopeeAccountId: 7 });
  });

  it("throws a generic 'not found' error when the row isn't visible to this user", async () => {
    // Simulates the ownership filter excluding the row (product exists but
    // belongs to another user). Message must match "Produto não encontrado"
    // identically in both cases to avoid leaking existence.
    dbResponse.rows = [];
    const caller = await makeCaller(2);
    await expect(caller.shopee.getProductById({ productId: 42 })).rejects.toThrow(/Produto não encontrado/);
  });

  it("throws the same error when the productId simply does not exist", async () => {
    dbResponse.rows = [];
    const caller = await makeCaller(1);
    await expect(caller.shopee.getProductById({ productId: 999 })).rejects.toThrow(/Produto não encontrado/);
  });
});
