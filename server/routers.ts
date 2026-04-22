import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { db as sharedDb } from "./db";
import * as baselinker from "./baselinker";
import * as aiMapper from "./ai-mapper";
import * as ml from "./mercadolivre";
import * as localAuth from "./local-auth";
import * as tiktok from "./tiktokshop";
import * as mlCat from "./ml-categories";
import { generateImage } from "./_core/imageGeneration";
import * as bgWorker from "./background-worker";
import * as amazon from "./amazon";
import * as shopee from "./shopee";
import * as shopeeExport from "./shopee-export";
import * as shopeePublish from "./shopee-publish";
import * as shopeeOptimizer from "./shopee-optimizer";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user ?? null),
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

    // ── Configurações de IA ──

    getAiConfig: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      const provider = await db.getSetting(ctx.user.id, "ai_provider");
      const apiKey   = await db.getSetting(ctx.user.id, "ai_api_key");
      const activeProvider = provider || ENV.aiProvider || (
        ENV.anthropicApiKey ? "anthropic" :
        ENV.groqApiKey      ? "groq" :
        ENV.openaiApiKey    ? "openai" :
        ENV.geminiApiKey    ? "gemini" : "forge"
      );
      const maskKey = (k: string | null) =>
        k && k.length > 8 ? `${k.slice(0, 6)}${"•".repeat(Math.min(k.length - 10, 20))}${k.slice(-4)}` : null;
      return {
        activeProvider,
        savedProvider: provider || null,
        maskedApiKey:  maskKey(apiKey),
        hasKey:        !!apiKey,
        envKeys: {
          anthropic: !!ENV.anthropicApiKey,
          groq:      !!ENV.groqApiKey,
          openai:    !!ENV.openaiApiKey,
          gemini:    !!ENV.geminiApiKey,
        },
      };
    }),

    setAiConfig: protectedProcedure
      .input(z.object({
        provider: z.enum(["anthropic", "groq", "openai", "gemini", "forge"]),
        apiKey:   z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.setSetting(ctx.user.id, "ai_provider", input.provider);
        await db.setSetting(ctx.user.id, "ai_api_key",  input.apiKey);
        const { setRuntimeAiProvider } = await import("./_core/llm");
        const { resetAiProviderCache } = await import("./lib/ai-provider");
        setRuntimeAiProvider(input.provider, input.apiKey);
        resetAiProviderCache();
        return { success: true };
      }),

    testAiConnection: protectedProcedure
      .input(z.object({
        provider: z.enum(["anthropic", "groq", "openai", "gemini", "forge"]),
        apiKey:   z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const { invokeLLM } = await import("./_core/llm");
        const { ENV } = await import("./_core/env");

        // Configura temporariamente para o teste
        const { setRuntimeAiProvider } = await import("./_core/llm");
        const prevProvider = (globalThis as any).__testProvider;
        setRuntimeAiProvider(input.provider, input.apiKey);

        try {
          const result = await invokeLLM({
            messages: [{ role: "user", content: "Responda apenas: OK" }],
            maxTokens: 10,
          });
          const text = (() => {
            const c = result.choices[0]?.message?.content;
            if (typeof c === "string") return c;
            if (Array.isArray(c)) return c.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
            return "";
          })();
          return { success: true, response: text.trim() };
        } finally {
          // Restaura configuração anterior
          const saved = await import("../drizzle/schema").then(async s => {
            const { eq } = await import("drizzle-orm");
            const [p] = await (db as any).select().from(s.settings).where(eq(s.settings.settingKey, "ai_provider")).limit(1);
            const [k] = await (db as any).select().from(s.settings).where(eq(s.settings.settingKey, "ai_api_key")).limit(1);
            return { provider: p?.settingValue, key: k?.settingValue };
          }).catch(() => ({ provider: null, key: null }));
          setRuntimeAiProvider(saved.provider || ENV.aiProvider, saved.key || "");
        }
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
          searchNameMode: z.enum(["contains", "not_contains"]).optional(),
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

    generateTitle: protectedProcedure
      .input(
        z.object({
          product: z.object({
            name: z.string(),
            description: z.string().default(""),
            features: z.record(z.string(), z.string()).default({}),
            category: z.string().default(""),
            ean: z.string().optional(),
          }),
          marketplace: z.string(),
          style: z.enum(["seo", "descriptive", "short", "custom"]).default("seo"),
          customInstruction: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return aiMapper.generateOptimizedTitle(input.product, input.marketplace, input.style, input.customInstruction);
      }),

    // Batch generate titles for multiple products
    batchGenerateTitles: protectedProcedure
      .input(
        z.object({
          products: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().default(""),
              features: z.record(z.string(), z.string()).default({}),
              category: z.string().default(""),
              ean: z.string().optional(),
            })
          ),
          marketplace: z.string(),
          style: z.enum(["seo", "descriptive", "short", "custom"]).default("seo"),
          customInstruction: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const results: Record<string, { title: string; reasoning: string }> = {};
        // Process in chunks of 5 for parallel title generation
        const CHUNK_SIZE = 5;
        for (let i = 0; i < input.products.length; i += CHUNK_SIZE) {
          const chunk = input.products.slice(i, i + CHUNK_SIZE);
          const chunkResults = await Promise.all(
            chunk.map(async (product) => {
              try {
                const result = await aiMapper.generateOptimizedTitle(
                  product, input.marketplace, input.style, input.customInstruction
                );
                return { id: product.id, result };
              } catch (error: any) {
                return { id: product.id, result: { title: product.name, reasoning: `Erro: ${error.message}` } };
              }
            })
          );
          for (const { id, result } of chunkResults) {
            results[id] = result;
          }
          // Minimal delay between chunks
          if (i + CHUNK_SIZE < input.products.length) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
        return results;
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
        // Process in chunks of 5 for parallel category mapping
        const CHUNK_SIZE = 5;
        for (let i = 0; i < input.products.length; i += CHUNK_SIZE) {
          const chunk = input.products.slice(i, i + CHUNK_SIZE);
          const chunkResults = await Promise.all(
            chunk.map(async (product) => {
              try {
                const suggestions = await aiMapper.mapProductCategory(
                  product,
                  input.marketplace,
                  input.availableCategories
                );
                return { id: product.id, data: { success: true, suggestions } };
              } catch (error: any) {
                return { id: product.id, data: { success: false, error: error.message } };
              }
            })
          );
          for (const { id, data } of chunkResults) {
            results[id] = data;
          }
          if (i + CHUNK_SIZE < input.products.length) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
        return results;
      }),

    // Generate optimized product description with AI
    generateDescription: protectedProcedure
      .input(
        z.object({
          product: z.object({
            name: z.string(),
            description: z.string().default(""),
            features: z.record(z.string(), z.string()).default({}),
            category: z.string().default(""),
            ean: z.string().optional(),
          }),
          marketplace: z.string(),
          style: z.enum(["seo", "detailed", "short", "custom"]).default("seo"),
          customInstruction: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return aiMapper.generateOptimizedDescription(
          input.product,
          input.marketplace,
          input.style,
          input.customInstruction
        );
      }),

    // Batch generate descriptions with chunked processing
    batchGenerateDescriptions: protectedProcedure
      .input(
        z.object({
          products: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().default(""),
              features: z.record(z.string(), z.string()).default({}),
              category: z.string().default(""),
              ean: z.string().optional(),
            })
          ),
          marketplace: z.string(),
          style: z.enum(["seo", "detailed", "short", "custom"]).default("seo"),
          customInstruction: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const results: Record<string, { description: string }> = {};
        // Process in chunks of 5 for parallel description generation
        const CHUNK_SIZE = 5;
        for (let i = 0; i < input.products.length; i += CHUNK_SIZE) {
          const chunk = input.products.slice(i, i + CHUNK_SIZE);
          const promises = chunk.map(async (product) => {
            try {
              const result = await aiMapper.generateOptimizedDescription(
                product,
                input.marketplace,
                input.style,
                input.customInstruction
              );
              return { id: product.id, description: result.description || "" };
            } catch (error: any) {
              console.error(`Error generating description for ${product.id}:`, error.message);
              return { id: product.id, description: "" };
            }
          });
          const chunkResults = await Promise.all(promises);
          for (const r of chunkResults) {
            if (r.description) {
              results[r.id] = { description: r.description };
            }
          }
          // Minimal delay between chunks
          if (i + CHUNK_SIZE < input.products.length) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
        return results;
      }),

    // Generate product image with AI
    generateProductImage: protectedProcedure
      .input(
        z.object({
          productName: z.string(),
          productDescription: z.string().optional(),
          originalImageUrl: z.string().optional(),
          style: z.enum(["product_photo", "lifestyle", "white_background", "enhanced"]).default("white_background"),
        })
      )
      .mutation(async ({ input }) => {
        let prompt = "";
        switch (input.style) {
          case "white_background":
            prompt = `Professional product photography of ${input.productName} on a clean white background, studio lighting, high resolution, e-commerce style, no text or watermarks`;
            break;
          case "lifestyle":
            prompt = `Lifestyle product photography of ${input.productName} in a natural setting, warm lighting, aspirational, e-commerce marketing style`;
            break;
          case "enhanced":
            prompt = `Enhanced professional product photo of ${input.productName}, improved lighting and colors, sharp details, e-commerce ready`;
            break;
          default:
            prompt = `Professional product photo of ${input.productName}, clean background, studio lighting, e-commerce style`;
        }
        if (input.productDescription) {
          prompt += `. Product details: ${input.productDescription.substring(0, 200)}`;
        }

        const originalImages = input.originalImageUrl
          ? [{ url: input.originalImageUrl, mimeType: "image/jpeg" }]
          : undefined;

        const result = await generateImage({ prompt, originalImages });
        return { url: result.url, prompt };
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
          listingType: z.string().optional(),
          mlItemId: z.string().optional(),
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

    // Export history with filters and pagination
    history: protectedProcedure
      .input(
        z.object({
          status: z.string().optional(),
          listingType: z.string().optional(),
          productName: z.string().optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
        }).optional()
      )
      .query(async ({ ctx, input }) => {
        return db.getExportHistory(ctx.user.id, input || {});
      }),

    // Export history stats (counts by status, listing type, etc.)
    historyStats: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getExportHistoryStats(ctx.user.id);
      }),

    // Get list of product IDs that have been successfully exported
    exportedProductIds: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getExportedProductIds(ctx.user.id);
      }),

    // Get detailed export info per product (marketplace, listingType) for advanced filtering
    exportedProductDetails: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getExportedProductDetails(ctx.user.id);
      }),

    // Get distinct marketplaces that have successful exports
    exportedMarketplaces: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getExportedMarketplaces(ctx.user.id);
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
          listingType: z.enum(["gold_pro", "gold_special", "free"]).optional(),
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
          listingType: input.listingType,
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
              listingType: z.enum(["gold_pro", "gold_special", "free"]).optional(),
            })
          ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const results: any[] = [];
        // Process in chunks of 5 for parallel publishing
        const CHUNK_SIZE = 5;
        for (let i = 0; i < input.products.length; i += CHUNK_SIZE) {
          const chunk = input.products.slice(i, i + CHUNK_SIZE);
          const chunkResults = await Promise.all(
            chunk.map(product =>
              ml.publishProduct(ctx.user.id, input.accountId, {
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
                listingType: product.listingType,
              })
            )
          );
          results.push(...chunkResults);
          // Minimal delay between chunks
          if (i + CHUNK_SIZE < input.products.length) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        return { results, total: results.length, success: results.filter((r: any) => r.success).length };
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

    // Reset stuck sync status
    resetSync: protectedProcedure
      .mutation(async () => {
        mlCat.resetSyncStatus();
        return { reset: true };
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

  // ============ BACKGROUND JOBS ============
  backgroundJobs: router({
    // Create a new background job
    create: protectedProcedure
      .input(
        z.object({
          type: z.enum(["export_ml", "generate_titles", "generate_descriptions", "generate_images"]),
          marketplaceId: z.number().optional(),
          accountId: z.number().optional(),
          accountName: z.string().optional(),
          tagFilter: z.string().optional(),
          listingTypes: z.array(z.string()).optional(),
          titleStyle: z.string().optional(),
          descriptionStyle: z.string().optional(),
          imageStyle: z.string().optional(),
          concurrency: z.number().min(1).max(20).optional(),
          productIds: z.array(z.string()).optional(),
          productData: z.any().optional(),
          totalItems: z.number(),
          scheduledFor: z.string().optional(), // ISO date string
        })
      )
      .mutation(async ({ ctx, input }) => {
        const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : undefined;
        const jobId = await bgWorker.createBackgroundJob({
          userId: ctx.user.id,
          type: input.type,
          marketplaceId: input.marketplaceId,
          accountId: input.accountId,
          accountName: input.accountName,
          tagFilter: input.tagFilter,
          listingTypes: input.listingTypes,
          titleStyle: input.titleStyle,
          descriptionStyle: input.descriptionStyle,
          imageStyle: input.imageStyle,
          concurrency: input.concurrency,
          productIds: input.productIds,
          productData: input.productData,
          totalItems: input.totalItems,
          scheduledFor,
        });
        return { jobId };
      }),

    // List all background jobs for the user
    list: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return bgWorker.getBackgroundJobs(ctx.user.id, input?.limit || 50);
      }),

    // Get a specific job by ID
    get: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await bgWorker.getBackgroundJob(input.jobId);
        if (!job || job.userId !== ctx.user.id) return null;
        return job;
      }),

    // Cancel a running or scheduled job
    cancel: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const success = await bgWorker.cancelBackgroundJob(input.jobId, ctx.user.id);
        return { success };
      }),
  }),

  // ============ AMAZON SP-API ============
  amazon: router({
    // Get all connected Amazon accounts
    getAccounts: protectedProcedure.query(async ({ ctx }) => {
      return amazon.getAccounts(ctx.user.id);
    }),

    // Get OAuth authorization URL
    getAuthUrl: protectedProcedure
      .input(z.object({ redirectUri: z.string(), state: z.string().optional() }))
      .query(({ input }) => {
        return { url: amazon.getAuthorizationUrl(input.redirectUri, input.state) };
      }),

    // Handle OAuth callback
    handleCallback: protectedProcedure
      .input(z.object({
        code: z.string(),
        redirectUri: z.string(),
        sellerId: z.string(),
        marketplace: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tokenData = await amazon.exchangeCodeForToken(input.code, input.redirectUri);
        const accountId = await amazon.saveAccount(
          ctx.user.id,
          tokenData,
          input.sellerId,
          input.marketplace
        );
        return { success: true, accountId };
      }),

    // Connect account manually with refresh token (self-authorization)
    connectManual: protectedProcedure
      .input(z.object({
        sellerId: z.string().min(1, "Seller ID obrigatório"),
        refreshToken: z.string().min(1, "Refresh Token obrigatório"),
        sellerName: z.string().optional(),
        marketplace: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const accountId = await amazon.saveAccountManual(
          ctx.user.id,
          input.sellerId,
          input.refreshToken,
          input.sellerName,
          input.marketplace
        );
        return { success: true, accountId };
      }),

    // Disconnect an Amazon account
    disconnect: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await amazon.deleteAccount(ctx.user.id, input.accountId);
        return { success: true };
      }),

    // Search Amazon catalog by EAN
    searchCatalog: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        identifiers: z.array(z.string()),
        identifierType: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return amazon.searchCatalogByIdentifier(
          input.accountId,
          input.identifiers,
          input.identifierType || "EAN"
        );
      }),

    // Search product types (categories)
    searchProductTypes: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        keywords: z.string(),
      }))
      .query(async ({ input }) => {
        return amazon.searchProductTypes(input.accountId, input.keywords);
      }),

    // Check listing restrictions for an ASIN
    checkRestrictions: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        asin: z.string(),
        sellerId: z.string(),
      }))
      .query(async ({ input }) => {
        return amazon.checkListingRestrictions(input.accountId, input.asin, input.sellerId);
      }),

    // Publish a single product to Amazon
    publishProduct: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        product: z.object({
          productId: z.string(),
          name: z.string(),
          sku: z.string(),
          ean: z.string(),
          price: z.string(),
          stock: z.number(),
          description: z.string(),
          images: z.array(z.string()),
          weight: z.string().optional(),
          category: z.string().optional(),
          brand: z.string().optional(),
          title: z.string().optional(),
        }),
        productType: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return amazon.publishProduct(
          input.accountId,
          input.product,
          {
            userId: ctx.user.id,
            productType: input.productType,
          }
        );
      }),

    // Batch publish products to Amazon
    batchPublish: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        products: z.array(z.object({
          productId: z.string(),
          name: z.string(),
          sku: z.string(),
          ean: z.string(),
          price: z.string(),
          stock: z.number(),
          description: z.string(),
          images: z.array(z.string()),
          weight: z.string().optional(),
          category: z.string().optional(),
          brand: z.string().optional(),
          title: z.string().optional(),
        })),
        productType: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const results: any[] = [];
        const CHUNK_SIZE = 5;
        for (let i = 0; i < input.products.length; i += CHUNK_SIZE) {
          const chunk = input.products.slice(i, i + CHUNK_SIZE);
          const chunkResults = await Promise.all(
            chunk.map(product =>
              amazon.publishProduct(
                input.accountId,
                product,
                {
                  userId: ctx.user.id,
                  productType: input.productType,
                }
              )
            )
          );
          results.push(...chunkResults);
          if (i + CHUNK_SIZE < input.products.length) {
            await new Promise(r => setTimeout(r, 200));
          }
        }
        return {
          total: results.length,
          success: results.filter(r => r.success).length,
          errors: results.filter(r => !r.success).length,
          results,
        };
      }),

    // Get supported marketplaces
    getMarketplaces: publicProcedure.query(() => {
      return amazon.getSupportedMarketplaces();
    }),

    // Get seller participations
    getSellerParticipations: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .query(async ({ input }) => {
        return amazon.getSellerParticipations(input.accountId);
      }),
  }),

  // ============ SHOPEE ============
  shopee: router({
    // Get OAuth authorization URL
    getAuthUrl: protectedProcedure
      .input(z.object({ redirectUrl: z.string() }))
      .query(({ input }) => {
        const url = shopee.getAuthorizationUrl(input.redirectUrl);
        return { url };
      }),

    // Exchange code for token after OAuth callback
    exchangeToken: protectedProcedure
      .input(z.object({
        code: z.string(),
        shopId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const tokenData = await shopee.exchangeCodeForToken(input.code, input.shopId);
        // Try to get shop name
        let shopName: string | undefined;
        try {
          const shopInfo = await shopee.getShopInfo(tokenData.accessToken, tokenData.shopId);
          shopName = shopInfo?.shop_name;
        } catch (e) {
          console.warn("[Shopee] Could not get shop name:", e);
        }
        const accountId = await shopee.saveAccount(
          ctx.user.id,
          tokenData.shopId,
          tokenData.accessToken,
          tokenData.refreshToken,
          tokenData.expiresIn,
          shopName,
          tokenData.refreshTokenExpiresIn
        );
        return { success: true, accountId, shopId: tokenData.shopId, shopName };
      }),

    // List connected accounts
    getAccounts: protectedProcedure.query(async ({ ctx }) => {
      return shopee.getAccounts(ctx.user.id);
    }),

    // Deactivate an account
    deactivateAccount: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await shopee.deactivateAccount(ctx.user.id, input.accountId);
        return { success: true };
      }),

    // Sync products from Shopee shop (blocking, for small shops)
    syncProducts: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const result = await shopee.syncProducts(ctx.user.id, input.accountId);
        return result;
      }),

    // Count all item IDs across NORMAL/UNLIST/BANNED (fast, no product details)
    countItems: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const accounts = await shopee.getAccounts(ctx.user.id);
        const account = (accounts as any[]).find((a) => a.id === input.accountId);
        if (!account) throw new Error("Conta não encontrada");
        return shopee.countShopeeItems(input.accountId);
      }),

    // Check if there is a resumable (failed/stale) shopee_sync job for this account
    getResumableSyncJob: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return bgWorker.getResumableShopeeJob(input.accountId, ctx.user.id);
      }),

    // Re-queue a stale/failed job so the worker picks it up again
    resumeSyncJob: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await bgWorker.getBackgroundJob(input.jobId);
        if (!job || job.userId !== ctx.user.id) throw new Error("Job não encontrado");
        await bgWorker.resumeSyncJob(input.jobId);
        return { jobId: input.jobId };
      }),

    // Start background sync job (non-blocking)
    // fresh: true → cancels any incomplete job for this account before creating a new one
    startSyncJob: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        accountName: z.string().optional(),
        knownTotal: z.number().optional(),
        fresh: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.fresh) {
          await bgWorker.cancelIncompleteShopeeJobs(input.accountId, ctx.user.id);
        }
        const jobId = await bgWorker.createBackgroundJob({
          userId: ctx.user.id,
          type: "shopee_sync",
          accountId: input.accountId,
          accountName: input.accountName,
          totalItems: input.knownTotal ?? 0,
        });
        return { jobId };
      }),

    // Get background job status/progress
    getJobStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await bgWorker.getBackgroundJob(input.jobId);
        if (!job || job.userId !== ctx.user.id) throw new Error("Job não encontrado");
        return {
          id: job.id,
          status: job.status,
          processedItems: job.processedItems,
          totalItems: job.totalItems,
          successCount: job.successCount,
          errorCount: job.errorCount,
          resultLog: job.resultLog,
          lastError: job.lastError,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        };
      }),

    // Get synced products from local DB
    getProducts: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        offset: z.number().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const products = await shopee.getLocalProducts(
          input.accountId,
          input.offset || 0,
          input.limit || 50,
          input.search || undefined
        );
        const total = await shopee.getProductCount(input.accountId, input.search || undefined);
        return { products, total };
      }),

    // Get product quality stats
    getQualityStats: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .query(async ({ input }) => {
        return shopee.getProductQualityStats(input.accountId);
      }),

    // Generate Shopee mass upload spreadsheet from selected products
    generateSpreadsheet: protectedProcedure
      .input(z.object({
        inventoryId: z.number(),
        productIds: z.array(z.number()),
        options: z.object({
          categoryId: z.string().optional(),
          createKitVariations: z.boolean().optional(),
          kitQuantities: z.array(z.number()).optional(),
          kitDiscountPercent: z.array(z.number()).optional(),
          enableDirectDelivery: z.boolean().optional(),
          enableBuyerPickup: z.boolean().optional(),
          enableShopeeXpress: z.boolean().optional(),
          defaultNcm: z.string().optional(),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");

        // Get product details from BaseLinker
        const productsData = await baselinker.getInventoryProductsData(
          token,
          input.inventoryId,
          input.productIds
        );

        // Convert to Shopee format
        const shopeeProducts: shopeeExport.ProductForShopee[] = Object.entries(productsData).map(
          ([id, p]: [string, any]) => {
            // Collect all images
            const images: string[] = [];
            if (p.images) {
              Object.values(p.images).forEach((url: any) => {
                if (url && typeof url === "string") images.push(url);
              });
            }
            const mainImage = images[0] || p.image_url || "";

            return {
              id: parseInt(id),
              name: p.text_fields?.name || p.name || "",
              description: p.text_fields?.description || p.description || "",
              sku: p.sku || "",
              ean: p.ean || "",
              price: parseFloat(p.prices?.["0"] || p.price_brutto || "0"),
              stock: Object.values(p.stock || {}).reduce((sum: number, v: any) => sum + (parseInt(v) || 0), 0),
              weight: parseFloat(p.weight || "0"),
              imageUrl: mainImage,
              images: images.slice(1), // Additional images (exclude cover)
              category: p.category_id?.toString(),
              brand: p.text_fields?.features?.Marca || p.text_fields?.features?.Brand || "",
              length: parseFloat(p.length || "0") || undefined,
              width: parseFloat(p.width || "0") || undefined,
              height: parseFloat(p.height || "0") || undefined,
            };
          }
        );

        if (shopeeProducts.length === 0) {
          throw new Error("Nenhum produto encontrado para exportar");
        }

        // Generate and upload spreadsheet
        const result = await shopeeExport.generateAndUploadShopeeSpreadsheet(
          shopeeProducts,
          input.options || {}
        );

        return result;
      }),
    // Get Shopee categories for product creation
    getCategories: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .query(async ({ input }) => {
        const { accessToken, shopId } = await shopee.getValidToken(input.accountId);
        return shopeePublish.getCategories(accessToken, shopId);
      }),

    // Get attributes for a category
    getCategoryAttributes: protectedProcedure
      .input(z.object({ accountId: z.number(), categoryId: z.number() }))
      .query(async ({ input }) => {
        const { accessToken, shopId } = await shopee.getValidToken(input.accountId);
        return shopeePublish.getCategoryAttributes(accessToken, shopId, input.categoryId);
      }),

    // Get logistics channels
    getLogisticsChannels: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .query(async ({ input }) => {
        const { accessToken, shopId } = await shopee.getValidToken(input.accountId);
        return shopeePublish.getLogisticsChannels(accessToken, shopId);
      }),

    // Publish products directly to Shopee
    publishProducts: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        inventoryId: z.number(),
        productIds: z.array(z.number()),
        categoryId: z.number(),
        logisticIds: z.array(z.number()).optional(),
        createKits: z.boolean().optional(),
        kitQuantities: z.array(z.number()).optional(),
        kitDiscounts: z.array(z.number()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const token = await db.getSetting(ctx.user.id, "baselinker_token");
        if (!token) throw new Error("Token do BaseLinker não configurado");

        const { accessToken, shopId } = await shopee.getValidToken(input.accountId);

        // Get logistics channels if not provided
        let logisticIds = input.logisticIds || [];
        if (logisticIds.length === 0) {
          try {
            const channels = await shopeePublish.getLogisticsChannels(accessToken, shopId);
            logisticIds = channels
              .filter((c: any) => c.enabled)
              .map((c: any) => c.logistics_channel_id)
              .slice(0, 5);
          } catch (e) {
            console.warn("[Shopee] Could not get logistics channels:", e);
          }
        }

        // Get product details from BaseLinker
        const productsData = await baselinker.getInventoryProductsData(
          token,
          input.inventoryId,
          input.productIds
        );

        // Convert to publish format
        const productsToPublish: shopeePublish.ProductToPublish[] = Object.entries(productsData).map(
          ([id, p]: [string, any]) => {
            const images: string[] = [];
            if (p.images) {
              Object.values(p.images).forEach((url: any) => {
                if (url && typeof url === "string") images.push(url);
              });
            }
            if (images.length === 0 && p.image_url) {
              images.push(p.image_url);
            }

            return {
              name: p.text_fields?.name || p.name || "",
              description: p.text_fields?.description || p.description || "Produto importado do BaseLinker",
              sku: p.sku || id,
              ean: p.ean || "",
              price: parseFloat(p.prices?.["0"] || p.price_brutto || "0"),
              stock: Object.values(p.stock || {}).reduce((sum: number, v: any) => sum + (parseInt(v) || 0), 0),
              weight: parseFloat(p.weight || "0.1") || 0.1,
              imageUrls: images,
              categoryId: input.categoryId,
              brand: p.text_fields?.features?.Marca || "",
              length: parseFloat(p.length || "0") || undefined,
              width: parseFloat(p.width || "0") || undefined,
              height: parseFloat(p.height || "0") || undefined,
              createKits: input.createKits,
              kitQuantities: input.kitQuantities,
              kitDiscounts: input.kitDiscounts,
              logisticIds,
            };
          }
        );

        if (productsToPublish.length === 0) {
          throw new Error("Nenhum produto encontrado para publicar");
        }

        // Publish in batch
        const results = await shopeePublish.batchPublish(
          accessToken,
          shopId,
          productsToPublish
        );

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;

        return {
          total: results.length,
          success: successCount,
          failed: failCount,
          results,
        };
      }),

    // ========== QUALITY OPTIMIZER ==========

    // Get batch diagnostics for all products of an account
    getBatchDiagnostics: protectedProcedure
      .input(z.object({ accountId: z.number() }))
      .query(async ({ input }) => {
        return shopeeOptimizer.getBatchDiagnostics(input.accountId);
      }),

    // Get quality diagnostic for a single product
    getProductDiagnostic: protectedProcedure
      .input(z.object({ productId: z.number() }))
      .query(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        const diagnostic = shopeeOptimizer.calculateQualityScore(product);
        // Update score in DB
        await shopeeOptimizer.updateProductQualityScore(product.id, diagnostic.overallScore, diagnostic.grade);
        return { product, diagnostic };
      }),

    // AI optimize title
    optimizeTitle: protectedProcedure
      .input(z.object({
        productId: z.number(),
        productDescription: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        return shopeeOptimizer.optimizeTitle(
          product.itemName || "",
          input.productDescription || product.description || "",
          product.categoryName || undefined
        );
      }),

    // Apply optimized title directly to Shopee
    applyTitle: protectedProcedure
      .input(z.object({
        productId: z.number(),
        newTitle: z.string().min(1).max(140),
      }))
      .mutation(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const shopee = await import("./shopee");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        const { accessToken, shopId } = await shopee.getValidToken(product.shopeeAccountId);
        await shopee.updateItemName(accessToken, shopId, product.itemId, input.newTitle);
        await db.update(shopeeProducts).set({ itemName: input.newTitle }).where(eq(shopeeProducts.id, input.productId));
        return { success: true };
      }),

    // AI optimize description
    optimizeDescription: protectedProcedure
      .input(z.object({
        productId: z.number(),
      }))
      .mutation(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        return shopeeOptimizer.optimizeDescription(
          product.itemName || "",
          product.description || "",
          product.categoryName || undefined
        );
      }),

    // Apply optimized description directly to Shopee
    applyDescription: protectedProcedure
      .input(z.object({
        productId: z.number(),
        newDescription: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const shopee = await import("./shopee");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        const { accessToken, shopId } = await shopee.getValidToken(product.shopeeAccountId);
        await shopee.updateItemFields(accessToken, shopId, product.itemId, { description: input.newDescription });
        await db.update(shopeeProducts).set({ description: input.newDescription }).where(eq(shopeeProducts.id, input.productId));
        return { success: true };
      }),

    // Force-push current DB title+description to Shopee API
    pushToShopee: protectedProcedure
      .input(z.object({ productId: z.number() }))
      .mutation(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const shopee = await import("./shopee");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        const { accessToken, shopId } = await shopee.getValidToken(product.shopeeAccountId);
        await shopee.updateItemFields(accessToken, shopId, product.itemId, {
          item_name: product.itemName || undefined,
          description: product.description || undefined,
        });
        return { success: true, itemId: product.itemId };
      }),

    // Compare current-page products against live Shopee API and return sync status per item
    checkSyncStatus: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        itemIds: z.array(z.number()),
      }))
      .query(async ({ input }) => {
        if (input.itemIds.length === 0) return [];
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { inArray } = await import("drizzle-orm");
        const shopeeModule = await import("./shopee");

        const { accessToken, shopId } = await shopeeModule.getValidToken(input.accountId);

        // Local products for this page
        const localList = await db.select().from(shopeeProducts)
          .where(inArray(shopeeProducts.itemId, input.itemIds));
        const localMap = new Map(localList.map(p => [Number(p.itemId), p]));

        // Shopee API — max 50 per call
        const apiItems = await shopeeModule.getItemBaseInfo(accessToken, shopId, input.itemIds.slice(0, 50));
        const apiMap = new Map(apiItems.map((i: any) => [Number(i.item_id), i]));

        return input.itemIds.map(itemId => {
          const local = localMap.get(itemId);
          const api = apiMap.get(itemId);

          if (!api || !local) return { itemId, status: "not_found" as const, changes: [] };

          const a = api as any;
          const apiPrice = (a.price_info?.[0]?.current_price ?? a.price_info?.[0]?.original_price ?? 0).toString();
          const apiName  = a.item_name || "";
          const apiDesc  = (a.description || "").substring(0, 200);
          const localDesc = (local.description || "").substring(0, 200);

          const changes: string[] = [];
          if (apiName  !== (local.itemName  || ""))  changes.push("título");
          if (apiPrice !== (local.price     || "0")) changes.push("preço");
          if (apiDesc  !== localDesc)                changes.push("descrição");

          return {
            itemId,
            status: changes.length > 0 ? "outdated" as const : "synced" as const,
            changes,
          };
        });
      }),

    // Sync a single product from Shopee API to local DB
    syncSingleProduct: protectedProcedure
      .input(z.object({ productId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const shopeeModule = await import("./shopee");

        const [product] = await db.select().from(shopeeProducts)
          .where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");

        const { accessToken, shopId } = await shopeeModule.getValidToken(product.shopeeAccountId);
        const [item] = await shopeeModule.getItemBaseInfo(accessToken, shopId, [product.itemId]);
        if (!item) throw new Error("Produto não encontrado na Shopee");

        let extraSales = 0;
        let extraRating = "0";
        try {
          const [extra] = await shopeeModule.getItemExtraInfo(accessToken, shopId, [product.itemId]);
          if (extra) { extraSales = extra.sale || 0; extraRating = extra.rating_star?.toString() || "0"; }
        } catch {}

        const priceInfo  = item.price_info?.[0] || {};
        const stockInfo  = item.stock_info_v2?.summary_info || {};
        const attrs      = item.attribute_list || [];
        const filledAttrs = attrs.filter((a: any) => a.attribute_value_list?.length > 0).length;

        await db.update(shopeeProducts).set({
          itemName:        item.item_name || "",
          itemSku:         item.item_sku  || "",
          itemStatus:      item.item_status || "NORMAL",
          categoryId:      item.category_id || null,
          price:           priceInfo.current_price?.toString() || priceInfo.original_price?.toString() || "0",
          stock:           stockInfo.total_available_stock || 0,
          sold:            extraSales,
          rating:          extraRating,
          imageUrl:        item.image?.image_url_list?.[0] || "",
          images:          item.image?.image_url_list || [],
          hasVideo:        item.video_info?.length > 0 ? 1 : 0,
          attributes:      attrs,
          attributesFilled: filledAttrs,
          attributesTotal:  attrs.length,
          variations:      item.model_list || null,
          weight:          item.weight?.toString() || "0",
          dimensionLength: item.dimension?.package_length?.toString() || "",
          dimensionWidth:  item.dimension?.package_width?.toString()  || "",
          dimensionHeight: item.dimension?.package_height?.toString() || "",
          description:     item.description || "",
          lastSyncAt:      new Date(),
        }).where(eq(shopeeProducts.id, input.productId));

        return { success: true };
      }),

    // AI get optimization suggestions
    getOptimizationSuggestions: protectedProcedure
      .input(z.object({
        productId: z.number(),
      }))
      .mutation(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        return shopeeOptimizer.getOptimizationSuggestions(product);
      }),

    // Get perfect listing checklist for a product
    getProductChecklist: protectedProcedure
      .input(z.object({ productId: z.number() }))
      .query(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        return shopeeOptimizer.generatePerfectChecklist(product);
      }),

    // Get real product metrics from Shopee API (sales, views, likes, rating)
    getProductMetrics: protectedProcedure
      .input(z.object({ accountId: z.number(), itemId: z.number() }))
      .query(async ({ input }) => {
        const { accessToken, shopId } = await shopee.getValidToken(input.accountId);
        const extraInfoList = await shopee.getItemExtraInfo(accessToken, shopId, [input.itemId]);
        const info = extraInfoList[0] ?? null;
        const sold = info?.sale_count ?? 0;
        const views = info?.view_count ?? 0;
        return {
          sold,
          views,
          likes: info?.like_count ?? 0,
          rating: info?.rating_star ?? 0,
          ratingCount: info?.rating_count ?? 0,
          conversionRate: views > 0 ? parseFloat(((sold / views) * 100).toFixed(2)) : null,
        };
      }),

    // Get Shopee product URLs
    getProductUrls: protectedProcedure
      .input(z.object({ accountId: z.number(), productId: z.number() }))
      .query(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts, shopeeAccounts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const [product] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, input.productId)).limit(1);
        if (!product) throw new Error("Produto não encontrado");
        const [account] = await db.select().from(shopeeAccounts).where(eq(shopeeAccounts.id, input.accountId)).limit(1);
        if (!account) throw new Error("Conta não encontrada");
        return {
          shopeeUrl: shopeeOptimizer.getShopeeProductUrl(account.shopId, product.itemId, account.region),
          sellerCenterUrl: shopeeOptimizer.getSellerCenterUrl(account.shopId, product.itemId, account.region),
        };
      }),

    // Batch optimize titles
    batchOptimizeTitles: protectedProcedure
      .input(z.object({ productIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        return shopeeOptimizer.batchOptimizeTitles(input.productIds);
      }),

    // Batch optimize descriptions
    batchOptimizeDescriptions: protectedProcedure
      .input(z.object({ productIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        return shopeeOptimizer.batchOptimizeDescriptions(input.productIds);
      }),

    generateAdContent: protectedProcedure
      .input(z.object({
        productName: z.string(),
        category: z.string().optional(),
        variationType: z.string(),
        variations: z.array(z.object({
          label: z.string(),
          qty: z.number(),
          weight: z.string(),
          dimensions: z.string(),
          price: z.string(),
        })),
      }))
      .mutation(async ({ input }) => {
        return shopeeOptimizer.generateAdContent(input);
      }),

    // Publish a product created via the ShopeeCriador wizard
    createProductFromWizard: protectedProcedure
      .input(z.object({
        accountId: z.number(),
        sourceProductId: z.number(),
        variationTypeName: z.string(),
        variations: z.array(z.object({
          label: z.string().max(20),
          price: z.number().positive(),
          stock: z.number().int().min(0),
          weight: z.number().positive(),
          length: z.number().positive().optional(),
          width: z.number().positive().optional(),
          height: z.number().positive().optional(),
        })).min(1),
        title: z.string().min(1).max(120),
        description: z.string(),
        hashtags: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = sharedDb;
        const { shopeeProducts } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const [sourceProduct] = await db.select().from(shopeeProducts)
          .where(eq(shopeeProducts.id, input.sourceProductId)).limit(1);
        if (!sourceProduct) throw new Error("Produto base não encontrado no banco de dados");

        const categoryId = sourceProduct.categoryId;
        if (!categoryId) throw new Error("Produto base não possui categoria Shopee. Sincronize os produtos antes de publicar.");

        const { accessToken, shopId } = await shopee.getValidToken(input.accountId);

        // Get enabled logistics channels
        let logisticIds: number[] = [];
        try {
          const channels = await shopeePublish.getLogisticsChannels(accessToken, shopId);
          logisticIds = (channels as any[])
            .filter((c) => c.enabled)
            .map((c) => c.logistics_channel_id)
            .slice(0, 5);
        } catch (e) {
          console.warn("[Shopee Wizard] Could not fetch logistics channels:", e);
        }

        // Collect image URLs from source product (up to 9)
        const imageUrls: string[] = [];
        const imgs = sourceProduct.images;
        if (Array.isArray(imgs) && imgs.length > 0) {
          imageUrls.push(...(imgs as string[]).filter(Boolean).slice(0, 9));
        } else if (sourceProduct.imageUrl) {
          imageUrls.push(sourceProduct.imageUrl);
        }
        if (imageUrls.length === 0) throw new Error("Produto base não possui imagens. Adicione imagens ao produto na Shopee e sincronize.");

        // Build description with hashtags appended
        let fullDescription = input.description;
        if (input.hashtags && input.hashtags.length > 0) {
          fullDescription += "\n\n" + input.hashtags.slice(0, 20).join(" ");
        }

        console.log(`[Shopee Wizard] Publishing "${input.title}" (${input.variations.length} variation(s), category ${categoryId})...`);
        const result = await shopeePublish.publishProductFromWizard(accessToken, shopId, {
          title: input.title,
          description: fullDescription,
          categoryId,
          imageUrls,
          logisticIds: logisticIds.length > 0 ? logisticIds : undefined,
          baseSku: sourceProduct.itemSku ?? undefined,
          variationTypeName: input.variationTypeName,
          variations: input.variations,
        });

        console.log(`[Shopee Wizard] Published item ${result.itemId}: ${result.itemUrl}`);
        return { success: true, itemId: result.itemId, itemUrl: result.itemUrl, shopId };
      }),
  }),
});

export type AppRouter = typeof appRouter;
