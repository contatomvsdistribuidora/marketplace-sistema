import "dotenv/config";
import crypto from "crypto";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerMlRoutes } from "../ml-routes.js";
import { registerTiktokRoutes } from "../tiktok-routes.js";
import { registerShopeeRoutes } from "../shopee-routes.js";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startBackgroundWorker } from "../background-worker";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Mercado Livre OAuth callback and notifications
  registerMlRoutes(app);
  // TikTok Shop OAuth callback
  registerTiktokRoutes(app);
  // Shopee OAuth callback
  registerShopeeRoutes(app);
  // One-time admin setup endpoint
  app.get("/api/setup-admin", async (req, res) => {
    try {
      const mysql = await import("mysql2/promise");
      const conn = await (mysql as any).createConnection(process.env.DATABASE_URL);
      await conn.query("SELECT 1");
      await conn.end();
      return res.json({ success: true, message: "Conexão OK" });
    } catch (err: any) {
      return res.json({
        error: err.message,
        code: err.code,
        errno: err.errno,
        sqlState: err.sqlState,
        url: process.env.DATABASE_URL
          ? process.env.DATABASE_URL.replace(/:([^:@]+)@/, ":***@")
          : "NÃO DEFINIDA",
      });
    }
  });
  // Shopee signature debug endpoint
  app.get("/api/debug-shopee", (req, res) => {
    const partnerId = process.env.SHOPEE_PARTNER_ID;
    const partnerKey = process.env.SHOPEE_PARTNER_KEY;
    const timestamp = Math.floor(Date.now() / 1000);
    const path = "/api/v2/shop/auth_partner";
    const baseString = `${partnerId}${path}${timestamp}`;
    const sign = crypto.createHmac("sha256", partnerKey ?? "").update(baseString).digest("hex");
    return res.json({
      partnerId,
      timestamp,
      path,
      baseString,
      sign,
      keyLength: partnerKey?.length,
      partnerKeyFirst10: partnerKey?.substring(0, 10),
      partnerKeyLast5: partnerKey?.substring((partnerKey?.length ?? 0) - 5),
    });
  });

  // Run all missing table migrations
  app.get("/api/run-migrations", async (req, res) => {
    const { pool } = await import("../db");
    const results: { name: string; status: string; error?: string }[] = [];

    const statements: { name: string; sql: string }[] = [
      { name: "cache_sync", sql: `CREATE TABLE IF NOT EXISTS \`cache_sync\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`inventoryId\` int NOT NULL,\`totalProducts\` int NOT NULL DEFAULT 0,\`lastProductId\` bigint NOT NULL DEFAULT 0,\`isComplete\` int NOT NULL DEFAULT 0,\`lastSyncAt\` timestamp NOT NULL DEFAULT (now()),\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`cache_sync_id\` PRIMARY KEY(\`id\`))` },
      { name: "product_cache", sql: `CREATE TABLE IF NOT EXISTS \`product_cache\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`inventoryId\` int NOT NULL,\`productId\` bigint NOT NULL,\`name\` varchar(1024) NOT NULL DEFAULT '',\`sku\` varchar(256) NOT NULL DEFAULT '',\`ean\` varchar(128) NOT NULL DEFAULT '',\`categoryId\` int NOT NULL DEFAULT 0,\`manufacturerId\` int NOT NULL DEFAULT 0,\`mainPrice\` varchar(32) NOT NULL DEFAULT '0',\`totalStock\` int NOT NULL DEFAULT 0,\`weight\` varchar(32) NOT NULL DEFAULT '0',\`tags\` json,\`description\` text,\`imageUrl\` varchar(1024),\`cachedAt\` timestamp NOT NULL DEFAULT (now()),CONSTRAINT \`product_cache_id\` PRIMARY KEY(\`id\`))` },
      { name: "agent_actions", sql: `CREATE TABLE IF NOT EXISTS \`agent_actions\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`jobId\` int,\`queueItemId\` int,\`action_type\` enum('navigate','click','type','select','screenshot','wait','success','error','info') NOT NULL DEFAULT 'info',\`description\` text NOT NULL,\`screenshotUrl\` varchar(1024),\`metadata\` json,\`createdAt\` timestamp NOT NULL DEFAULT (now()),CONSTRAINT \`agent_actions_id\` PRIMARY KEY(\`id\`))` },
      { name: "agent_queue", sql: `CREATE TABLE IF NOT EXISTS \`agent_queue\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`jobId\` int NOT NULL,\`productId\` varchar(128) NOT NULL,\`productName\` varchar(512),\`sku\` varchar(256),\`ean\` varchar(128),\`price\` varchar(32),\`stock\` int DEFAULT 0,\`imageUrl\` varchar(1024),\`description\` text,\`mappedCategory\` varchar(512),\`mappedAttributes\` json,\`marketplaceType\` varchar(64) NOT NULL,\`accountId\` varchar(128) NOT NULL,\`accountName\` varchar(256),\`inventoryId\` int NOT NULL,\`queue_status\` enum('waiting','processing','completed','failed','skipped') NOT NULL DEFAULT 'waiting',\`errorMessage\` text,\`screenshotUrl\` varchar(1024),\`processedAt\` timestamp,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`agent_queue_id\` PRIMARY KEY(\`id\`))` },
      { name: "ml_accounts", sql: `CREATE TABLE IF NOT EXISTS \`ml_accounts\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`mlUserId\` bigint NOT NULL,\`nickname\` varchar(256),\`email\` varchar(320),\`accessToken\` text NOT NULL,\`refreshToken\` text NOT NULL,\`tokenExpiresAt\` timestamp NOT NULL,\`scopes\` text,\`siteId\` varchar(10) NOT NULL DEFAULT 'MLB',\`isActive\` int NOT NULL DEFAULT 1,\`lastUsedAt\` timestamp,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`ml_accounts_id\` PRIMARY KEY(\`id\`))` },
      { name: "ml_listings", sql: `CREATE TABLE IF NOT EXISTS \`ml_listings\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`mlAccountId\` int NOT NULL,\`mlItemId\` varchar(64),\`productId\` varchar(128) NOT NULL,\`productName\` varchar(512),\`title\` varchar(256),\`categoryId\` varchar(64),\`categoryName\` varchar(512),\`price\` varchar(32),\`currencyId\` varchar(10) DEFAULT 'BRL',\`ml_listing_status\` enum('draft','active','paused','closed','error') NOT NULL DEFAULT 'draft',\`listingType\` varchar(64) DEFAULT 'gold_special',\`permalink\` text,\`attributes\` json,\`errorMessage\` text,\`mlResponse\` json,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`ml_listings_id\` PRIMARY KEY(\`id\`))` },
      { name: "tiktok_accounts", sql: `CREATE TABLE IF NOT EXISTS \`tiktok_accounts\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`ttOpenId\` varchar(256) NOT NULL,\`sellerName\` varchar(256),\`sellerBaseRegion\` varchar(10),\`accessToken\` text NOT NULL,\`refreshToken\` text NOT NULL,\`accessTokenExpiresAt\` timestamp NOT NULL,\`refreshTokenExpiresAt\` timestamp NOT NULL,\`shopId\` varchar(128),\`shopName\` varchar(256),\`shopRegion\` varchar(10),\`shopCipher\` varchar(512),\`isActive\` int NOT NULL DEFAULT 1,\`lastUsedAt\` timestamp,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`tiktok_accounts_id\` PRIMARY KEY(\`id\`))` },
      { name: "tiktok_listings", sql: `CREATE TABLE IF NOT EXISTS \`tiktok_listings\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`tiktokAccountId\` int NOT NULL,\`ttProductId\` varchar(128),\`productId\` varchar(128) NOT NULL,\`productName\` varchar(512),\`title\` varchar(256),\`categoryId\` varchar(128),\`categoryName\` varchar(512),\`price\` varchar(32),\`currency\` varchar(10) DEFAULT 'BRL',\`tt_listing_status\` enum('draft','pending','active','failed','deactivated','deleted') NOT NULL DEFAULT 'draft',\`ttResponse\` json,\`errorMessage\` text,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`tiktok_listings_id\` PRIMARY KEY(\`id\`))` },
      { name: "background_jobs", sql: `CREATE TABLE IF NOT EXISTS \`background_jobs\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`bg_job_type\` enum('export_ml','generate_titles','generate_descriptions','generate_images','shopee_sync') NOT NULL,\`bg_job_status\` enum('scheduled','queued','processing','completed','failed','cancelled') NOT NULL DEFAULT 'queued',\`marketplaceId\` int,\`accountId\` int,\`accountName\` varchar(256),\`tagFilter\` varchar(256),\`listingTypes\` json,\`titleStyle\` varchar(64),\`descriptionStyle\` varchar(64),\`imageStyle\` varchar(64),\`concurrency\` int NOT NULL DEFAULT 5,\`productIds\` json,\`productData\` json,\`totalItems\` int NOT NULL DEFAULT 0,\`processedItems\` int NOT NULL DEFAULT 0,\`successCount\` int NOT NULL DEFAULT 0,\`errorCount\` int NOT NULL DEFAULT 0,\`scheduledFor\` timestamp,\`startedAt\` timestamp,\`completedAt\` timestamp,\`lastError\` text,\`resultLog\` json,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`background_jobs_id\` PRIMARY KEY(\`id\`))` },
      { name: "amazon_accounts", sql: `CREATE TABLE IF NOT EXISTS \`amazon_accounts\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`sellerId\` varchar(128) NOT NULL,\`sellerName\` varchar(256),\`email\` varchar(320),\`marketplaceId\` varchar(32) NOT NULL DEFAULT 'A2Q3Y263D00KWC',\`region\` varchar(32) NOT NULL DEFAULT 'na',\`accessToken\` text,\`refreshToken\` text NOT NULL,\`tokenExpiresAt\` timestamp,\`isActive\` int NOT NULL DEFAULT 1,\`lastUsedAt\` timestamp,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`amazon_accounts_id\` PRIMARY KEY(\`id\`))` },
      { name: "amazon_listings", sql: `CREATE TABLE IF NOT EXISTS \`amazon_listings\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`amazonAccountId\` int NOT NULL,\`asin\` varchar(32),\`sku\` varchar(256) NOT NULL,\`productId\` varchar(128) NOT NULL,\`productName\` varchar(512),\`title\` varchar(512),\`productType\` varchar(256),\`categoryName\` varchar(512),\`price\` varchar(32),\`currency\` varchar(10) DEFAULT 'BRL',\`amz_listing_status\` enum('draft','active','inactive','error','suppressed') NOT NULL DEFAULT 'draft',\`submissionId\` varchar(128),\`issues\` json,\`permalink\` text,\`amzResponse\` json,\`errorMessage\` text,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`amazon_listings_id\` PRIMARY KEY(\`id\`))` },
      { name: "shopee_accounts", sql: `CREATE TABLE IF NOT EXISTS \`shopee_accounts\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`shopId\` bigint NOT NULL,\`shopName\` varchar(256),\`region\` varchar(10) NOT NULL DEFAULT 'BR',\`accessToken\` text NOT NULL,\`refreshToken\` text NOT NULL,\`tokenExpiresAt\` timestamp NOT NULL,\`refreshTokenExpiresAt\` timestamp,\`tokenStatus\` varchar(32) NOT NULL DEFAULT 'active',\`shopStatus\` varchar(64),\`totalProducts\` int DEFAULT 0,\`isActive\` int NOT NULL DEFAULT 1,\`lastSyncAt\` timestamp,\`lastUsedAt\` timestamp,\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`shopee_accounts_id\` PRIMARY KEY(\`id\`))` },
      { name: "shopee_products", sql: `CREATE TABLE IF NOT EXISTS \`shopee_products\` (\`id\` int AUTO_INCREMENT NOT NULL,\`userId\` int NOT NULL,\`shopeeAccountId\` int NOT NULL,\`itemId\` bigint NOT NULL,\`itemName\` varchar(1024),\`itemSku\` varchar(256),\`itemStatus\` varchar(32),\`categoryId\` bigint,\`categoryName\` varchar(512),\`price\` varchar(32),\`stock\` int DEFAULT 0,\`sold\` int DEFAULT 0,\`rating\` varchar(10),\`imageUrl\` varchar(1024),\`images\` json,\`hasVideo\` int DEFAULT 0,\`attributes\` json,\`attributesFilled\` int DEFAULT 0,\`attributesTotal\` int DEFAULT 0,\`qualityScore\` varchar(32),\`variations\` json,\`weight\` varchar(32),\`dimensionLength\` varchar(32),\`dimensionWidth\` varchar(32),\`dimensionHeight\` varchar(32),\`description\` text,\`lastSyncAt\` timestamp NOT NULL DEFAULT (now()),\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`shopee_products_id\` PRIMARY KEY(\`id\`))` },
      // 0012: ALTER columns (ignored if already present)
      { name: "alter:background_jobs:shopee_sync", sql: `ALTER TABLE \`background_jobs\` MODIFY COLUMN \`bg_job_type\` enum('export_ml','generate_titles','generate_descriptions','generate_images','shopee_sync') NOT NULL` },
      { name: "alter:shopee_accounts:refreshTokenExpiresAt", sql: `ALTER TABLE \`shopee_accounts\` ADD COLUMN \`refreshTokenExpiresAt\` timestamp` },
      { name: "alter:shopee_accounts:tokenStatus", sql: `ALTER TABLE \`shopee_accounts\` ADD COLUMN \`tokenStatus\` varchar(32) NOT NULL DEFAULT 'active'` },
    ];

    const conn = await pool.getConnection();
    for (const { name, sql } of statements) {
      try {
        await conn.query(sql);
        results.push({ name, status: "ok" });
      } catch (err: any) {
        // Duplicate column errors (1060) are expected on re-runs — treat as ok
        const ok = err.errno === 1060 || err.errno === 1061;
        results.push({ name, status: ok ? "already_exists" : "error", error: ok ? undefined : err.message });
      }
    }
    conn.release();

    return res.json({ results });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Start background worker for processing scheduled jobs
    startBackgroundWorker();
  });
}

startServer().catch(console.error);
