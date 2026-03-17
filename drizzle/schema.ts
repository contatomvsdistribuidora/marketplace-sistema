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
