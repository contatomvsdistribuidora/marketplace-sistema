import { describe, it, expect, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
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

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("Export Review - ML Publish Input Validation", () => {
  describe("ml.publishProduct input schema", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.ml.publishProduct({
          accountId: 1,
          productId: "123",
          name: "Test Product",
          price: 99.9,
          stock: 10,
        })
      ).rejects.toThrow();
    });

    it("accepts listingType gold_pro", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // Validate input passes Zod schema - we race with a short timeout
      // since the ML API call may hang without a real account
      const promise = caller.ml.publishProduct({
        accountId: 999,
        productId: "test-123",
        name: "Test Product Premium",
        price: 99.9,
        stock: 10,
        listingType: "gold_pro",
        images: ["https://example.com/img1.jpg", "https://example.com/img2.jpg"],
      });

      try {
        await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 3000)),
        ]);
      } catch (error: any) {
        // TIMEOUT or ML API error is fine - means input validation passed
        // Only a Zod validation error would be a problem
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 10000);

    it("accepts listingType gold_special", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const promise = caller.ml.publishProduct({
        accountId: 999,
        productId: "test-456",
        name: "Test Product Classico",
        price: 49.9,
        stock: 5,
        listingType: "gold_special",
      });

      try {
        await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 3000)),
        ]);
      } catch (error: any) {
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 10000);

    it("accepts listingType free", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const promise = caller.ml.publishProduct({
        accountId: 999,
        productId: "test-789",
        name: "Test Product Gratis",
        price: 19.9,
        stock: 1,
        listingType: "free",
      });

      try {
        await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 3000)),
        ]);
      } catch (error: any) {
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 10000);

    it("accepts images array", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const promise = caller.ml.publishProduct({
        accountId: 999,
        productId: "test-img",
        name: "Test Product with Images",
        price: 29.9,
        stock: 3,
        images: [
          "https://example.com/cover.jpg",
          "https://example.com/photo2.jpg",
          "https://example.com/photo3.jpg",
        ],
      });

      try {
        await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 3000)),
        ]);
      } catch (error: any) {
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 10000);

    it("accepts features record", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const promise = caller.ml.publishProduct({
        accountId: 999,
        productId: "test-feat",
        name: "Test Product with Features",
        price: 59.9,
        stock: 2,
        features: {
          Marca: "TestBrand",
          Modelo: "TestModel",
          Cor: "Preto",
        },
        categoryId: "MLB1055",
        listingType: "gold_pro",
      });

      try {
        await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 3000)),
        ]);
      } catch (error: any) {
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 10000);
  });

  describe("ml.batchPublish input schema", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.ml.batchPublish({
          accountId: 1,
          products: [],
        })
      ).rejects.toThrow();
    });

    it("accepts products with listingType and images", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.ml.batchPublish({
          accountId: 999,
          products: [
            {
              productId: "p1",
              name: "Product 1",
              price: 10,
              stock: 1,
              listingType: "gold_pro",
              images: ["https://example.com/img1.jpg"],
            },
            {
              productId: "p2",
              name: "Product 2",
              price: 20,
              stock: 2,
              listingType: "free",
              images: ["https://example.com/img2.jpg", "https://example.com/img3.jpg"],
            },
          ],
        });
      } catch (error: any) {
        // Expect ML API error, not input validation error
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toContain("Expected");
      }
    });
  });

  describe("ai.batchGenerateTitles input schema", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.ai.batchGenerateTitles({
          products: [],
          marketplace: "Mercado Livre",
          style: "seo",
        })
      ).rejects.toThrow();
    });

    it("accepts valid style options", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // Test with SEO style and empty products (should return empty result)
      const result = await caller.ai.batchGenerateTitles({
        products: [],
        marketplace: "Mercado Livre",
        style: "seo",
      });
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    it("accepts custom style with instruction", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.ai.batchGenerateTitles({
        products: [],
        marketplace: "Mercado Livre",
        style: "custom",
        customInstruction: "Incluir marca e modelo",
      });
      expect(result).toBeDefined();
    });
  });

  describe("exports.create input schema", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.exports.create({
          marketplaceId: 1,
          totalProducts: 5,
        })
      ).rejects.toThrow();
    });

    it("accepts tagFilter parameter", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.exports.create({
        marketplaceId: 1,
        totalProducts: 3,
        tagFilter: "HIGIPACK",
      });

      expect(result).toHaveProperty("jobId");
      expect(typeof result.jobId).toBe("number");
    });
  });
});
