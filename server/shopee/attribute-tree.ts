/**
 * Low-level wrapper around /api/v2/product/get_attribute_tree.
 *
 * The Shopee endpoint accepts a CSV (NOT a JSON array) of up to 20
 * category_ids per call. We expose a single helper that handles the
 * signature, the URL composition, and the JSON envelope unwrapping —
 * the higher-level cache logic lives in attribute-sync.ts.
 *
 * NOTE: the legacy code in shopee-publish.ts hits `/api/v2/product/get_attributes`
 * which is a non-existent path and returns api_suspended. This file is the
 * correct replacement. See docs/shopee-api-reference.md §4.2.
 */

import crypto from "crypto";
import { ENV } from "../_core/env";
import { ShopeeHttpError } from "./rate-limit";

const SHOPEE_API_BASE = "https://partner.shopeemobile.com";
const ATTRIBUTE_TREE_PATH = "/api/v2/product/get_attribute_tree";

/** Hard cap from the Shopee docs (§4.2 — error_param when > 20). */
export const MAX_CATEGORIES_PER_CALL = 20;

/** Single attribute_value entry as returned by Shopee. */
export interface ApiAttributeValue {
  value_id: number;
  original_value_name?: string;
  display_value_name?: string;
  value_unit?: string;
  child_attribute_list?: any[];
  multi_lang?: Array<{ language: string; name: string }>;
}

/** Single attribute as returned by Shopee. input_type is NUMERIC (1..5). */
export interface ApiAttribute {
  attribute_id: number;
  original_attribute_name?: string;
  display_attribute_name?: string;
  is_mandatory?: boolean;
  input_validation_type?: number;
  format_type?: number;
  input_type?: number;
  max_input_value_number?: number;
  introduction?: string;
  attribute_unit_list?: string[];
  support_search_value?: boolean;
  is_oem?: boolean;
  attribute_value_list?: ApiAttributeValue[];
}

export interface AttributeTreeEntry {
  category_id: number;
  attribute_tree: ApiAttribute[];
}

function sign(path: string, ts: number, accessToken: string, shopId: number): string {
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const baseString = `${partnerId}${path}${ts}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", ENV.shopeePartnerKey).update(baseString).digest("hex");
}

/**
 * Call /api/v2/product/get_attribute_tree for up to 20 categories at once.
 *
 * The category_id_list parameter is serialized as a CSV ("101208,101220"),
 * NOT as JSON — confirmed alive in scripts/test-attribute-tree.ts on shop
 * 1311085163. JSON serialization returns error_param.
 */
export async function fetchAttributeTree(
  accessToken: string,
  shopId: number,
  categoryIds: number[],
  language: string = "pt-BR",
): Promise<AttributeTreeEntry[]> {
  if (!categoryIds.length) return [];
  if (categoryIds.length > MAX_CATEGORIES_PER_CALL) {
    throw new Error(
      `fetchAttributeTree: max ${MAX_CATEGORIES_PER_CALL} categories per call, got ${categoryIds.length}`,
    );
  }
  const ts = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const signature = sign(ATTRIBUTE_TREE_PATH, ts, accessToken, shopId);
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(ts),
    access_token: accessToken,
    shop_id: String(shopId),
    sign: signature,
    category_id_list: categoryIds.join(","),
    language,
  });
  const url = `${SHOPEE_API_BASE}${ATTRIBUTE_TREE_PATH}?${params.toString()}`;
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    throw new ShopeeHttpError(res.status, `get_attribute_tree HTTP ${res.status}`, text);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ShopeeHttpError(res.status, `get_attribute_tree non-JSON response`, text);
  }
  if (parsed.error && parsed.error !== "") {
    const msg = `Shopee ${parsed.error}: ${parsed.message ?? ""}`;
    if (parsed.error === "error_auth" || parsed.error === "error_permission") {
      throw new ShopeeHttpError(401, msg, text);
    }
    throw new ShopeeHttpError(500, msg, text);
  }
  const list: AttributeTreeEntry[] = Array.isArray(parsed.response?.list)
    ? parsed.response.list.map((entry: any) => ({
        category_id: Number(entry?.category_id ?? 0),
        attribute_tree: Array.isArray(entry?.attribute_tree) ? entry.attribute_tree : [],
      }))
    : [];
  return list;
}

/**
 * Mutable indirection so tests can stub the network call without mocking
 * global fetch. SUT must always call __test.fetchAttributeTree.
 */
export const __test = {
  fetchAttributeTree: (
    accessToken: string,
    shopId: number,
    categoryIds: number[],
    language?: string,
  ) => fetchAttributeTree(accessToken, shopId, categoryIds, language),
};

/* =========================================================================
 * Parser — Shopee API shape → frontend-legacy shape
 *
 * The wizard (client/src/pages/ShopeeCriador.tsx) reads input_type as a
 * STRING from a small set: "BRAND" | "DROP_DOWN" | "INT_TYPE" | "FLOAT_TYPE"
 * | (anything else → text input). The API returns input_type as a NUMBER
 * (1..5) plus an input_validation_type.
 *
 * Mapping (Option A — keep wizard untouched):
 *   input_type 1 (SINGLE_DROP_DOWN) | 2 (SINGLE_COMBO_BOX) |
 *   4 (MULTI_DROP_DOWN) | 5 (MULTI_COMBO_BOX)
 *     + has values  → "DROP_DOWN"
 *     + no values   → "TEXT_FIELD" (falls through to free text)
 *   input_type 3 (FREE_TEXT_FIELD)
 *     + validation 1 (INT)   → "INT_TYPE"
 *     + validation 2 (FLOAT) → "FLOAT_TYPE"
 *     + else                 → "TEXT_FIELD"
 *
 * The original numeric input_type is preserved as `_api_input_type` for
 * future migrations that want to expose multi-select etc.
 * ========================================================================= */

export type ParsedInputType =
  | "BRAND"
  | "DROP_DOWN"
  | "INT_TYPE"
  | "FLOAT_TYPE"
  | "TEXT_FIELD";

export interface ParsedAttributeValue {
  value_id: number;
  original_value_name: string;
  display_value_name: string;
  value_unit?: string;
  multi_lang?: Array<{ language: string; name: string }>;
}

export interface ParsedAttribute {
  attribute_id: number;
  original_attribute_name: string;
  display_attribute_name: string;
  is_mandatory: boolean;
  input_type: ParsedInputType;
  attribute_value_list: ParsedAttributeValue[];
  /** API-native fields preserved verbatim for future enhancements. */
  _api_input_type?: number;
  input_validation_type?: number;
  format_type?: number;
  attribute_unit_list?: string[];
  support_search_value?: boolean;
  max_input_value_number?: number;
  is_oem?: boolean;
}

const INPUT_TYPE_DROPDOWN_FAMILY = new Set([1, 2, 4, 5]);

function pickPtBr(multiLang?: Array<{ language: string; name: string }>): string | null {
  if (!Array.isArray(multiLang)) return null;
  const exact = multiLang.find((m) => m.language === "pt-BR" || m.language === "pt-br");
  return exact?.name ?? null;
}

/**
 * Map a single API attribute to the frontend-legacy shape. Brand detection:
 * the synthetic Brand entry from ensureBrandAttribute() is still injected
 * by the router, so this function does NOT relabel "Brand" → "BRAND" — that
 * would create three brand entries (synthetic + relabelled + original). It
 * simply leaves Brand as a regular DROP_DOWN; the router-level dedup is the
 * next phase's concern (see spec: "duplicidade temporária tolerável").
 */
export function parseAttribute(api: ApiAttribute): ParsedAttribute {
  const apiInputType = typeof api.input_type === "number" ? api.input_type : 0;
  const validation = typeof api.input_validation_type === "number" ? api.input_validation_type : 0;
  const valueList: ParsedAttributeValue[] = (api.attribute_value_list ?? []).map((v) => ({
    value_id: Number(v.value_id ?? 0),
    original_value_name: String(v.original_value_name ?? v.display_value_name ?? ""),
    display_value_name: String(
      pickPtBr(v.multi_lang) ?? v.display_value_name ?? v.original_value_name ?? "",
    ),
    ...(v.value_unit !== undefined ? { value_unit: v.value_unit } : {}),
    ...(Array.isArray(v.multi_lang) && v.multi_lang.length > 0
      ? { multi_lang: v.multi_lang }
      : {}),
  }));

  let inputType: ParsedInputType;
  if (INPUT_TYPE_DROPDOWN_FAMILY.has(apiInputType)) {
    inputType = valueList.length > 0 ? "DROP_DOWN" : "TEXT_FIELD";
  } else if (apiInputType === 3) {
    if (validation === 1) inputType = "INT_TYPE";
    else if (validation === 2) inputType = "FLOAT_TYPE";
    else inputType = "TEXT_FIELD";
  } else {
    inputType = valueList.length > 0 ? "DROP_DOWN" : "TEXT_FIELD";
  }

  const original = String(api.original_attribute_name ?? "");
  const display = String(api.display_attribute_name ?? original ?? "");

  return {
    attribute_id: Number(api.attribute_id ?? 0),
    original_attribute_name: original,
    display_attribute_name: display,
    is_mandatory: !!api.is_mandatory,
    input_type: inputType,
    attribute_value_list: valueList,
    _api_input_type: apiInputType,
    ...(api.input_validation_type !== undefined
      ? { input_validation_type: api.input_validation_type }
      : {}),
    ...(api.format_type !== undefined ? { format_type: api.format_type } : {}),
    ...(Array.isArray(api.attribute_unit_list) && api.attribute_unit_list.length > 0
      ? { attribute_unit_list: api.attribute_unit_list }
      : {}),
    ...(api.support_search_value !== undefined
      ? { support_search_value: api.support_search_value }
      : {}),
    ...(api.max_input_value_number !== undefined
      ? { max_input_value_number: api.max_input_value_number }
      : {}),
    ...(api.is_oem !== undefined ? { is_oem: api.is_oem } : {}),
  };
}

export function parseAttributeTreeForFrontend(tree: ApiAttribute[]): ParsedAttribute[] {
  if (!Array.isArray(tree)) return [];
  return tree.map(parseAttribute);
}
