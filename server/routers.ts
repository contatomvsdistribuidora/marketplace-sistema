import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import * as baselinker from "./baselinker";
import * as aiMapper from "./ai-mapper";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ============ SETTINGS ============
  settings: router({
    getToken: protectedProcedure.query(async ({ ctx }) => {
      const token = await db.getSetting(ctx.user.id, "baselinker_token");
      return { hasToken: !!token, maskedToken: token ? `${token.substring(0, 8)}...${token.substring(token.length - 4)}` : null };
    }),

    setToken: protectedProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        // Validate token first
        const isValid = await baselinker.validateToken(input.token);
        if (!isValid) {
          throw new Error("Token inválido. Verifique se o token está correto e tente novamente.");
        }
        await db.setSetting(ctx.user.id, "baselinker_token", input.token);
        return { success: true };
      }),

    removeToken: protectedProcedure.mutation(async ({ ctx }) => {
      await db.deleteSetting(ctx.user.id, "baselinker_token");
      return { success: true };
    }),

    getInventoryId: protectedProcedure.query(async ({ ctx }) => {
      const id = await db.getSetting(ctx.user.id, "default_inventory_id");
      return { inventoryId: id ? parseInt(id) : null };
    }),

    setInventoryId: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.setSetting(ctx.user.id, "default_inventory_id", String(input.inventoryId));
        return { success: true };
      }),
  }),

  // ============ BASELINKER ============
  baselinker: router({
    getInventories: protectedProcedure.query(async ({ ctx }) => {
      const token = await db.getSetting(ctx.user.id, "baselinker_token");
      if (!token) throw new Error("Token do BaseLinker não configurado");
      return baselinker.getInventories(token);
    }),

    getTags: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        return baselinker.getInventoryTags(token, input.inventoryId);
      }),

    getCategories: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        return baselinker.getInventoryCategories(token, input.inventoryId);
      }),

    getProducts: protectedProcedure
      .input(
        z.object({
          inventoryId: z.number(),
          tagName: z.string().optional(),
          categoryId: z.number().optional(),
          page: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");

        // If filtering by tag, use the tag-aware function
        if (input.tagName) {
          return baselinker.getProductsByTag(token, input.inventoryId, input.tagName, input.page || 1);
        }

        // Otherwise, use the standard product list
        return baselinker.getInventoryProductsList(token, input.inventoryId, {
          filterCategoryId: input.categoryId,
          page: input.page,
        });
      }),

    getProductDetails: protectedProcedure
      .input(z.object({ inventoryId: z.number(), productIds: z.array(z.number()) }))
      .query(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        return baselinker.getInventoryProductsData(token, input.inventoryId, input.productIds);
      }),

    getExternalStorages: protectedProcedure.query(async ({ ctx }) => {
      const token = await db.getSetting(ctx.user.id, "baselinker_token");
      if (!token) throw new Error("Token do BaseLinker não configurado");
      return baselinker.getExternalStoragesList(token);
    }),

    // Get marketplace integrations (Mercado Livre, Amazon, Shopee, etc.)
    getIntegrations: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        const integrations = await baselinker.getInventoryIntegrations(token, input.inventoryId);
        // Also get external storages for a complete list
        const storages = await baselinker.getExternalStoragesList(token);
        return { integrations, storages };
      }),

    getExternalCategories: protectedProcedure
      .input(z.object({ storageId: z.string() }))
      .query(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        return baselinker.getExternalStorageCategories(token, input.storageId);
      }),

    // Start syncing products to database cache
    startProductSync: protectedProcedure
      .input(z.object({ inventoryId: z.number(), forceFullSync: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        // Start sync in background (don't await)
        baselinker.startProductSync(token, ctx.user.id, input.inventoryId, input.forceFullSync || false).catch(err => {
          console.error("[ProductSync] Background sync error:", err);
        });
        return { started: true };
      }),

    // Get sync progress
    getSyncProgress: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx, input }) => {
        return baselinker.getTagScanProgress(ctx.user.id, input.inventoryId);
      }),

    // Get cache sync status from DB
    getCacheSyncStatus: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx, input }) => {
        return baselinker.getCacheSyncStatus(ctx.user.id, input.inventoryId);
      }),

    // Stop an active sync
    stopSync: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        baselinker.stopProductSync(ctx.user.id, input.inventoryId);
        return { stopped: true };
      }),

    // Filter products from database cache (instant!)
    filterProducts: protectedProcedure
      .input(z.object({
        inventoryId: z.number(),
        filters: z.object({
          tagName: z.string().optional(),
          tags: z.array(z.string()).optional(),
          categoryId: z.number().optional(),
          manufacturerId: z.number().optional(),
          searchName: z.string().optional(),
          searchEan: z.string().optional(),
          searchSku: z.string().optional(),
          priceMin: z.number().optional(),
          priceMax: z.number().optional(),
          stockMin: z.number().optional(),
          stockMax: z.number().optional(),
          weightMin: z.number().optional(),
          weightMax: z.number().optional(),
        }),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        return baselinker.filterProductsFromCache(
          ctx.user.id,
          input.inventoryId,
          input.filters,
          input.page || 1,
          input.pageSize || 50
        );
      }),

    // Get cache statistics from DB
    getCacheStats: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx, input }) => {
        return baselinker.getCacheStats(ctx.user.id, input.inventoryId);
      }),

    // Get products by IDs from cache (for export page)
    getProductsByIds: protectedProcedure
      .input(z.object({
        inventoryId: z.number(),
        productIds: z.array(z.number()),
      }))
      .query(async ({ ctx, input }) => {
        return baselinker.getProductsByIdsFromCache(ctx.user.id, input.inventoryId, input.productIds);
      }),

    // Get manufacturers list
    getManufacturers: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        return baselinker.getInventoryManufacturers(token, input.inventoryId);
      }),
  }),

  // ============ MARKETPLACES ============
  marketplaces: router({
    list: protectedProcedure.query(async () => {
      return db.getMarketplaces();
    }),
  }),

  // ============ AI MAPPING ============
  ai: router({
    mapCategory: protectedProcedure
      .input(
        z.object({
          product: z.object({
            name: z.string(),
            description: z.string(),
            features: z.record(z.string(), z.string()).default({}),
            category: z.string().default(""),
            ean: z.string().optional(),
            sku: z.string().optional(),
          }),
          marketplace: z.string(),
          availableCategories: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              path: z.string().optional(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        return aiMapper.mapProductCategory(input.product, input.marketplace, input.availableCategories);
      }),

    fillAttributes: protectedProcedure
      .input(
        z.object({
          product: z.object({
            name: z.string(),
            description: z.string(),
            features: z.record(z.string(), z.string()).default({}),
            category: z.string().default(""),
          }),
          requiredAttributes: z.array(
            z.object({
              name: z.string(),
              id: z.string(),
              required: z.boolean(),
              options: z.array(z.string()).optional(),
            })
          ),
          marketplace: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        return aiMapper.fillProductAttributes(input.product, input.requiredAttributes, input.marketplace);
      }),

    analyzeProduct: protectedProcedure
      .input(
        z.object({
          product: z.object({
            name: z.string(),
            description: z.string(),
            features: z.record(z.string(), z.string()).default({}),
            category: z.string().default(""),
          }),
          marketplace: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        return aiMapper.analyzeProduct(input.product, input.marketplace);
      }),

    batchMapCategories: protectedProcedure
      .input(
        z.object({
          products: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string(),
              features: z.record(z.string(), z.string()).default({}),
              category: z.string().default(""),
            })
          ),
          marketplace: z.string(),
          availableCategories: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              path: z.string().optional(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        const results: Record<string, any> = {};
        for (const product of input.products) {
          try {
            const suggestions = await aiMapper.mapProductCategory(
              product,
              input.marketplace,
              input.availableCategories
            );
            results[product.id] = { success: true, suggestions };
          } catch (error: any) {
            results[product.id] = { success: false, error: error.message };
          }
        }
        return results;
      }),
  }),

  // ============ CATEGORY MAPPINGS ============
  mappings: router({
    list: protectedProcedure
      .input(z.object({ marketplaceId: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getCategoryMappings(ctx.user.id, input.marketplaceId);
      }),

    save: protectedProcedure
      .input(
        z.object({
          marketplaceId: z.number(),
          sourceCategory: z.string(),
          targetCategoryId: z.string(),
          targetCategoryName: z.string(),
          targetCategoryPath: z.string().optional(),
          confidence: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await db.saveCategoryMapping({
          userId: ctx.user.id,
          ...input,
        });
        return { success: true };
      }),
  }),

  // ============ EXPORT JOBS ============
  exports: router({
    create: protectedProcedure
      .input(
        z.object({
          marketplaceId: z.number(),
          totalProducts: z.number(),
          tagFilter: z.string().optional(),
          config: z.any().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const jobId = await db.createExportJob({
          userId: ctx.user.id,
          ...input,
        });
        return { jobId };
      }),

    updateStatus: protectedProcedure
      .input(
        z.object({
          jobId: z.number(),
          status: z.enum(["pending", "processing", "completed", "failed", "cancelled"]).optional(),
          processedProducts: z.number().optional(),
          successCount: z.number().optional(),
          errorCount: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const updateData: any = {};
        if (input.status) updateData.status = input.status;
        if (input.processedProducts !== undefined) updateData.processedProducts = input.processedProducts;
        if (input.successCount !== undefined) updateData.successCount = input.successCount;
        if (input.errorCount !== undefined) updateData.errorCount = input.errorCount;
        if (input.status === "processing") updateData.startedAt = new Date();
        if (input.status === "completed" || input.status === "failed") updateData.completedAt = new Date();
        await db.updateExportJob(input.jobId, updateData);
        return { success: true };
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getExportJobs(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        return db.getExportJob(input.jobId);
      }),

    logs: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        return db.getExportLogs(input.jobId);
      }),

    addLog: protectedProcedure
      .input(
        z.object({
          jobId: z.number(),
          productId: z.string(),
          productName: z.string().optional(),
          marketplaceId: z.number(),
          status: z.enum(["success", "error", "skipped", "pending"]),
          mappedCategory: z.string().optional(),
          mappedAttributes: z.any().optional(),
          errorMessage: z.string().optional(),
          errorDetails: z.any().optional(),
          baselinkerResponse: z.any().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await db.createExportLog({
          userId: ctx.user.id,
          ...input,
        });
        return { success: true };
      }),
  }),

  // ============ DASHBOARD ============
  dashboard: router({
    stats: protectedProcedure.query(async ({ ctx }) => {
      const stats = await db.getDashboardStats(ctx.user.id);
      const recentLogs = await db.getRecentLogs(ctx.user.id, 10);
      const recentJobs = await db.getExportJobs(ctx.user.id, 5);
      return { stats, recentLogs, recentJobs };
    }),
  }),
});

export type AppRouter = typeof appRouter;
