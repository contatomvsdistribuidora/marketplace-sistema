import "dotenv/config";
import { db as sharedDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  // Idempotente: checa se ja existe.
  const exists: any = await sharedDb.execute(sql`
    SELECT COLUMN_NAME FROM information_schema.columns
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'shopee_products'
      AND COLUMN_NAME = 'brand'
  `);
  if (((exists as any)[0] ?? []).length > 0) {
    console.log("✔ Coluna brand ja existe — nada a fazer.");
    process.exit(0);
  }

  console.log("Aplicando: ALTER TABLE shopee_products ADD COLUMN brand JSON NULL");
  await sharedDb.execute(sql`ALTER TABLE shopee_products ADD COLUMN brand JSON NULL`);
  console.log("✔ Coluna brand adicionada.");

  const cols: any = await sharedDb.execute(sql`SHOW COLUMNS FROM shopee_products LIKE 'brand'`);
  console.log("SHOW COLUMNS:", JSON.stringify((cols as any)[0]));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
