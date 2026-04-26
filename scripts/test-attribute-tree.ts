import "dotenv/config";
import crypto from "crypto";
import mysql from "mysql2/promise";

const SHOPEE_API_BASE = "https://partner.shopeemobile.com";
const PATH = "/api/v2/product/get_attribute_tree";
const SHOP_ID = 1311085163;

type TestCase = {
  label: string;
  categoryIdList: number[];
  language: string;
};

const TEST_CASES: TestCase[] = [
  {
    label: "1) Categoria única (101208) — language=pt-BR",
    categoryIdList: [101208],
    language: "pt-BR",
  },
  {
    label: "2) Categoria única (101208) — language=en (verificar diferença de idioma)",
    categoryIdList: [101208],
    language: "en",
  },
  {
    label: "3) Múltiplas categorias [101208, 101220, 100800] — language=pt-BR",
    categoryIdList: [101208, 101220, 100800],
    language: "pt-BR",
  },
];

function generateSignature(
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: number,
  partnerId: number,
  partnerKey: string,
): string {
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

async function callGetAttributeTree(
  categoryIdList: number[],
  language: string,
  accessToken: string,
  partnerId: number,
  partnerKey: string,
) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignature(PATH, timestamp, accessToken, SHOP_ID, partnerId, partnerKey);
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(SHOP_ID),
    sign,
    category_id_list: categoryIdList.join(","),
    language,
  });
  const url = `${SHOPEE_API_BASE}${PATH}?${params.toString()}`;
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { url, status: res.status, parsed, text };
}

type Outcome = "alive" | "suspended" | "unexpected" | "non-json";

function classify(status: number, parsed: any): Outcome {
  if (!parsed) return "non-json";
  const err: string = parsed.error ?? "";
  if (err === "" && status === 200 && Array.isArray(parsed.response?.list)) {
    return "alive";
  }
  if (
    err === "api_suspended" ||
    err === "permission_denied" ||
    err === "error_permission" ||
    err === "error_auth"
  ) {
    return "suspended";
  }
  return "unexpected";
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL ausente");
  const partnerId = parseInt(process.env.SHOPEE_PARTNER_ID ?? "", 10);
  const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? "";
  if (!partnerId || !partnerKey) {
    throw new Error("SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY ausentes no .env");
  }

  const conn = await mysql.createConnection({
    uri: process.env.DATABASE_URL,
    ssl: false as any,
  });
  const [rows] = await conn.execute(
    "SELECT accessToken FROM shopee_accounts WHERE shopId = ? LIMIT 1",
    [SHOP_ID],
  );
  await conn.end();
  const account = (rows as any[])[0];
  if (!account) throw new Error(`Nenhuma conta com shopId=${SHOP_ID}`);
  const accessToken: string = account.accessToken;

  const finals: Array<{
    label: string;
    outcome: Outcome;
    status: number;
    error: string;
    detail: string;
  }> = [];

  for (const tc of TEST_CASES) {
    console.log(`\n--- ${tc.label} ---`);
    const { url, status, parsed, text } = await callGetAttributeTree(
      tc.categoryIdList,
      tc.language,
      accessToken,
      partnerId,
      partnerKey,
    );
    console.log("URL:", url.replace(accessToken, "<TOKEN>"));
    console.log("HTTP:", status);

    if (!parsed) {
      console.log("Body (não-JSON, primeiros 500 chars):", text.slice(0, 500));
      finals.push({
        label: tc.label,
        outcome: "non-json",
        status,
        error: "non-json",
        detail: text.slice(0, 200),
      });
      continue;
    }

    const err: string = parsed.error ?? "";
    const message: string = parsed.message ?? "";
    const requestId: string = parsed.request_id ?? "";
    console.log("error:", `"${err}"`);
    console.log("message:", message);
    console.log("request_id:", requestId);

    const list: any[] = Array.isArray(parsed.response?.list) ? parsed.response.list : [];
    console.log("response.list.length:", list.length);

    let detail = "";
    if (list.length > 0) {
      const first = list[0];
      const attrs: any[] = Array.isArray(first?.attribute_tree) ? first.attribute_tree : [];
      console.log(`  category_id (1ª): ${first?.category_id}`);
      console.log(`  attribute_tree.length (1ª categoria): ${attrs.length}`);
      const samples = attrs.slice(0, 3).map((a) => ({
        attribute_id: a.attribute_id,
        name: a.display_attribute_name ?? a.original_attribute_name ?? a.name,
        is_mandatory: a.is_mandatory ?? a.mandatory,
        input_type: a.input_type,
        input_validation_type: a.input_validation_type,
        format_type: a.format_type,
        support_search_value: a.support_search_value,
        attribute_value_list_count: Array.isArray(a.attribute_value_list)
          ? a.attribute_value_list.length
          : 0,
        attribute_value_sample: Array.isArray(a.attribute_value_list)
          ? a.attribute_value_list.slice(0, 2).map((v: any) => ({
              value_id: v.value_id,
              name: v.display_value_name ?? v.original_value_name ?? v.name,
              value_unit: v.value_unit,
            }))
          : [],
      }));
      console.log("  Exemplos (até 3 atributos):");
      console.log(JSON.stringify(samples, null, 2));
      detail = `cats=${list.length} attrs1ª=${attrs.length}`;
    } else {
      console.log("  RAW response:", JSON.stringify(parsed.response).slice(0, 400));
      detail = "list vazia";
    }

    const outcome = classify(status, parsed);
    finals.push({ label: tc.label, outcome, status, error: err, detail });
  }

  console.log("\n=== RESUMO ===");
  for (const r of finals) {
    console.log(
      `[${r.outcome.toUpperCase()}] HTTP=${r.status}  error="${r.error}"  ${r.detail}  ::  ${r.label}`,
    );
  }

  const anyAlive = finals.some((r) => r.outcome === "alive");
  const anySuspended = finals.some((r) => r.outcome === "suspended");
  const anyUnexpected = finals.some(
    (r) => r.outcome === "unexpected" || r.outcome === "non-json",
  );

  console.log("\n=== VEREDITO FINAL ===");
  if (anyAlive) {
    console.log("✅ get_attribute_tree está VIVO (HTTP 200, sem erro, atributos retornados)");
  } else if (anySuspended && !anyAlive) {
    console.log(
      "❌ get_attribute_tree está SUSPENSO (api_suspended/permission_denied/error_auth)",
    );
  } else if (anyUnexpected) {
    console.log("⚠️  Resposta inesperada — verificar detalhes acima.");
  } else {
    console.log("⚠️  Nenhum caso classificado — investigar logs.");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e);
  process.exit(1);
});
