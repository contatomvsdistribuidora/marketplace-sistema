/**
 * Aplica manualmente a migration 0020 (drizzle/0020_multi_product_listings.sql)
 * no MySQL apontado por DATABASE_URL.
 *
 * Motivo: o pipeline drizzle-kit migrate não roda automaticamente no deploy do
 * Railway e o _journal.json está desincronizado desde a 0015. Mesmo padrão das
 * migrations 0017/0018/0019 — SQL idempotente (CREATE TABLE IF NOT EXISTS) +
 * script tsx ad-hoc, espelhando scripts/apply-0019-manually.ts.
 *
 * O script:
 *   1. Lê o SQL bruto da migration.
 *   2. Conecta no MySQL via DATABASE_URL.
 *   3. Divide o SQL em statements individuais, ignorando comentários `--` e
 *      respeitando strings entre aspas / identificadores entre backticks.
 *   4. Executa cada statement em sequência, imprimindo OK/erro.
 *   5. Confirma com SHOW TABLES LIKE 'multi_product_listings'.
 *
 * Uso:
 *   pnpm tsx scripts/apply-0020-manually.ts
 *
 * NÃO mexe em _journal.json nem em código de produção.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

const MIGRATION_PATH = path.resolve(
  process.cwd(),
  "drizzle/0020_multi_product_listings.sql",
);

const EXPECTED_TABLES = [
  "multi_product_listings",
];

/**
 * Divide o conteúdo SQL em statements individuais.
 *
 * Regras:
 *   - `;` fora de string/identificador/comentário encerra o statement.
 *   - `-- ...\n` é comentário de linha (descartado).
 *   - `/* ... *​/` é comentário de bloco (descartado).
 *   - Strings: '...' e "..." (com escape `\\` e `''` / `""` de duplicação).
 *   - Identificadores: `...` (com escape ` `` ` de duplicação).
 *   - Statements vazios (só whitespace) são ignorados.
 */
function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  type Mode = "code" | "lineComment" | "blockComment" | "single" | "double" | "backtick";
  let mode: Mode = "code";

  while (i < n) {
    const c = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";

    if (mode === "lineComment") {
      if (c === "\n") mode = "code";
      i++;
      continue;
    }

    if (mode === "blockComment") {
      if (c === "*" && next === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (mode === "single") {
      buf += c;
      if (c === "\\" && next) {
        buf += next;
        i += 2;
        continue;
      }
      if (c === "'" && next === "'") {
        buf += next;
        i += 2;
        continue;
      }
      if (c === "'") {
        mode = "code";
      }
      i++;
      continue;
    }

    if (mode === "double") {
      buf += c;
      if (c === "\\" && next) {
        buf += next;
        i += 2;
        continue;
      }
      if (c === '"' && next === '"') {
        buf += next;
        i += 2;
        continue;
      }
      if (c === '"') {
        mode = "code";
      }
      i++;
      continue;
    }

    if (mode === "backtick") {
      buf += c;
      if (c === "`" && next === "`") {
        buf += next;
        i += 2;
        continue;
      }
      if (c === "`") {
        mode = "code";
      }
      i++;
      continue;
    }

    // mode === "code"
    if (c === "-" && next === "-") {
      mode = "lineComment";
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      mode = "blockComment";
      i += 2;
      continue;
    }
    if (c === "'") {
      mode = "single";
      buf += c;
      i++;
      continue;
    }
    if (c === '"') {
      mode = "double";
      buf += c;
      i++;
      continue;
    }
    if (c === "`") {
      mode = "backtick";
      buf += c;
      i++;
      continue;
    }
    if (c === ";") {
      const stmt = buf.trim();
      if (stmt.length > 0) out.push(stmt);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }

  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

function summarize(stmt: string): string {
  const oneLine = stmt.replace(/\s+/g, " ").trim();
  return oneLine.length > 100 ? oneLine.slice(0, 97) + "..." : oneLine;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ausente no ambiente.");
  }

  console.log("=== APLICAÇÃO MANUAL DA MIGRATION 0020 ===");
  console.log(`Arquivo: ${MIGRATION_PATH}`);

  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`Arquivo de migration não encontrado: ${MIGRATION_PATH}`);
  }
  const raw = fs.readFileSync(MIGRATION_PATH, "utf8");
  const statements = splitSqlStatements(raw);
  console.log(`Statements detectados: ${statements.length}`);

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: false as any,
    multipleStatements: false,
  });

  // Mostra qual banco está sendo afetado.
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

  // Confirma criação.
  console.log("\n--- Verificação: SHOW TABLES LIKE 'multi_product_listings' ---");
  let presentTables: string[] = [];
  try {
    const [rows] = await conn.query(
      "SHOW TABLES LIKE 'multi_product_listings'",
    );
    presentTables = (rows as any[])
      .map((r) => Object.values(r)[0] as string)
      .filter(Boolean);
    if (presentTables.length === 0) {
      console.log("  (nenhuma tabela encontrada)");
    } else {
      for (const t of presentTables) console.log(`  - ${t}`);
    }
  } catch (e: any) {
    console.log(`  ❌ Falha ao listar tabelas: ${e.message}`);
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

  console.log("\nTabelas esperadas:");
  let allPresent = true;
  for (const t of EXPECTED_TABLES) {
    const present = presentTables.includes(t);
    if (!present) allPresent = false;
    console.log(`  ${present ? "✅" : "❌"} ${t}`);
  }

  if (allPresent && errCount === 0) {
    console.log("\n✅ Migration 0020 aplicada com sucesso.");
    process.exit(0);
  } else if (allPresent && errCount > 0) {
    console.log(
      "\n⚠️  Tabelas existem, mas houve erros em alguns statements (revisar acima).",
    );
    process.exit(1);
  } else {
    console.log("\n❌ Migration 0020 NÃO foi totalmente aplicada — revisar erros.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERRO FATAL:", e);
  process.exit(1);
});
