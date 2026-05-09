import "dotenv/config";
import { db as sharedDb } from "../server/db";
import { sql } from "drizzle-orm";

async function colExists(table: string, col: string): Promise<boolean> {
  const r: any = await sharedDb.execute(sql`SHOW COLUMNS FROM ${sql.raw(table)} LIKE ${col}`);
  return Array.isArray((r as any)[0]) && (r as any)[0].length > 0;
}

async function main() {
  const hasQ = await colExists("multi_product_listings", "quality_level");
  const hasT = await colExists("multi_product_listings", "unfinished_tasks");

  if (!hasQ) {
    await sharedDb.execute(sql`ALTER TABLE multi_product_listings ADD COLUMN quality_level int NULL`);
    console.log("✅ added quality_level");
  } else {
    console.log("• quality_level já existe");
  }
  if (!hasT) {
    await sharedDb.execute(sql`ALTER TABLE multi_product_listings ADD COLUMN unfinished_tasks json NULL`);
    console.log("✅ added unfinished_tasks");
  } else {
    console.log("• unfinished_tasks já existe");
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
