/**
 * Aplica manualmente a migration 0023 (drizzle/0023_product_cache_videos.sql)
 * no MySQL apontado por DATABASE_URL.
 *
 * Diferença vs apply-0019/0020/0021/0022: a migration 0023 usa um stored
 * procedure (mesmo padrão de 0015/0016) e statements separados por
 * `--> statement-breakpoint`. O splitter por `;` dos scripts anteriores
 * quebraria o body do PROCEDURE — então aqui dividimos por
 * `--> statement-breakpoint`, igual o drizzle-kit faz.
 *
 * Verificação final: confirma que product_cache existe E que tem as 3
 * colunas novas (videoUrl, videoTitle, videoLinkUrl).
 *
 * Uso:
 *   pnpm tsx scripts/apply-0023-manually.ts
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "drizzle/0023_product_cache_videos.sql",
);

const TARGET_TABLE = "product_cache";
const EXPECTED_COLUMNS = ["videoUrl", "videoTitle", "videoLinkUrl"];

/**
 * Divide o conteúdo SQL em statements pelo marker `--> statement-breakpoint`
 * (padrão drizzle-kit). Statements vazios ou só com whitespace/comentário
 * de linha são ignorados.
 */
function splitByBreakpoint(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint\s*/g)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length === 0) return false;
      // Ignora bloco que é só comentário de linha
      const noComments = s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      return noComments.length > 0;
    });
}

function summarize(stmt: string): string {
  const oneLine = stmt.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? oneLine.slice(0, 97) + "..." : oneLine;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ausente no ambiente.");
  }

  console.log("=== APLICAÇÃO MANUAL DA MIGRATION 0023 ===");
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
  try {
    const url = new URL(process.env.DATABASE_URL!);
    console.log(`Host: ${url.host}  Path: ${url.pathname}`);
  } catch {
    console.log("DATABASE_URL não é uma URL parseável.");
  }

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
      console.log(`     sqlState: ${e.sqlState}`);
      console.log(`     message: ${e.message}`);
      errors.push({ index: idx + 1, summary: head, message: e.message });
      errCount++;
    }
  }

  // Verificação: tabela e colunas
  console.log(`\n--- Verificação: SHOW COLUMNS FROM ${TARGET_TABLE} LIKE 'video%' ---`);
  let presentColumns: string[] = [];
  try {
    const [rows] = await conn.query(
      `SHOW COLUMNS FROM \`${TARGET_TABLE}\` LIKE 'video%'`,
    );
    presentColumns = (rows as any[]).map((r) => r.Field as string).filter(Boolean);
    if (presentColumns.length === 0) {
      console.log("  (nenhuma coluna video* encontrada)");
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

  console.log("\nColunas esperadas em product_cache:");
  let allPresent = true;
  for (const c of EXPECTED_COLUMNS) {
    const present = presentColumns.includes(c);
    if (!present) allPresent = false;
    console.log(`  ${present ? "✅" : "❌"} ${c}`);
  }

  if (allPresent && errCount === 0) {
    console.log("\n✅ Migration 0023 aplicada com sucesso.");
    process.exit(0);
  } else if (allPresent && errCount > 0) {
    console.log(
      "\n⚠️  Colunas existem, mas houve erros em alguns statements (revisar acima).",
    );
    process.exit(1);
  } else {
    console.log("\n❌ Migration 0023 NÃO foi totalmente aplicada — revisar erros.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERRO FATAL:", e);
  process.exit(1);
});
