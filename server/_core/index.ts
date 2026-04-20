import "dotenv/config";
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
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.warn("[migrations] DATABASE_URL não configurada, pulando migrations");
    return;
  }
  try {
    const db = drizzle(process.env.DATABASE_URL);
    const migrationsFolder = path.resolve(__dirname, "../../drizzle");
    await migrate(db, { migrationsFolder });
    console.log("[migrations] ✅ Migrations aplicadas com sucesso");
  } catch (err: any) {
    // Ignora erros de coluna/tabela já existente (migrations parcialmente aplicadas)
    if (err?.cause?.code === "ER_DUP_FIELDNAME" || err?.cause?.code === "ER_TABLE_EXISTS_ERROR") {
      console.warn("[migrations] Aviso (ignorado):", err?.cause?.message);
    } else {
      console.error("[migrations] Erro ao rodar migrations:", err?.message, err?.cause?.message);
    }
  }
}

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
  await runMigrations();
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
      if (!process.env.DATABASE_URL) {
        return res.status(500).json({ error: "DATABASE_URL não configurada" });
      }
      // Roda migrations primeiro para garantir que as tabelas existam
      await runMigrations();
      const bcrypt = (await import("bcryptjs")).default;
      const { eq } = await import("drizzle-orm");
      const { users } = await import("../../drizzle/schema.js");
      const crypto = await import("crypto");
      const db = drizzle(process.env.DATABASE_URL);
      const email = "contato.mvsdistribuidora@gmail.com";
      const passwordHash = await bcrypt.hash("admin123", 12);
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) {
        await db.update(users).set({ role: "admin", passwordHash }).where(eq(users.email, email));
        return res.json({ ok: true, action: "updated", email, password: "admin123" });
      }
      const openId = "local_" + crypto.randomUUID().replace(/-/g, "");
      await db.insert(users).values({ openId, email, name: "Admin", passwordHash, loginMethod: "email", role: "admin", lastSignedIn: new Date() });
      return res.json({ ok: true, action: "created", email, password: "admin123" });
    } catch (err: any) {
      console.error("[setup-admin] erro:", err);
      return res.status(500).json({ error: err?.message, cause: err?.cause?.message });
    }
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
