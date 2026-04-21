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

  // Run missing table migrations
  app.get("/api/run-migrations", async (req, res) => {
    const { pool } = await import("../db");
    const results: { table: string; status: string; error?: string }[] = [];

    const statements: { table: string; sql: string }[] = [
      {
        table: "shopee_accounts",
        sql: `CREATE TABLE IF NOT EXISTS \`shopee_accounts\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`userId\` int NOT NULL,
  \`shopId\` bigint NOT NULL,
  \`shopName\` varchar(256),
  \`region\` varchar(10) NOT NULL DEFAULT 'BR',
  \`accessToken\` text NOT NULL,
  \`refreshToken\` text NOT NULL,
  \`tokenExpiresAt\` timestamp NOT NULL,
  \`refreshTokenExpiresAt\` timestamp NULL,
  \`tokenStatus\` varchar(32) NOT NULL DEFAULT 'active',
  \`shopStatus\` varchar(64),
  \`totalProducts\` int DEFAULT 0,
  \`isActive\` int NOT NULL DEFAULT 1,
  \`lastSyncAt\` timestamp NULL,
  \`lastUsedAt\` timestamp NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT now(),
  \`updatedAt\` timestamp NOT NULL DEFAULT now() ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
)`,
      },
      {
        table: "shopee_products",
        sql: `CREATE TABLE IF NOT EXISTS \`shopee_products\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`userId\` int NOT NULL,
  \`shopeeAccountId\` int NOT NULL,
  \`itemId\` bigint NOT NULL,
  \`itemName\` varchar(1024),
  \`itemSku\` varchar(256),
  \`itemStatus\` varchar(32),
  \`categoryId\` bigint,
  \`categoryName\` varchar(512),
  \`price\` varchar(32),
  \`stock\` int DEFAULT 0,
  \`sold\` int DEFAULT 0,
  \`rating\` varchar(10),
  \`imageUrl\` varchar(1024),
  \`images\` json,
  \`hasVideo\` int DEFAULT 0,
  \`attributes\` json,
  \`attributesFilled\` int DEFAULT 0,
  \`attributesTotal\` int DEFAULT 0,
  \`qualityScore\` varchar(32),
  \`variations\` json,
  \`weight\` varchar(32),
  \`dimensionLength\` varchar(32),
  \`dimensionWidth\` varchar(32),
  \`dimensionHeight\` varchar(32),
  \`description\` text,
  \`lastSyncAt\` timestamp NOT NULL DEFAULT now(),
  \`createdAt\` timestamp NOT NULL DEFAULT now(),
  \`updatedAt\` timestamp NOT NULL DEFAULT now() ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
)`,
      },
    ];

    for (const { table, sql } of statements) {
      try {
        const conn = await pool.getConnection();
        await conn.query(sql);
        conn.release();
        results.push({ table, status: "ok" });
      } catch (err: any) {
        results.push({ table, status: "error", error: err.message });
      }
    }

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
