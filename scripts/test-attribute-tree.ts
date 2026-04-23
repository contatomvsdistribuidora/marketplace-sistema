import "dotenv/config";
import crypto from "crypto";

const SHOPEE_API_BASE = "https://partner.shopeemobile.com";
const PATH = "/api/v2/product/get_attribute_tree";
const CATEGORY_ID = 101208;
const LANGUAGE = "pt-br";
const DEFAULT_SHOP_ID = 1311085163;

/**
 * HMAC-SHA256 — cópia local da assinatura usada em server/shopee.ts:26
 * (inline para evitar import transitivo de server/db.ts, que abre pool MySQL)
 */
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

async function main() {
  const accessToken = process.env.SHOPEE_TEST_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("❌ Defina SHOPEE_TEST_ACCESS_TOKEN no env para rodar este teste");
    process.exit(1);
  }

  const shopId = parseInt(process.env.SHOPEE_TEST_SHOP_ID ?? String(DEFAULT_SHOP_ID), 10);
  const partnerId = parseInt(process.env.SHOPEE_PARTNER_ID ?? "", 10);
  const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? "";
  if (!partnerId || !partnerKey) {
    console.error("❌ SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY ausentes no .env");
    process.exit(1);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const sign = generateSignature(PATH, timestamp, accessToken, shopId, partnerId, partnerKey);

  const params = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
    category_id: String(CATEGORY_ID),
    language: LANGUAGE,
  });

  const url = `${SHOPEE_API_BASE}${PATH}?${params.toString()}`;

  console.log("=== REQUEST ===");
  console.log("URL path:", PATH);
  console.log("partner_id:", partnerId);
  console.log("shop_id:", shopId);
  console.log("timestamp:", timestamp);
  console.log("category_id:", CATEGORY_ID);
  console.log("language:", LANGUAGE);
  console.log("access_token (primeiros 12):", accessToken.slice(0, 12) + "...");
  console.log("sign:", sign);

  const res = await fetch(url, { method: "GET" });
  const status = res.status;
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* não-JSON */ }

  console.log("\n=== RESPONSE ===");
  console.log("HTTP status:", status);
  if (parsed) {
    console.log("Body (JSON completo):");
    console.log(JSON.stringify(parsed, null, 2));
    console.log("\n--- campos principais ---");
    console.log("error:", parsed.error);
    console.log("message:", parsed.message);
    console.log("request_id:", parsed.request_id);
    console.log("response:", JSON.stringify(parsed.response, null, 2));
  } else {
    console.log("Body (texto bruto):");
    console.log(text);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e);
  process.exit(1);
});
