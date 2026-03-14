import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, bigint, boolean } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
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
