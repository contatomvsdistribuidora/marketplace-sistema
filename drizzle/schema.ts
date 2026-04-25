import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, bigint, boolean } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 256 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Stores the user's BaseLinker API token (encrypted) */
export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  settingKey: varchar("settingKey", { length: 128 }).notNull(),
  settingValue: text("settingValue"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;

/** Supported marketplaces */
export const marketplaces = mysqlTable("marketplaces", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  icon: varchar("icon", { length: 512 }),
  active: int("active").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Marketplace = typeof marketplaces.$inferSelect;

/** Saved category mappings for reuse */
export const categoryMappings = mysqlTable("category_mappings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  marketplaceId: int("marketplaceId").notNull(),
  sourceCategory: varchar("sourceCategory", { length: 512 }).notNull(),
  targetCategoryId: varchar("targetCategoryId", { length: 256 }).notNull(),
  targetCategoryName: varchar("targetCategoryName", { length: 512 }).notNull(),
  targetCategoryPath: text("targetCategoryPath"),
  confidence: int("confidence").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CategoryMapping = typeof categoryMappings.$inferSelect;

/** Saved attribute/parameter templates per category */
export const attributeTemplates = mysqlTable("attribute_templates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  marketplaceId: int("marketplaceId").notNull(),
  categoryId: varchar("categoryId", { length: 256 }).notNull(),
  attributeName: varchar("attributeName", { length: 256 }).notNull(),
  attributeId: varchar("attributeId", { length: 256 }),
  defaultValue: text("defaultValue"),
  aiPromptHint: text("aiPromptHint"),
  required: int("required").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AttributeTemplate = typeof attributeTemplates.$inferSelect;

/** Export jobs (batch operations) */
export const exportJobs = mysqlTable("export_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  marketplaceId: int("marketplaceId").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed", "cancelled"]).default("pending").notNull(),
  totalProducts: int("totalProducts").default(0).notNull(),
  processedProducts: int("processedProducts").default(0).notNull(),
  successCount: int("successCount").default(0).notNull(),
  errorCount: int("errorCount").default(0).notNull(),
  tagFilter: varchar("tagFilter", { length: 256 }),
  config: json("config"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ExportJob = typeof exportJobs.$inferSelect;

/** Individual product export logs */
export const exportLogs = mysqlTable("export_logs", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull(),
  userId: int("userId").notNull(),
  productId: varchar("productId", { length: 128 }).notNull(),
  productName: varchar("productName", { length: 512 }),
  marketplaceId: int("marketplaceId").notNull(),
  listingType: varchar("listingType", { length: 64 }),
  mlItemId: varchar("mlItemId", { length: 64 }),
  status: mysqlEnum("status", ["success", "error", "skipped", "pending"]).default("pending").notNull(),
  mappedCategory: varchar("mappedCategory", { length: 512 }),
  mappedAttributes: json("mappedAttributes"),
  errorMessage: text("errorMessage"),
  errorDetails: json("errorDetails"),
  baselinkerResponse: json("baselinkerResponse"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ExportLog = typeof exportLogs.$inferSelect;

/** Cached products from BaseLinker for fast filtering */
export const productCache = mysqlTable("product_cache", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  inventoryId: int("inventoryId").notNull(),
  productId: bigint("productId", { mode: "number" }).notNull(),
  name: varchar("name", { length: 1024 }).default("").notNull(),
  sku: varchar("sku", { length: 256 }).default("").notNull(),
  ean: varchar("ean", { length: 128 }).default("").notNull(),
  categoryId: int("categoryId").default(0).notNull(),
  manufacturerId: int("manufacturerId").default(0).notNull(),
  mainPrice: varchar("mainPrice", { length: 32 }).default("0").notNull(),
  totalStock: int("totalStock").default(0).notNull(),
  weight: varchar("weight", { length: 32 }).default("0").notNull(),
  tags: json("tags").$type<string[]>(),
  description: text("description"),
  imageUrl: varchar("imageUrl", { length: 1024 }),
  cachedAt: timestamp("cachedAt").defaultNow().notNull(),
});

export type ProductCacheRow = typeof productCache.$inferSelect;
export type InsertProductCache = typeof productCache.$inferInsert;

/** Tracks the state of the product cache sync */
export const cacheSync = mysqlTable("cache_sync", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  inventoryId: int("inventoryId").notNull(),
  totalProducts: int("totalProducts").default(0).notNull(),
  lastProductId: bigint("lastProductId", { mode: "number" }).default(0).notNull(),
  isComplete: int("isComplete").default(0).notNull(),
  lastSyncAt: timestamp("lastSyncAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CacheSyncRow = typeof cacheSync.$inferSelect;

/** Agent export queue - products waiting to be listed by the agent in BaseLinker panel */
export const agentQueue = mysqlTable("agent_queue", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  jobId: int("jobId").notNull(),
  productId: varchar("productId", { length: 128 }).notNull(),
  productName: varchar("productName", { length: 512 }),
  sku: varchar("sku", { length: 256 }),
  ean: varchar("ean", { length: 128 }),
  price: varchar("price", { length: 32 }),
  stock: int("stock").default(0),
  imageUrl: varchar("imageUrl", { length: 1024 }),
  description: text("description"),
  mappedCategory: varchar("mappedCategory", { length: 512 }),
  mappedAttributes: json("mappedAttributes"),
  marketplaceType: varchar("marketplaceType", { length: 64 }).notNull(),
  accountId: varchar("accountId", { length: 128 }).notNull(),
  accountName: varchar("accountName", { length: 256 }),
  inventoryId: int("inventoryId").notNull(),
  status: mysqlEnum("queue_status", ["waiting", "processing", "completed", "failed", "skipped"]).default("waiting").notNull(),
  errorMessage: text("errorMessage"),
  screenshotUrl: varchar("screenshotUrl", { length: 1024 }),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentQueueRow = typeof agentQueue.$inferSelect;
export type InsertAgentQueue = typeof agentQueue.$inferInsert;

/** Agent action log - tracks every action the agent performs in BaseLinker panel */
export const agentActions = mysqlTable("agent_actions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  jobId: int("jobId"),
  queueItemId: int("queueItemId"),
  actionType: mysqlEnum("action_type", ["navigate", "click", "type", "select", "screenshot", "wait", "success", "error", "info"]).default("info").notNull(),
  description: text("description").notNull(),
  screenshotUrl: varchar("screenshotUrl", { length: 1024 }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AgentActionRow = typeof agentActions.$inferSelect;
export type InsertAgentAction = typeof agentActions.$inferInsert;

/** Connected Mercado Livre accounts via OAuth */
export const mlAccounts = mysqlTable("ml_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  mlUserId: bigint("mlUserId", { mode: "number" }).notNull(),
  nickname: varchar("nickname", { length: 256 }),
  email: varchar("email", { length: 320 }),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  tokenExpiresAt: timestamp("tokenExpiresAt").notNull(),
  scopes: text("scopes"),
  siteId: varchar("siteId", { length: 10 }).default("MLB").notNull(),
  isActive: int("isActive").default(1).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MlAccount = typeof mlAccounts.$inferSelect;
export type InsertMlAccount = typeof mlAccounts.$inferInsert;

/** Mercado Livre item listings created through our system */
export const mlListings = mysqlTable("ml_listings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  mlAccountId: int("mlAccountId").notNull(),
  mlItemId: varchar("mlItemId", { length: 64 }),
  productId: varchar("productId", { length: 128 }).notNull(),
  productName: varchar("productName", { length: 512 }),
  title: varchar("title", { length: 256 }),
  categoryId: varchar("categoryId", { length: 64 }),
  categoryName: varchar("categoryName", { length: 512 }),
  price: varchar("price", { length: 32 }),
  currencyId: varchar("currencyId", { length: 10 }).default("BRL"),
  status: mysqlEnum("ml_listing_status", ["draft", "active", "paused", "closed", "error"]).default("draft").notNull(),
  listingType: varchar("listingType", { length: 64 }).default("gold_special"),
  permalink: text("permalink"),
  attributes: json("attributes"),
  errorMessage: text("errorMessage"),
  mlResponse: json("mlResponse"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MlListing = typeof mlListings.$inferSelect;
export type InsertMlListing = typeof mlListings.$inferInsert;

/** Connected TikTok Shop accounts via OAuth */
export const tiktokAccounts = mysqlTable("tiktok_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  ttOpenId: varchar("ttOpenId", { length: 256 }).notNull(),
  sellerName: varchar("sellerName", { length: 256 }),
  sellerBaseRegion: varchar("sellerBaseRegion", { length: 10 }),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt").notNull(),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt").notNull(),
  shopId: varchar("shopId", { length: 128 }),
  shopName: varchar("shopName", { length: 256 }),
  shopRegion: varchar("shopRegion", { length: 10 }),
  shopCipher: varchar("shopCipher", { length: 512 }),
  isActive: int("isActive").default(1).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TiktokAccount = typeof tiktokAccounts.$inferSelect;
export type InsertTiktokAccount = typeof tiktokAccounts.$inferInsert;

/** TikTok Shop product listings created through our system */
export const tiktokListings = mysqlTable("tiktok_listings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tiktokAccountId: int("tiktokAccountId").notNull(),
  ttProductId: varchar("ttProductId", { length: 128 }),
  productId: varchar("productId", { length: 128 }).notNull(),
  productName: varchar("productName", { length: 512 }),
  title: varchar("title", { length: 256 }),
  categoryId: varchar("categoryId", { length: 128 }),
  categoryName: varchar("categoryName", { length: 512 }),
  price: varchar("price", { length: 32 }),
  currency: varchar("currency", { length: 10 }).default("BRL"),
  status: mysqlEnum("tt_listing_status", ["draft", "pending", "active", "failed", "deactivated", "deleted"]).default("draft").notNull(),
  ttResponse: json("ttResponse"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TiktokListing = typeof tiktokListings.$inferSelect;
export type InsertTiktokListing = typeof tiktokListings.$inferInsert;

/** Cached Mercado Livre categories tree */
export const mlCategories = mysqlTable("ml_categories", {
  id: int("id").autoincrement().primaryKey(),
  mlCategoryId: varchar("mlCategoryId", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 512 }).notNull(),
  parentId: varchar("parentId", { length: 32 }),
  pathFromRoot: text("pathFromRoot"),
  pathIds: text("pathIds"),
  totalItems: int("totalItems").default(0),
  hasChildren: int("hasChildren").default(0).notNull(),
  isLeaf: int("isLeaf").default(0).notNull(),
  level: int("level").default(0).notNull(),
  picture: varchar("picture", { length: 1024 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MlCategory = typeof mlCategories.$inferSelect;
export type InsertMlCategory = typeof mlCategories.$inferInsert;

/** Background processing jobs for large-scale exports */
export const backgroundJobs = mysqlTable("background_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("bg_job_type", ["export_ml", "generate_titles", "generate_descriptions", "generate_images", "shopee_sync"]).notNull(),
  status: mysqlEnum("bg_job_status", ["scheduled", "queued", "processing", "completed", "failed", "cancelled"]).default("queued").notNull(),
  // Job configuration
  marketplaceId: int("marketplaceId"),
  accountId: int("accountId"),
  accountName: varchar("accountName", { length: 256 }),
  tagFilter: varchar("tagFilter", { length: 256 }),
  listingTypes: json("listingTypes").$type<string[]>(),
  titleStyle: varchar("titleStyle", { length: 64 }),
  descriptionStyle: varchar("descriptionStyle", { length: 64 }),
  imageStyle: varchar("imageStyle", { length: 64 }),
  concurrency: int("concurrency").default(5).notNull(),
  // Products to process (stored as JSON array of product data)
  productIds: json("productIds").$type<string[]>(),
  productData: json("productData"),
  // Progress tracking
  totalItems: int("totalItems").default(0).notNull(),
  processedItems: int("processedItems").default(0).notNull(),
  successCount: int("successCount").default(0).notNull(),
  errorCount: int("errorCount").default(0).notNull(),
  // Scheduling
  scheduledFor: timestamp("scheduledFor"),
  // Timing
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  // Error info
  lastError: text("lastError"),
  // Results log
  resultLog: json("resultLog"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type InsertBackgroundJob = typeof backgroundJobs.$inferInsert;

/** Connected Amazon Seller accounts via SP-API OAuth / Self-Authorization */
export const amazonAccounts = mysqlTable("amazon_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sellerId: varchar("sellerId", { length: 128 }).notNull(),
  sellerName: varchar("sellerName", { length: 256 }),
  email: varchar("email", { length: 320 }),
  marketplaceId: varchar("marketplaceId", { length: 32 }).default("A2Q3Y263D00KWC").notNull(), // Brazil
  region: varchar("region", { length: 32 }).default("na").notNull(), // na, eu, fe
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken").notNull(),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  isActive: int("isActive").default(1).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AmazonAccount = typeof amazonAccounts.$inferSelect;
export type InsertAmazonAccount = typeof amazonAccounts.$inferInsert;

/** Amazon product listings created through our system */
export const amazonListings = mysqlTable("amazon_listings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  amazonAccountId: int("amazonAccountId").notNull(),
  asin: varchar("asin", { length: 32 }),
  sku: varchar("sku", { length: 256 }).notNull(),
  productId: varchar("productId", { length: 128 }).notNull(),
  productName: varchar("productName", { length: 512 }),
  title: varchar("title", { length: 512 }),
  productType: varchar("productType", { length: 256 }),
  categoryName: varchar("categoryName", { length: 512 }),
  price: varchar("price", { length: 32 }),
  currency: varchar("currency", { length: 10 }).default("BRL"),
  status: mysqlEnum("amz_listing_status", ["draft", "active", "inactive", "error", "suppressed"]).default("draft").notNull(),
  submissionId: varchar("submissionId", { length: 128 }),
  issues: json("issues"),
  permalink: text("permalink"),
  amzResponse: json("amzResponse"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AmazonListing = typeof amazonListings.$inferSelect;
export type InsertAmazonListing = typeof amazonListings.$inferInsert;

/** Connected Shopee accounts via OAuth */
export const shopeeAccounts = mysqlTable("shopee_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  shopId: bigint("shopId", { mode: "number" }).notNull(),
  shopName: varchar("shopName", { length: 256 }),
  region: varchar("region", { length: 10 }).default("BR").notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  tokenExpiresAt: timestamp("tokenExpiresAt").notNull(),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  tokenStatus: varchar("tokenStatus", { length: 32 }).default("active").notNull(),
  shopStatus: varchar("shopStatus", { length: 64 }),
  totalProducts: int("totalProducts").default(0),
  isActive: int("isActive").default(1).notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShopeeAccount = typeof shopeeAccounts.$inferSelect;
export type InsertShopeeAccount = typeof shopeeAccounts.$inferInsert;

/** Shopee product listings synced from the shop */
export const shopeeProducts = mysqlTable("shopee_products", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  shopeeAccountId: int("shopeeAccountId").notNull(),
  itemId: bigint("itemId", { mode: "number" }).notNull(),
  /**
   * Previous Shopee item_id when the user re-publishes as a new product
   * (publishAsNewProduct flow). Preserved for audit / cross-reference;
   * the old listing on Shopee stays untouched.
   */
  shopeeItemIdLegacy: bigint("shopeeItemIdLegacy", { mode: "number" }),
  itemName: varchar("itemName", { length: 1024 }),
  itemSku: varchar("itemSku", { length: 256 }),
  itemStatus: varchar("itemStatus", { length: 32 }),
  categoryId: bigint("categoryId", { mode: "number" }),
  categoryName: varchar("categoryName", { length: 512 }),
  price: varchar("price", { length: 32 }),
  stock: int("stock").default(0),
  sold: int("sold").default(0),
  rating: varchar("rating", { length: 10 }),
  imageUrl: varchar("imageUrl", { length: 1024 }),
  images: json("images").$type<string[]>(),
  hasVideo: int("hasVideo").default(0),
  attributes: json("attributes"),
  attributesFilled: int("attributesFilled").default(0),
  attributesTotal: int("attributesTotal").default(0),
  qualityScore: varchar("qualityScore", { length: 32 }),
  variations: json("variations"),
  weight: varchar("weight", { length: 32 }),
  dimensionLength: varchar("dimensionLength", { length: 32 }),
  dimensionWidth: varchar("dimensionWidth", { length: 32 }),
  dimensionHeight: varchar("dimensionHeight", { length: 32 }),
  description: text("description"),
  /**
   * 1 = the listing was created on Shopee through our wizard
   * (createProductFromWizard / publishAsNewProduct).
   * 0 = imported from Shopee via sync. Default 0 keeps every pre-existing
   * row backwards-compatible.
   */
  createdBySystem: int("createdBySystem").default(0).notNull(),
  /** 1 when the user accepted an AI-generated title (applyTitle). */
  titleAiGenerated: int("titleAiGenerated").default(0).notNull(),
  /** 1 when the user accepted an AI-generated description (applyDescription). */
  descriptionAiGenerated: int("descriptionAiGenerated").default(0).notNull(),
  lastSyncAt: timestamp("lastSyncAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShopeeProduct = typeof shopeeProducts.$inferSelect;
export type InsertShopeeProduct = typeof shopeeProducts.$inferInsert;

/** Local fallback for Shopee category attributes (used when get_attributes API is suspended) */
export const shopeeCategoryAttributes = mysqlTable("shopee_category_attributes", {
  id: int("id").autoincrement().primaryKey(),
  categoryId: bigint("categoryId", { mode: "number" }).notNull().unique(),
  categoryName: varchar("categoryName", { length: 512 }),
  attributeList: json("attributeList").$type<any[]>(),
  source: varchar("source", { length: 32 }).default("seed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShopeeCategoryAttribute = typeof shopeeCategoryAttributes.$inferSelect;

/**
 * Global cache of the Shopee category tree. The tree is identical for every
 * seller in a given region (BR/MX/etc.) so we key by `region` and use 1 row
 * per region, not per shopId.
 */
export const shopeeCategoryCache = mysqlTable("shopee_category_cache", {
  id: int("id").autoincrement().primaryKey(),
  region: varchar("region", { length: 10 }).default("BR").notNull().unique(),
  categoryTree: json("categoryTree").$type<any[]>(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShopeeCategoryCache = typeof shopeeCategoryCache.$inferSelect;

/**
 * Cache of Shopee's brand list per category (shared across sellers in a
 * region — same as category tree). TTL: 7 days, enforced by the caller.
 */
export const shopeeBrandCache = mysqlTable("shopee_brand_cache", {
  id: int("id").autoincrement().primaryKey(),
  region: varchar("region", { length: 10 }).default("BR").notNull(),
  categoryId: bigint("categoryId", { mode: "number" }).notNull(),
  brandList: json("brandList").$type<any[]>(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShopeeBrandCache = typeof shopeeBrandCache.$inferSelect;
