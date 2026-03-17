import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId = 1): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: userId,
    openId: "test-user-export-history",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("exports.history", () => {
  it("returns paginated export history", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.exports.history({});

    expect(result).toHaveProperty("logs");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("totalPages");
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("pageSize");
    expect(Array.isArray(result.logs)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("filters by status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const successResult = await caller.exports.history({ status: "success" });
    const errorResult = await caller.exports.history({ status: "error" });

    // All logs in success result should have status "success"
    for (const log of successResult.logs) {
      expect(log.status).toBe("success");
    }
    // All logs in error result should have status "error"
    for (const log of errorResult.logs) {
      expect(log.status).toBe("error");
    }
  });

  it("filters by listing type", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.exports.history({ listingType: "gold_pro" });

    for (const log of result.logs) {
      expect(log.listingType).toBe("gold_pro");
    }
  });

  it("supports pagination", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const page1 = await caller.exports.history({ page: 1, pageSize: 5 });
    const page2 = await caller.exports.history({ page: 2, pageSize: 5 });

    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(5);
    expect(page1.logs.length).toBeLessThanOrEqual(5);

    if (page1.total > 5) {
      expect(page2.page).toBe(2);
      expect(page2.logs.length).toBeGreaterThan(0);
      // Ensure different results
      if (page1.logs.length > 0 && page2.logs.length > 0) {
        expect(page1.logs[0].id).not.toBe(page2.logs[0].id);
      }
    }
  });
});

describe("exports.historyStats", () => {
  it("returns export statistics", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const stats = await caller.exports.historyStats();

    expect(stats).toHaveProperty("totalExported");
    expect(stats).toHaveProperty("totalSuccess");
    expect(stats).toHaveProperty("totalError");
    expect(stats).toHaveProperty("uniqueSuccessProducts");
    expect(stats).toHaveProperty("byListingType");
    expect(stats).toHaveProperty("byStatus");
    // SQL aggregate functions may return strings from the driver
    expect(Number(stats.totalExported)).toBeGreaterThanOrEqual(0);
    expect(Number(stats.totalSuccess)).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(stats.byListingType)).toBe(true);
    expect(Array.isArray(stats.byStatus)).toBe(true);
  });
});

describe("exports.exportedProductIds", () => {
  it("returns an array of product IDs", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const ids = await caller.exports.exportedProductIds();

    expect(Array.isArray(ids)).toBe(true);
    // All elements should be strings
    for (const id of ids) {
      expect(typeof id).toBe("string");
    }
  });
});

describe("exports.exportedProductDetails", () => {
  it("returns an array of detailed export records", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const details = await caller.exports.exportedProductDetails();

    expect(Array.isArray(details)).toBe(true);
    for (const d of details) {
      expect(d).toHaveProperty("productId");
      expect(d).toHaveProperty("marketplaceId");
      expect(d).toHaveProperty("marketplaceName");
      expect(d).toHaveProperty("listingType");
      expect(typeof d.productId).toBe("string");
      expect(typeof d.marketplaceId).toBe("number");
      expect(typeof d.marketplaceName).toBe("string");
    }
  });
});

describe("exports.exportedMarketplaces", () => {
  it("returns an array of marketplace objects with id and name", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const marketplaces = await caller.exports.exportedMarketplaces();

    expect(Array.isArray(marketplaces)).toBe(true);
    for (const mp of marketplaces) {
      expect(mp).toHaveProperty("id");
      expect(mp).toHaveProperty("name");
      expect(typeof mp.id).toBe("number");
      expect(typeof mp.name).toBe("string");
    }
  });
});
