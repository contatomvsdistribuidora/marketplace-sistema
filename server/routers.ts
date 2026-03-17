import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import * as baselinker from "./baselinker";
import * as aiMapper from "./ai-mapper";
import * as ml from "./mercadolivre";
import * as localAuth from "./local-auth";
import * as tiktok from "./tiktokshop";
import * as mlCat from "./ml-categories";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    // Local email/password registration
    register: publicProcedure
      .input(z.object({
        email: z.string().email("Email inválido"),
        password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
        name: z.string().min(1, "Nome é obrigatório"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { user, sessionToken } = await localAuth.registerUser(
          input.email,
          input.password,
          input.name
        );
        // Set session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: user.id, name: user.name, email: user.email } };
      }),

    // Local email/password login
    login: publicProcedure
      .input(z.object({
        email: z.string().email("Email inválido"),
        password: z.string().min(1, "Senha é obrigatória"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { user, sessionToken } = await localAuth.loginUser(
          input.email,
          input.password
        );
        // Set session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true, user: { id: user.id, name: user.name, email: user.email } };
      }),

    // Change password (requires authentication)
    changePassword: protectedProcedure
      .input(z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(6, "Nova senha deve ter no mínimo 6 caracteres"),
      }))
      .mutation(async ({ ctx, input }) => {
        return localAuth.changePassword(ctx.user.id, input.currentPassword, input.newPassword);
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

    // Get ALL marketplace accounts (Mercado Livre, Amazon, Shopee, etc.)
    // Uses getOrderSources which returns all connected marketplace accounts
    getIntegrations: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        const sources = await baselinker.getOrderSources(token);
        const accounts = baselinker.parseOrderSourcesToAccounts(sources);
        return { accounts, rawSources: sources };
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
    // Get available text field keys for a given inventory (debug/validation)
    getAvailableTextFieldKeys: protectedProcedure
      .input(z.object({ inventoryId: z.number() }))
      .query(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");
        return baselinker.getInventoryAvailableTextFieldKeys(token, input.inventoryId);
      }),

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

    // Get product IDs and mapped data from a job for re-export
    getJobProducts: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        const products = await db.getExportLogProductIds(input.jobId);
        const job = await db.getExportJob(input.jobId);
        return {
          products,
          jobMarketplaceId: job?.marketplaceId || null,
          jobConfig: job?.config as any || null,
        };
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

    // REAL EXPORT: Update product in BaseLinker catalog with marketplace-specific data
    exportProduct: protectedProcedure
      .input(
        z.object({
          inventoryId: z.number(),
          productId: z.string(),
          name: z.string(),
          description: z.string(),
          features: z.record(z.string(), z.string()).optional(),
          ean: z.string().optional(),
          sku: z.string().optional(),
          price: z.number().optional(),
          stock: z.number().optional(),
          images: z.record(z.string(), z.string()).optional(),
          marketplaceType: z.string(), // e.g. "melibr"
          accountId: z.string(), // e.g. "16544"
          jobId: z.number(),
          marketplaceId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker n\u00e3o configurado");

        const result = await baselinker.exportProductToMarketplace(
          token,
          input.inventoryId,
          {
            productId: input.productId,
            name: input.name,
            description: input.description,
            features: (input.features || {}) as Record<string, string>,
            ean: input.ean,
            sku: input.sku,
            price: input.price,
            stock: input.stock,
            images: input.images as Record<string, string> | undefined,
          },
          input.marketplaceType,
          input.accountId,
        );

        // Log the result
        await db.createExportLog({
          userId: ctx.user.id,
          jobId: input.jobId,
          productId: input.productId,
          productName: input.name,
          marketplaceId: input.marketplaceId,
          status: result.success ? "success" : "error",
          errorMessage: result.error,
          baselinkerResponse: result,
        });

        return result;
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

  // ============ MERCADO LIVRE (DIRECT API) ============
  ml: router({
    // Get connected ML accounts
    accounts: protectedProcedure.query(async ({ ctx }) => {
      return ml.getAccounts(ctx.user.id);
    }),

    // Get auth URL for connecting a new ML account
    getAuthUrl: protectedProcedure
      .input(z.object({ origin: z.string() }))
      .mutation(async ({ ctx, input }) => {
        // Always use the production domain for redirect_uri to match ML app configuration
        const productionDomain = "https://blmarketexp-nqnujejx.manus.space";
        const redirectUri = `${productionDomain}/api/ml/callback`;
        const state = Buffer.from(
          JSON.stringify({ userId: ctx.user.id, returnPath: "/ml-accounts", origin: input.origin })
        ).toString("base64");
        const authUrl = ml.getAuthorizationUrl(redirectUri, state);
        return { authUrl };
      }),

    // Disconnect an ML account
    disconnect: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return ml.disconnectAccount(ctx.user.id, input.accountId);
      }),

    // Delete an ML account permanently
    deleteAccount: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return ml.deleteAccount(ctx.user.id, input.accountId);
      }),

    // Predict category for a product name
    predictCategory: protectedProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        return ml.predictCategory(input.query);
      }),

    // Get category attributes
    getCategoryAttributes: protectedProcedure
      .input(z.object({ categoryId: z.string() }))
      .query(async ({ input }) => {
        return ml.getCategoryAttributes(input.categoryId);
      }),

    // Get category info
    getCategoryInfo: protectedProcedure
      .input(z.object({ categoryId: z.string() }))
      .query(async ({ input }) => {
        return ml.getCategoryInfo(input.categoryId);
      }),

    // Publish a product directly to ML
    publishProduct: protectedProcedure
      .input(
        z.object({
          accountId: z.number(),
          productId: z.string(),
          name: z.string(),
          description: z.string().optional(),
          price: z.number(),
          stock: z.number(),
          ean: z.string().optional(),
          sku: z.string().optional(),
          brand: z.string().optional(),
          images: z.array(z.string()).optional(),
          features: z.record(z.string(), z.string()).optional(),
          categoryId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return ml.publishProduct(ctx.user.id, input.accountId, {
          productId: input.productId,
          name: input.name,
          description: input.description,
          price: input.price,
          stock: input.stock,
          ean: input.ean,
          sku: input.sku,
          brand: input.brand,
          images: input.images,
          features: input.features,
          categoryId: input.categoryId,
        });
      }),

    // Batch publish multiple products
    batchPublish: protectedProcedure
      .input(
        z.object({
          accountId: z.number(),
          products: z.array(
            z.object({
              productId: z.string(),
              name: z.string(),
              description: z.string().optional(),
              price: z.number(),
              stock: z.number(),
              ean: z.string().optional(),
              sku: z.string().optional(),
              brand: z.string().optional(),
              images: z.array(z.string()).optional(),
              features: z.record(z.string(), z.string()).optional(),
              categoryId: z.string().optional(),
            })
          ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const results = [];
        for (const product of input.products) {
          const result = await ml.publishProduct(ctx.user.id, input.accountId, {
            productId: product.productId,
            name: product.name,
            description: product.description,
            price: product.price,
            stock: product.stock,
            ean: product.ean,
            sku: product.sku,
            brand: product.brand,
            images: product.images,
            features: product.features,
            categoryId: product.categoryId,
          });
          results.push(result);
          // Small delay between requests to avoid rate limiting
          await new Promise((r) => setTimeout(r, 500));
        }
        return { results, total: results.length, success: results.filter((r) => r.success).length };
      }),

    // Get listings created through our system
    listings: protectedProcedure
      .input(z.object({ accountId: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return ml.getListings(ctx.user.id, input?.accountId);
      }),

    // Get seller items from ML API
    sellerItems: protectedProcedure
      .input(z.object({ accountId: z.number(), status: z.string().optional() }))
      .query(async ({ input }) => {
        return ml.getSellerItems(input.accountId, input.status);
      }),

    // ============ CATEGORIES (LOCAL DB) ============
    
    // Start background sync of ML categories
    syncCategories: protectedProcedure
      .mutation(async () => {
        const count = await mlCat.getCategoryCount();
        if (count > 0) {
          return { started: false, message: `${count} categorias já sincronizadas. Use Re-sincronizar para atualizar.` };
        }
        return mlCat.startBackgroundSync();
      }),

    // Force re-sync all categories
    forceSyncCategories: protectedProcedure
      .mutation(async () => {
        return mlCat.startBackgroundSync(true);
      }),

    // Get sync status (for polling)
    syncStatus: protectedProcedure
      .query(async () => {
        return mlCat.getSyncStatus();
      }),

    // Get category count
    categoryCount: protectedProcedure
      .query(async () => {
        return { count: await mlCat.getCategoryCount() };
      }),

    // Search categories by name
    searchCategories: protectedProcedure
      .input(z.object({ query: z.string(), leafOnly: z.boolean().optional(), limit: z.number().optional() }))
      .query(async ({ input }) => {
        if (input.leafOnly) {
          return mlCat.searchLeafCategories(input.query, input.limit || 20);
        }
        return mlCat.searchCategories(input.query, input.limit || 20);
      }),

    // Get children of a category
    categoryChildren: protectedProcedure
      .input(z.object({ parentId: z.string() }))
      .query(async ({ input }) => {
        return mlCat.getCategoryChildren(input.parentId);
      }),

    // Get root categories
    rootCategories: protectedProcedure
      .query(async () => {
        return mlCat.getRootCategories();
      }),

    // Validate a category ID
    validateCategory: protectedProcedure
      .input(z.object({ categoryId: z.string() }))
      .query(async ({ input }) => {
        const cat = await mlCat.getLocalCategoryInfo(input.categoryId);
        return { valid: !!cat, category: cat };
      }),

    // Find best category for a product (uses domain_discovery + local DB)
    findBestCategory: protectedProcedure
      .input(z.object({ productName: z.string() }))
      .mutation(async ({ input }) => {
        return mlCat.findBestCategory(input.productName);
      }),

    // Fill attributes with AI
    fillAttributes: protectedProcedure
      .input(
        z.object({
          product: z.object({
            name: z.string(),
            description: z.string().optional(),
            ean: z.string().optional(),
            sku: z.string().optional(),
            brand: z.string().optional(),
            features: z.record(z.string(), z.string()).optional(),
          }),
          requiredAttributes: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              type: z.string(),
              values: z.array(z.object({ id: z.string(), name: z.string() })),
              required: z.boolean(),
              allowCustomValue: z.boolean(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        return ml.fillAttributesWithAI(input.product, input.requiredAttributes);
      }),
  }),

  // ============ AGENT ============
  agent: router({
    // Add products to the agent's processing queue
    enqueue: protectedProcedure
      .input(
        z.object({
          jobId: z.number(),
          products: z.array(
            z.object({
              productId: z.string(),
              productName: z.string().optional(),
              sku: z.string().optional(),
              ean: z.string().optional(),
              price: z.string().optional(),
              stock: z.number().optional(),
              imageUrl: z.string().optional(),
              description: z.string().optional(),
              mappedCategory: z.string().optional(),
              mappedAttributes: z.any().optional(),
            })
          ),
          marketplaceType: z.string(),
          accountId: z.string(),
          accountName: z.string().optional(),
          inventoryId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const items = input.products.map((p) => ({
          userId: ctx.user.id,
          jobId: input.jobId,
          productId: p.productId,
          productName: p.productName || null,
          sku: p.sku || null,
          ean: p.ean || null,
          price: p.price || null,
          stock: p.stock || 0,
          imageUrl: p.imageUrl || null,
          description: p.description || null,
          mappedCategory: p.mappedCategory || null,
          mappedAttributes: p.mappedAttributes || null,
          marketplaceType: input.marketplaceType,
          accountId: input.accountId,
          accountName: input.accountName || null,
          inventoryId: input.inventoryId,
        }));
        const ids = await db.addToAgentQueue(items);
        return { queuedCount: ids.length, ids };
      }),

    // Get queue items for a job or all
    queue: protectedProcedure
      .input(
        z.object({
          jobId: z.number().optional(),
          status: z.string().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        return db.getAgentQueue(ctx.user.id, input?.jobId, input?.status);
      }),

    // Get queue stats
    queueStats: protectedProcedure
      .input(z.object({ jobId: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return db.getAgentQueueStats(ctx.user.id, input?.jobId);
      }),

    // Get agent actions/log
    actions: protectedProcedure
      .input(
        z.object({
          jobId: z.number().optional(),
          limit: z.number().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        return db.getAgentActions(ctx.user.id, input?.jobId, input?.limit || 50);
      }),

    // Get latest screenshot
    latestScreenshot: protectedProcedure.query(async ({ ctx }) => {
      return db.getLatestScreenshot(ctx.user.id);
    }),

    // Update queue item status (used by agent processing)
    updateQueueItem: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["waiting", "processing", "completed", "failed", "skipped"]),
          errorMessage: z.string().optional(),
          screenshotUrl: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await db.updateAgentQueueItem(input.id, {
          status: input.status,
          errorMessage: input.errorMessage,
          screenshotUrl: input.screenshotUrl,
          processedAt: input.status !== "waiting" ? new Date() : undefined,
        });
        return { success: true };
      }),

    // Add an action log entry
    addAction: protectedProcedure
      .input(
        z.object({
          jobId: z.number().optional(),
          queueItemId: z.number().optional(),
          actionType: z.enum(["navigate", "click", "type", "select", "screenshot", "wait", "success", "error", "info"]),
          description: z.string(),
          screenshotUrl: z.string().optional(),
          metadata: z.any().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.addAgentAction({
          userId: ctx.user.id,
          jobId: input.jobId,
          queueItemId: input.queueItemId,
          actionType: input.actionType,
          description: input.description,
          screenshotUrl: input.screenshotUrl || null,
          metadata: input.metadata || null,
        });
        return { id };
      }),
  }),

  // ============ TIKTOK SHOP ============
  tiktok: router({
    // Get authorization URL
    getAuthUrl: protectedProcedure
      .input(z.object({ region: z.enum(["US", "GLOBAL"]).optional() }))
      .query(({ ctx, input }) => {
        const state = Buffer.from(JSON.stringify({ userId: ctx.user.id })).toString("base64");
        const url = tiktok.getAuthorizationUrl(state, input.region || "GLOBAL");
        return { url };
      }),

    // List connected accounts
    accounts: protectedProcedure.query(async ({ ctx }) => {
      return tiktok.getUserTiktokAccounts(ctx.user.id);
    }),

    // Disconnect account
    disconnect: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await tiktok.disconnectTiktokAccount(ctx.user.id, input.accountId);
        return { success: true };
      }),

    // Get authorized shops for an account
    getShops: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .query(async ({ input }) => {
        const token = await tiktok.getValidToken(input.accountId);
        return tiktok.getAuthorizedShops(token);
      }),

    // Get categories for a shop
    getCategories: protectedProcedure
      .input(z.object({ accountId: z.number(), shopCipher: z.string() }))
      .query(async ({ input }) => {
        const token = await tiktok.getValidToken(input.accountId);
        return tiktok.getCategories(token, input.shopCipher);
      }),

    // Recommend category for a product
    recommendCategory: protectedProcedure
      .input(z.object({ accountId: z.number(), shopCipher: z.string(), productTitle: z.string() }))
      .query(async ({ input }) => {
        const token = await tiktok.getValidToken(input.accountId);
        return tiktok.recommendCategory(token, input.shopCipher, input.productTitle);
      }),

    // Get category attributes
    getCategoryAttributes: protectedProcedure
      .input(z.object({ accountId: z.number(), shopCipher: z.string(), categoryId: z.string() }))
      .query(async ({ input }) => {
        const token = await tiktok.getValidToken(input.accountId);
        return tiktok.getCategoryAttributes(token, input.shopCipher, input.categoryId);
      }),

    // Upload product image
    uploadImage: protectedProcedure
      .input(z.object({ accountId: z.number(), shopCipher: z.string(), imageUrl: z.string() }))
      .mutation(async ({ input }) => {
        const token = await tiktok.getValidToken(input.accountId);
        return tiktok.uploadProductImage(token, input.shopCipher, input.imageUrl);
      }),

    // Create product on TikTok Shop
    createProduct: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        shopCipher: z.string(),
        product: z.object({
          title: z.string(),
          description: z.string(),
          categoryId: z.string(),
          brandId: z.string().optional(),
          images: z.array(z.string()),
          skus: z.array(z.object({
            sellerSku: z.string(),
            price: z.string(),
            stock: z.number(),
            salesAttributes: z.array(z.object({
              attributeId: z.string(),
              valueId: z.string().optional(),
              customValue: z.string().optional(),
            })).optional(),
          })),
          productAttributes: z.array(z.object({
            attributeId: z.string(),
            attributeValues: z.array(z.object({
              valueId: z.string().optional(),
              valueName: z.string().optional(),
            })),
          })).optional(),
          packageWeight: z.string().optional(),
          packageLength: z.number().optional(),
          packageWidth: z.number().optional(),
          packageHeight: z.number().optional(),
        }),
        // BaseLinker product reference
        blProductId: z.string(),
        blProductName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const token = await tiktok.getValidToken(input.accountId);
        const result = await tiktok.createProduct(token, input.shopCipher, input.product);
        return { success: true, productId: result.productId, skuIds: result.skuIds };
      }),
  }),
});

export type AppRouter = typeof appRouter;
