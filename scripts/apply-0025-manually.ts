/**
 * Aplica manualmente a migration 0025 (drizzle/0025_multi_product_wizard_state.sql)
 * no MySQL apontado por DATABASE_URL.
 *
 * Uso:
 *   pnpm tsx scripts/apply-0025-manually.ts
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "drizzle/0025_multi_product_wizard_state.sql",
);

const TARGET_TABLE = "multi_product_listings";
const EXPECTED_COLUMNS = ["wizard_state_json"];

function splitByBreakpoint(sql: string): string[] {
  const SENTINEL = "\x00BREAK\x00";
  const markerLine = /^[ \t]*-->\s*statement-breakpoint[ \t]*$/gm;
  const withSentinel = sql.replace(markerLine, SENTINEL);
  const stripped = withSentinel
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.substring(0, idx) : line;
    })
    .join("\n");
  return stripped
    .split(SENTINEL)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function summarize(stmt: string): string {
  const oneLine = stmt.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? oneLine.slice(0, 97) + "..." : oneLine;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ausente no ambiente.");
  }

  console.log("=== APLICAÇÃO MANUAL DA MIGRATION 0025 ===");
  console.log(`Arquivo: ${MIGRATION_PATH}`);

  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`Arquivo de migration não encontrado: ${MIGRATION_PATH}`);
  }
  const raw = fs.readFileSync(MIGRATION_PATH, "utf8");
  const statements = splitByBreakpoint(raw);
  console.log(`Statements detectados: ${statements.length}`);

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: false as any,
    multipleStatements: false,
  });

  const [dbRows] = await conn.execute("SELECT DATABASE() AS db");
  const schemaName: string = (dbRows as any[])[0]?.db ?? "";
  console.log(`Conectado em database: "${schemaName}"`);

  let okCount = 0;
  let errCount = 0;
  const errors: Array<{ index: number; summary: string; message: string }> = [];

  for (let idx = 0; idx < statements.length; idx++) {
    const stmt = statements[idx];
    const head = summarize(stmt);
    process.stdout.write(`\n[${idx + 1}/${statements.length}] ${head}\n`);
    try {
      await conn.query(stmt);
      console.log("  ✅ OK");
      okCount++;
    } catch (e: any) {
      console.log("  ❌ ERRO");
      console.log(`     code:    ${e.code}`);
      console.log(`     errno:   ${e.errno}`);
      console.log(`     message: ${e.message}`);
      errors.push({ index: idx + 1, summary: head, message: e.message });
      errCount++;
    }
  }

  console.log(`\n--- Verificação: SHOW COLUMNS FROM ${TARGET_TABLE} LIKE 'wizard%' ---`);
  let presentColumns: string[] = [];
  try {
    const [rows] = await conn.query(
      `SHOW COLUMNS FROM \`${TARGET_TABLE}\` LIKE 'wizard%'`,
    );
    presentColumns = (rows as any[]).map((r) => r.Field as string).filter(Boolean);
    if (presentColumns.length === 0) {
      console.log("  (nenhuma coluna wizard* encontrada)");
    } else {
      for (const c of presentColumns) console.log(`  - ${c}`);
    }
  } catch (e: any) {
    console.log(`  ❌ Falha ao listar colunas: ${e.message}`);
  }

  await conn.end();

  console.log("\n=== RELATÓRIO ===");
  console.log(`Statements OK:    ${okCount}`);
  console.log(`Statements ERRO:  ${errCount}`);
  if (errors.length > 0) {
    console.log("\nErros:");
    for (const e of errors) {
      console.log(`  - [#${e.index}] ${e.summary}`);
      console.log(`    -> ${e.message}`);
    }
  }

  console.log("\nColunas esperadas em multi_product_listings:");
  let allPresent = true;
  for (const c of EXPECTED_COLUMNS) {
    const present = presentColumns.includes(c);
    if (!present) allPresent = false;
    console.log(`  ${present ? "✅" : "❌"} ${c}`);
  }

  if (allPresent && errCount === 0) {
    console.log("\n✅ Migration 0025 aplicada com sucesso.");
    process.exit(0);
  } else {
    console.log("\n❌ Migration 0025 NÃO aplicada totalmente — revisar.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERRO FATAL:", e);
  process.exit(1);
});
