/**
 * Express routes for TikTok Shop OAuth callback
 */
import type { Express, Request, Response } from "express";
import { exchangeCodeForToken, saveTiktokAccount, getAuthorizedShops } from "./tiktokshop";
import { tiktokAccounts } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";

const PROD_DOMAIN = "https://blmarketexp-nqnujejx.manus.space";

export function registerTiktokRoutes(app: Express) {
  // OAuth callback
  app.get("/api/tiktok/callback", async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      const state = req.query.state as string;

      if (!code) {
        return res.status(400).send("Missing authorization code");
      }

      // Decode state to get userId
      let userId: number;
      try {
        const stateData = JSON.parse(Buffer.from(state, "base64").toString());
        userId = stateData.userId;
      } catch {
        return res.status(400).send("Invalid state parameter");
      }

      if (!userId) {
        return res.status(400).send("Missing userId in state");
      }

      // Exchange code for token
      const tokenData = await exchangeCodeForToken(code);

      // Save account
      const accountId = await saveTiktokAccount(userId, tokenData);

      // Try to get authorized shops and update account
      try {
        const shops = await getAuthorizedShops(tokenData.accessToken);
        if (shops.length > 0) {
          const shop = shops[0];
          await db
            .update(tiktokAccounts)
            .set({
              shopId: shop.id,
              shopName: shop.name,
              shopRegion: shop.region,
              shopCipher: shop.cipher,
            })
            .where(eq(tiktokAccounts.id, accountId));
        }
      } catch (shopErr) {
        console.error("Failed to fetch TikTok shops:", shopErr);
        // Non-critical, continue
      }

      // Redirect back to the app
      res.redirect(`${PROD_DOMAIN}/tiktok-accounts?connected=true`);
    } catch (err: any) {
      console.error("TikTok OAuth callback error:", err);
      res.redirect(`${PROD_DOMAIN}/tiktok-accounts?error=${encodeURIComponent(err.message || "Unknown error")}`);
    }
  });
}
