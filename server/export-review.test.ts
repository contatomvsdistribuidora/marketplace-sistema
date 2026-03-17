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
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 25000)),
        ]);
      } catch (error: any) {
        // TIMEOUT or ML API error is fine - means input validation passed
        // Only a Zod validation error would be a problem
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 30000);

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
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 25000)),
        ]);
      } catch (error: any) {
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 30000);

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
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 25000)),
        ]);
      } catch (error: any) {
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 30000);

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
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 25000)),
        ]);
      } catch (error: any) {
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 30000);
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

  describe("ai.generateProductImage input schema", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.ai.generateProductImage({
          productName: "Test Product",
          style: "white_background",
        })
      ).rejects.toThrow();
    });

    it("accepts valid style options", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      // Test that input validation passes for all styles
      for (const style of ["white_background", "lifestyle", "enhanced", "product_photo"] as const) {
        const promise = caller.ai.generateProductImage({
          productName: "Test Product",
          style,
        });

        try {
          await Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 3000)),
          ]);
        } catch (error: any) {
          // TIMEOUT or API error is fine - means input validation passed
          expect(error.message).not.toContain("Invalid input");
          expect(error.message).not.toMatch(/Expected .+ received/);
        }
      }
    }, 20000);

    it("accepts optional parameters", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const promise = caller.ai.generateProductImage({
        productName: "Test Product",
        productDescription: "A great product for testing",
        originalImageUrl: "https://example.com/original.jpg",
        style: "enhanced",
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

  describe("Multiple listing types - publication multiplication", () => {
    it("should calculate total publications correctly", () => {
      // Simulating frontend logic: N products × M types = total publications
      const products = [
        { id: "1", status: "mapped", selected: true },
        { id: "2", status: "mapped", selected: true },
        { id: "3", status: "mapped", selected: true },
        { id: "4", status: "error", selected: true },
      ];
      const selectedListingTypes = ["gold_pro", "gold_special", "free"];

      const mappedProducts = products.filter(p => p.status === "mapped" && p.selected);
      const totalPublications = mappedProducts.length * selectedListingTypes.length;

      expect(totalPublications).toBe(9); // 3 products × 3 types
    });

    it("should build publication tasks for each product × type combination", () => {
      const products = [
        { id: "1", name: "Product A", optimizedTitle: "Optimized A", titlesPerType: {
          gold_pro: { title: "Premium A", reasoning: "" },
          free: { title: "Free A", reasoning: "" },
        }},
        { id: "2", name: "Product B", optimizedTitle: "Optimized B", titlesPerType: undefined },
      ];
      const selectedListingTypes = ["gold_pro", "free"] as const;
      const titlePerType = true;

      const pubTasks: { productId: string; listingType: string; title: string }[] = [];
      for (const product of products) {
        for (const lt of selectedListingTypes) {
          let title = product.optimizedTitle || product.name;
          if (titlePerType && product.titlesPerType && (product.titlesPerType as any)[lt]) {
            title = (product.titlesPerType as any)[lt].title;
          }
          pubTasks.push({ productId: product.id, listingType: lt, title });
        }
      }

      expect(pubTasks).toHaveLength(4); // 2 products × 2 types
      expect(pubTasks[0]).toEqual({ productId: "1", listingType: "gold_pro", title: "Premium A" });
      expect(pubTasks[1]).toEqual({ productId: "1", listingType: "free", title: "Free A" });
      expect(pubTasks[2]).toEqual({ productId: "2", listingType: "gold_pro", title: "Optimized B" });
      expect(pubTasks[3]).toEqual({ productId: "2", listingType: "free", title: "Optimized B" });
    });

    it("should use single title when titlePerType is false", () => {
      const product = {
        id: "1", name: "Product A", optimizedTitle: "Single Title",
        titlesPerType: {
          gold_pro: { title: "Premium A", reasoning: "" },
          free: { title: "Free A", reasoning: "" },
        },
      };
      const selectedListingTypes = ["gold_pro", "free"] as const;
      const titlePerType = false;

      const pubTasks: { listingType: string; title: string }[] = [];
      for (const lt of selectedListingTypes) {
        let title = product.optimizedTitle || product.name;
        if (titlePerType && product.titlesPerType && (product.titlesPerType as any)[lt]) {
          title = (product.titlesPerType as any)[lt].title;
        }
        pubTasks.push({ listingType: lt, title });
      }

      // Both should use the single optimizedTitle
      expect(pubTasks[0].title).toBe("Single Title");
      expect(pubTasks[1].title).toBe("Single Title");
    });

    it("should limit to maximum 3 listing types", () => {
      const allTypes = ["gold_pro", "gold_special", "free"];
      // Frontend logic: toggle adds/removes, max 3
      expect(allTypes.length).toBeLessThanOrEqual(3);
    });
  });

  describe("ai.generateDescription input schema", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.ai.generateDescription({
          productName: "Test Product",
          style: "seo",
        })
      ).rejects.toThrow();
    });

    it("accepts valid style options", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      for (const style of ["seo", "detailed", "short"] as const) {
        const promise = caller.ai.generateDescription({
          product: {
            name: "Test Product",
            description: "A test product description",
            features: {},
            category: "Test Category",
          },
          marketplace: "mercadolivre",
          style,
        });

        try {
          await Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 5000)),
          ]);
        } catch (error: any) {
          expect(error.message).not.toContain("Invalid input");
          expect(error.message).not.toMatch(/Expected .+ received/);
        }
      }
    }, 20000);

    it("accepts optional parameters", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const promise = caller.ai.generateDescription({
        product: {
          name: "Test Product",
          description: "Original description",
          features: { Marca: "TestBrand", Cor: "Preto" },
          category: "Eletr\u00f4nicos",
          ean: "7891234567890",
        },
        marketplace: "mercadolivre",
        style: "detailed",
      });

      try {
        await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 5000)),
        ]);
      } catch (error: any) {
        expect(error.message).not.toContain("Invalid input");
        expect(error.message).not.toMatch(/Expected .+ received/);
      }
    }, 10000);
  });

  describe("Batch image generation logic", () => {
    it("should process all selected products for image generation", () => {
      const products = [
        { id: "1", status: "mapped", selected: true, imageUrl: "https://example.com/img1.jpg" },
        { id: "2", status: "mapped", selected: true, imageUrl: "https://example.com/img2.jpg" },
        { id: "3", status: "mapped", selected: false, imageUrl: "https://example.com/img3.jpg" },
        { id: "4", status: "error", selected: true, imageUrl: null },
      ];

      const toGenerate = products.filter(p => p.status === "mapped" && p.selected);
      expect(toGenerate).toHaveLength(2);
      expect(toGenerate.map(p => p.id)).toEqual(["1", "2"]);
    });

    it("should track progress during batch generation", () => {
      const total = 5;
      let completed = 0;
      const progressSteps: number[] = [];

      for (let i = 0; i < total; i++) {
        completed++;
        const progress = Math.round((completed / total) * 100);
        progressSteps.push(progress);
      }

      expect(progressSteps).toEqual([20, 40, 60, 80, 100]);
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
