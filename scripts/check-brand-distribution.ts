import "dotenv/config";
import { db as sharedDb } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const stats: any = await sharedDb.execute(sql`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN brand IS NULL THEN 1 ELSE 0 END) as semMarca,
      SUM(CASE WHEN brand IS NOT NULL THEN 1 ELSE 0 END) as comMarca
    FROM shopee_products
  `);
  console.log("=== Estatisticas ===");
  console.log(JSON.stringify((stats as any)[0]?.[0]));

  const top: any = await sharedDb.execute(sql`
    SELECT
      JSON_UNQUOTE(JSON_EXTRACT(brand, '$.original_brand_name')) as marca,
      COUNT(*) as total
    FROM shopee_products
    WHERE brand IS NOT NULL
    GROUP BY marca
    ORDER BY total DESC
    LIMIT 15
  `);
  console.log("\n=== Top 15 Marcas Shopee ===");
  for (const r of (top as any)[0] ?? []) {
    console.log(`  ${String(r.total).padStart(4)} ${r.marca}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
