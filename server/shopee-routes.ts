/**
 * Shopee Express Routes
 * Handles OAuth callback after user authorizes on Shopee Open Platform.
 *
 * Flow:
 * 1. Frontend calls trpc.shopee.getAuthUrl → gets Shopee auth URL
 * 2. User clicks link → redirected to Shopee to authorize
 * 3. Shopee redirects back to /api/shopee/callback?code=...&shop_id=...
 * 4. This handler exchanges code for tokens and saves the account
 */

import type { Express, Request, Response } from "express";
import * as shopee from "./shopee";
import { sdk } from "./_core/sdk";

// Helper to extract userId from session cookie using the SDK
async function getUserIdFromRequest(req: Request): Promise<number | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    return user?.id || null;
  } catch {
    return null;
  }
}

export function registerShopeeRoutes(app: Express) {
  /**
   * Shopee OAuth Callback
   * After user authorizes on Shopee, they are redirected here with:
   * ?code=<auth_code>&shop_id=<shop_id>
   */
  app.get("/api/shopee/callback", async (req: Request, res: Response) => {
    try {
      const { code, shop_id, state, error } = req.query;

      if (error) {
        console.error("[Shopee OAuth] Authorization error:", error);
        return res.redirect(`/shopee-accounts?shopee_error=${encodeURIComponent(String(error))}`);
      }

      if (!code || !shop_id) {
        console.error("[Shopee OAuth] Missing code or shop_id:", { code: !!code, shop_id: !!shop_id });
        return res.redirect("/shopee-accounts?shopee_error=missing_params");
      }

      const shopId = parseInt(String(shop_id), 10);
      if (isNaN(shopId)) {
        return res.redirect("/shopee-accounts?shopee_error=invalid_shop_id");
      }

      // Get userId from state or session cookie
      let userId: number | null = null;
      let originUrl = "";

      if (state) {
        try {
          const stateData = JSON.parse(Buffer.from(String(state), "base64").toString());
          userId = stateData.userId;
          originUrl = stateData.origin || "";
        } catch {
          userId = await getUserIdFromRequest(req);
        }
      } else {
        userId = await getUserIdFromRequest(req);
      }

      if (!userId) {
        const errorRedirect = originUrl
          ? `${originUrl}/shopee-accounts?shopee_error=not_authenticated`
          : "/shopee-accounts?shopee_error=not_authenticated";
        return res.redirect(errorRedirect);
      }

      // Exchange code for tokens
      console.log(`[Shopee OAuth] Exchanging code for shop ${shopId}, user ${userId}...`);
      const tokenData = await shopee.exchangeCodeForToken(String(code), shopId);

      // Try to get shop name
      let shopName: string | undefined;
      try {
        const shopInfo = await shopee.getShopInfo(tokenData.accessToken, tokenData.shopId);
        shopName = shopInfo?.shop_name;
      } catch (e) {
        console.warn("[Shopee OAuth] Could not get shop name:", e);
      }

      // Save account to database
      await shopee.saveAccount(
        userId,
        tokenData.shopId,
        tokenData.accessToken,
        tokenData.refreshToken,
        tokenData.expiresIn,
        shopName,
        tokenData.refreshTokenExpiresIn
      );

      console.log(`[Shopee OAuth] Successfully connected shop ${shopId} (${shopName || "unknown"}) for user ${userId}`);

      // Redirect back to the Shopee accounts page
      const successRedirect = originUrl
        ? `${originUrl}/shopee-accounts?shopee_success=true&shop_name=${encodeURIComponent(shopName || String(shopId))}`
        : `/shopee-accounts?shopee_success=true&shop_name=${encodeURIComponent(shopName || String(shopId))}`;
      return res.redirect(successRedirect);
    } catch (err: any) {
      console.error("[Shopee OAuth] Callback error:", err);
      return res.redirect(`/shopee-accounts?shopee_error=${encodeURIComponent(err.message || "unknown_error")}`);
    }
  });
}
