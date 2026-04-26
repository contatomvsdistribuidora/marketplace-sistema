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

/**
 * Single attribute_value entry as returned by Shopee.
 *
 * Real wire shape (confirmed against /api/v2/product/get_attribute_tree
 * responses persisted in shopee_category_attribute_cache):
 *   { name: "Multipack", value_id: 358,
 *     multi_lang: [{ value: "Pacotes Múltiplos", language: "pt-BR" }] }
 *
 * Note multi_lang items use `value` for the localized string — NOT `name`.
 * Original/display fields (`original_value_name`, `display_value_name`) are
 * accepted for back-compat with the older shape used by tests/fixtures.
 */
export interface ApiAttributeValue {
  value_id: number;
  /** Real API field — the EN-equivalent value name. */
  name?: string;
  /** Legacy shape used by some fixtures/tests. */
  original_value_name?: string;
  display_value_name?: string;
  value_unit?: string;
  child_attribute_list?: any[];
  multi_lang?: Array<{
    language: string;
    /** Real API field for the localized string. */
    value?: string;
    /** Legacy shape used by some fixtures/tests. */
    name?: string;
  }>;
}

/**
 * Single attribute as returned by Shopee.
 *
 * Real wire shape (confirmed against shopee_category_attribute_cache):
 *   { name: "pack type", mandatory: false,
 *     multi_lang: [{ value: "Dimensões do Produto", language: "pt-BR" }],
 *     attribute_id: 100016,
 *     attribute_info: { input_type: 1, input_validation_type: 0,
 *                       format_type: 1, support_search_value: false,
 *                       is_oem: false, max_value_count: 5 },
 *     attribute_value_list: [...] }
 *
 * The numeric switches (input_type, input_validation_type, format_type) live
 * NESTED under `attribute_info`, not at the top level. Top-level legacy
 * fields are still accepted so existing fixtures keep working.
 */
export interface ApiAttribute {
  attribute_id: number;
  /** Real API field — the EN-equivalent attribute name. */
  name?: string;
  /** Real API field — equivalent of legacy is_mandatory. */
  mandatory?: boolean;
  /** Real API nested bag with the numeric switches. */
  attribute_info?: {
    input_type?: number;
    input_validation_type?: number;
    format_type?: number;
    support_search_value?: boolean;
    is_oem?: boolean;
    max_input_value_number?: number;
    max_value_count?: number;
    /** Real API: lives nested under attribute_info when format_type=2
     *  (QUANTITATIVE_WITH_UNIT). Top-level fallback kept for legacy fixtures. */
    attribute_unit_list?: string[];
  };
  multi_lang?: Array<{
    language: string;
    value?: string;
    name?: string;
  }>;
  /** Legacy shape (top-level) — used by tests and ensureBrandAttribute. */
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

function pickPtBr(
  multiLang?: Array<{ language: string; value?: string; name?: string }>,
): string | null {
  if (!Array.isArray(multiLang)) return null;
  const exact = multiLang.find((m) => m.language === "pt-BR" || m.language === "pt-br");
  if (!exact) return null;
  // Real API shape uses `value`; legacy fixtures use `name`.
  return (exact.value ?? exact.name) ?? null;
}

/**
 * Map a single API attribute to the frontend-legacy shape. Handles both the
 * real wire shape (top-level `name`/`mandatory`, nested `attribute_info`) and
 * the legacy top-level shape used by older tests/fixtures and the synthetic
 * Brand entry from ensureBrandAttribute(). Brand detection is deferred to the
 * router-level dedup; this function just leaves Brand as a regular DROP_DOWN.
 */
export function parseAttribute(api: ApiAttribute): ParsedAttribute {
  const info = api.attribute_info ?? {};
  const apiInputType =
    typeof info.input_type === "number"
      ? info.input_type
      : typeof api.input_type === "number"
        ? api.input_type
        : 0;
  const validation =
    typeof info.input_validation_type === "number"
      ? info.input_validation_type
      : typeof api.input_validation_type === "number"
        ? api.input_validation_type
        : 0;
  const formatType =
    typeof info.format_type === "number" ? info.format_type : api.format_type;
  const supportSearch =
    typeof info.support_search_value === "boolean"
      ? info.support_search_value
      : api.support_search_value;
  const isOem =
    typeof info.is_oem === "boolean" ? info.is_oem : api.is_oem;
  const maxInputValue =
    typeof info.max_input_value_number === "number"
      ? info.max_input_value_number
      : api.max_input_value_number;

  const valueList: ParsedAttributeValue[] = (api.attribute_value_list ?? []).map((v) => {
    // Real API: { name, multi_lang:[{value, language}] }.
    // Legacy:   { original_value_name, display_value_name, multi_lang:[{name, language}] }.
    const original = String(v.name ?? v.original_value_name ?? v.display_value_name ?? "");
    const display = String(
      pickPtBr(v.multi_lang) ?? v.display_value_name ?? v.name ?? v.original_value_name ?? "",
    );
    return {
      value_id: Number(v.value_id ?? 0),
      original_value_name: original,
      display_value_name: display,
      ...(v.value_unit !== undefined ? { value_unit: v.value_unit } : {}),
      ...(Array.isArray(v.multi_lang) && v.multi_lang.length > 0
        ? { multi_lang: v.multi_lang as Array<{ language: string; name: string }> }
        : {}),
    };
  });

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

  // Real API: top-level `name` is the EN original; multi_lang carries pt-BR.
  // Legacy:   original_attribute_name + display_attribute_name top-level.
  const original = String(api.name ?? api.original_attribute_name ?? "");
  const display = String(
    pickPtBr(api.multi_lang) ?? api.display_attribute_name ?? original ?? "",
  );
  const isMandatory =
    typeof api.mandatory === "boolean" ? api.mandatory : !!api.is_mandatory;

  return {
    attribute_id: Number(api.attribute_id ?? 0),
    original_attribute_name: original,
    display_attribute_name: display,
    is_mandatory: isMandatory,
    input_type: inputType,
    attribute_value_list: valueList,
    _api_input_type: apiInputType,
    ...(validation !== 0 || api.input_validation_type !== undefined || info.input_validation_type !== undefined
      ? { input_validation_type: validation }
      : {}),
    ...(formatType !== undefined ? { format_type: formatType } : {}),
    ...((() => {
      // Real API places attribute_unit_list under `attribute_info` (only when
      // format_type=2). Legacy fixtures keep it at the top level — fall back.
      const unitList =
        Array.isArray(info.attribute_unit_list) && info.attribute_unit_list.length > 0
          ? info.attribute_unit_list
          : Array.isArray(api.attribute_unit_list) && api.attribute_unit_list.length > 0
            ? api.attribute_unit_list
            : undefined;
      return unitList ? { attribute_unit_list: unitList } : {};
    })()),
    ...(supportSearch !== undefined ? { support_search_value: supportSearch } : {}),
    ...(maxInputValue !== undefined ? { max_input_value_number: maxInputValue } : {}),
    ...(isOem !== undefined ? { is_oem: isOem } : {}),
  };
}

export function parseAttributeTreeForFrontend(tree: ApiAttribute[]): ParsedAttribute[] {
  if (!Array.isArray(tree)) return [];
  return tree.map(parseAttribute);
}
