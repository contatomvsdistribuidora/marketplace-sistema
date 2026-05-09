/**
 * Wrapper for Shopee's GET /api/v2/product/get_item_content_diagnosis_result.
 *
 * Returns Shopee's "content quality" score for one or more items plus a list
 * of unfinished tasks (e.g. missing video, missing description) that block
 * the item from reaching maximum quality. Used by the publish flow to
 * persist diagnostic info on multi_product_listings right after add_item.
 */

import crypto from "crypto";
import { ENV } from "../_core/env";

const SHOPEE_API_BASE = "https://partner.shopeemobile.com";
const PATH = "/api/v2/product/get_item_content_diagnosis_result";

export interface UnfinishedTask {
  issue_type: number;
  suggestion: string;
}

export interface ItemDiagnosis {
  itemId: number;
  qualityLevel: number;
  unfinishedTasks: UnfinishedTask[];
}

function sign(ts: number, accessToken: string, shopId: number): string {
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const baseString = `${partnerId}${PATH}${ts}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", ENV.shopeePartnerKey).update(baseString).digest("hex");
}

/**
 * Fetch content-diagnosis for up to 50 itemIds in one call (Shopee's hard
 * cap). Items that Shopee can't process come back in failure_item_list and
 * are silently dropped — callers see only successful diagnoses.
 */
export async function fetchContentDiagnosis(
  accessToken: string,
  shopId: number,
  itemIds: number[],
): Promise<ItemDiagnosis[]> {
  if (itemIds.length === 0) return [];
  const ts = Math.floor(Date.now() / 1000);
  const partnerId = parseInt(ENV.shopeePartnerId, 10);
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(ts),
    access_token: accessToken,
    shop_id: String(shopId),
    sign: sign(ts, accessToken, shopId),
    item_id_list: itemIds.join(","),
  });
  const url = `${SHOPEE_API_BASE}${PATH}?${params.toString()}`;
  const res = await fetch(url, { method: "GET" });
  const data: any = await res.json();
  if (data?.error) {
    throw new Error(`Shopee diagnosis [${data.error}]: ${data.message ?? ""}`);
  }
  const list: any[] = data?.response?.success_item_list ?? [];
  return list.map((it) => ({
    itemId: Number(it.item_id),
    qualityLevel: Number(it.quality_level ?? 0),
    unfinishedTasks: Array.isArray(it.unfinished_task)
      ? it.unfinished_task.map((t: any) => ({
          issue_type: Number(t.issue_type),
          suggestion: String(t.suggestion ?? ""),
        }))
      : [],
  }));
}
