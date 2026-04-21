import "dotenv/config";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/mysql2";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

async function main() {
  const db = drizzle(process.env.DATABASE_URL!);
  const email = "contato.mvsdistribuidora@gmail.com";

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const passwordHash = await bcrypt.hash("admin123", 12);

  if (existing.length > 0) {
    await db.update(users).set({ role: "admin", passwordHash }).where(eq(users.email, email));
    console.log("Usuário já existia — role e senha atualizados para admin.");
  } else {
    const openId = "local_" + crypto.randomUUID().replace(/-/g, "");
    await db.insert(users).values({
      openId,
      email,
      name: "Admin",
      passwordHash,
      loginMethod: "email",
      role: "admin",
      lastSignedIn: new Date(),
    });
    console.log("Usuário admin criado com sucesso.");
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  console.log("Resultado:", user);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
