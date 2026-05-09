/**
 * Backfill da coluna shopee_products.brand a partir de get_item_base_info.
 *
 * Como rodar:
 *   pnpm exec tsx scripts/backfill-shopee-brands.ts
 *
 * Estrategia:
 *   1. SELECT itemId, shopeeAccountId FROM shopee_products WHERE brand IS NULL
 *   2. Agrupa por shopeeAccountId (cada conta tem token/shopId proprios).
 *   3. Pra cada conta: getValidToken -> getItemBaseInfo em batches de 50.
 *   4. Pra cada item retornado:
 *        - brand.brand_id > 0  -> UPDATE com { brand_id, original_brand_name }
 *        - sem brand           -> UPDATE com SENTINELA { brand_id: 0, original_brand_name: "No Brand" }
 *      A sentinela diferencia "ja sincronizado, sem marca" de "ainda nao
 *      processado". Re-runs com filtro `WHERE brand IS NULL` pulam quem ja
 *      foi tocado (zero custo de API). Para LEITURA (UI/filtro), tratamos
 *      brand_id <= 0 como "sem marca".
 *   5. 500ms de pausa entre batches pra nao bater em rate-limit.
 *   6. Log progresso e summary no final.
 */
import "dotenv/config";
import { db as sharedDb } from "../server/db";
import { sql } from "drizzle-orm";
import * as shopee from "../server/shopee";

const BATCH_SIZE = 50;
const SLEEP_MS = 500;

type ProductRow = { itemId: number; shopeeAccountId: number };

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const startedAt = Date.now();

  console.log("=== Backfill shopee_products.brand ===\n");

  // 1. Carrega todos os candidatos (brand NULL)
  const rowsRaw: any = await sharedDb.execute(sql`
    SELECT itemId, shopeeAccountId
    FROM shopee_products
    WHERE brand IS NULL
    ORDER BY shopeeAccountId, itemId
  `);
  const candidates: ProductRow[] = ((rowsRaw as any)[0] ?? []).map((r: any) => ({
    itemId: Number(r.itemId),
    shopeeAccountId: Number(r.shopeeAccountId),
  })).filter((r: ProductRow) => Number.isFinite(r.itemId) && r.itemId > 0);

  if (candidates.length === 0) {
    console.log("Nada pra fazer — todos os produtos ja tem brand sincronizado.");
    process.exit(0);
  }

  // 2. Agrupa por conta
  const byAccount = new Map<number, number[]>();
  for (const r of candidates) {
    let arr = byAccount.get(r.shopeeAccountId);
    if (!arr) { arr = []; byAccount.set(r.shopeeAccountId, arr); }
    arr.push(r.itemId);
  }

  const totalBatches = Array.from(byAccount.values())
    .reduce((sum, ids) => sum + Math.ceil(ids.length / BATCH_SIZE), 0);
  console.log(`Total: ${candidates.length} produtos / ${byAccount.size} conta(s) / ${totalBatches} batches\n`);

  let processedBatches = 0;
  let totalUpdated = 0;
  let totalNoBrand = 0;
  let totalFailures = 0;
  const brandHistogram = new Map<string, number>();

  // 3. Pra cada conta
  for (const [accountId, itemIds] of byAccount.entries()) {
    let accessToken: string;
    let shopId: number;
    try {
      const tok = await shopee.getValidToken(accountId);
      accessToken = tok.accessToken;
      shopId = tok.shopId;
    } catch (e: any) {
      console.warn(`! Conta ${accountId}: token invalido (${e.message}). Pulando ${itemIds.length} produtos.`);
      totalFailures += itemIds.length;
      continue;
    }

    // 4. Batches de 50
    for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
      const slice = itemIds.slice(i, i + BATCH_SIZE);
      processedBatches++;

      let items: any[] = [];
      try {
        items = await shopee.getItemBaseInfo(accessToken, shopId, slice);
      } catch (e: any) {
        console.warn(`! [${processedBatches}/${totalBatches}] Conta=${accountId} Batch falhou: ${e.message}`);
        totalFailures += slice.length;
        await sleep(SLEEP_MS);
        continue;
      }

      let updated = 0;
      let noBrand = 0;
      for (const it of items) {
        const itemId = Number(it.item_id);
        if (!Number.isFinite(itemId) || itemId <= 0) continue;
        const b = it.brand;
        const hasBrand = b && typeof b.brand_id === "number" && b.brand_id > 0;
        const brandJson = hasBrand
          ? { brand_id: b.brand_id, original_brand_name: String(b.original_brand_name ?? "") }
          : { brand_id: 0, original_brand_name: "No Brand" };  // sentinela
        await sharedDb.execute(sql`
          UPDATE shopee_products
          SET brand = ${JSON.stringify(brandJson)}, updatedAt = NOW()
          WHERE itemId = ${itemId} AND shopeeAccountId = ${accountId}
        `);
        if (hasBrand) {
          updated++;
          const k = brandJson.original_brand_name || `id:${brandJson.brand_id}`;
          brandHistogram.set(k, (brandHistogram.get(k) ?? 0) + 1);
        } else {
          noBrand++;
        }
      }

      // Items que NAO voltaram da API (deletados na Shopee?) — contabiliza como falha
      const missing = slice.length - items.length;
      if (missing > 0) totalFailures += missing;

      totalUpdated += updated;
      totalNoBrand += noBrand;

      console.log(
        `[${processedBatches}/${totalBatches}] Conta=${accountId} ` +
        `Batch=${Math.floor(i / BATCH_SIZE) + 1} ` +
        `Atualizados=${updated}/${slice.length} SemMarca=${noBrand} ` +
        (missing > 0 ? `Faltando=${missing} ` : "") +
        `(total: ${totalUpdated} OK, ${totalNoBrand} sem marca)`
      );

      await sleep(SLEEP_MS);
    }
  }

  // 6. Summary
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n=== Backfill completo em ${elapsed}s ===`);
  console.log(`  Atualizados:  ${totalUpdated}`);
  console.log(`  Sem marca:    ${totalNoBrand}`);
  console.log(`  Falhas:       ${totalFailures}`);
  console.log(`  Total processado: ${totalUpdated + totalNoBrand + totalFailures} / ${candidates.length}`);

  // 7. Top 10 marcas
  if (brandHistogram.size > 0) {
    const sorted = Array.from(brandHistogram.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log(`\nTop 10 marcas:`);
    for (const [name, count] of sorted) {
      console.log(`  ${count.toString().padStart(5)}  ${name}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error("Backfill falhou:", e); process.exit(1); });
