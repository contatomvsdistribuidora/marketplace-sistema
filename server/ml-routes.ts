/**
 * Mercado Livre Express Routes
 * Handles OAuth callback and webhook notifications
 */

import type { Express, Request, Response } from "express";
import * as ml from "./mercadolivre";
import { ENV } from "./_core/env";
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

export function registerMlRoutes(app: Express) {
  /**
   * ML OAuth Callback
   * After user authorizes on ML, they are redirected here with ?code=...
   */
  app.get("/api/ml/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, error, error_description } = req.query;

      if (error) {
        console.error("[ML OAuth] Authorization error:", error, error_description);
        return res.redirect(`/ml-accounts?ml_error=${encodeURIComponent(String(error_description || error))}`);
      }

      if (!code) {
        return res.redirect("/ml-accounts?ml_error=missing_code");
      }

      // Parse state to get userId, return path, and original origin
      let userId: number | null = null;
      let returnPath = "/ml-accounts";
      let originUrl = ""; // The origin where user started the flow

      if (state) {
        try {
          const stateData = JSON.parse(Buffer.from(String(state), "base64").toString());
          userId = stateData.userId;
          returnPath = stateData.returnPath || returnPath;
          originUrl = stateData.origin || "";
        } catch {
          // Try getting userId from cookie
          userId = await getUserIdFromRequest(req);
        }
      } else {
        userId = await getUserIdFromRequest(req);
      }

      if (!userId) {
        const errorRedirect = originUrl ? `${originUrl}/ml-accounts?ml_error=not_authenticated` : "/ml-accounts?ml_error=not_authenticated";
        return res.redirect(errorRedirect);
      }

      // Build redirect URI (must match exactly what was configured in ML app)
      // Always use the production domain for token exchange
      const redirectUri = "https://blmarketexp-nqnujejx.manus.space/api/ml/callback";

      // Exchange code for token
      const tokenData = await ml.exchangeCodeForToken(String(code), redirectUri);

      // Save account
      await ml.saveAccount(userId, {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresIn: tokenData.expiresIn,
        userId: tokenData.userId,
        scope: tokenData.scope,
      });

      console.log(`[ML OAuth] Account connected: ML user ${tokenData.userId} for app user ${userId}`);

      // Redirect back to the original origin (dev or prod)
      const redirectBase = originUrl || "";
      return res.redirect(`${redirectBase}${returnPath}?ml_connected=true`);
    } catch (error: any) {
      console.error("[ML OAuth] Callback error:", error);
      return res.redirect(`/ml-accounts?ml_error=${encodeURIComponent(error.message || "unknown_error")}`);
    }
  });

  /**
   * ML Notifications Webhook
   * Receives notifications from ML about item changes, orders, etc.
   */
  app.post("/api/ml/notifications", async (req: Request, res: Response) => {
    try {
      const notification = req.body;
      console.log("[ML Notification]", JSON.stringify(notification));

      // Acknowledge receipt immediately
      res.status(200).json({ received: true });

      // TODO: Process notification topics (items, orders, questions, etc.)
    } catch (error) {
      console.error("[ML Notification] Error:", error);
      res.status(500).json({ error: "Internal error" });
    }
  });

  /**
   * ML Auth URL Generator
   * Returns the URL to redirect user to ML for authorization
   */
  app.get("/api/ml/auth-url", async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Use the production domain for redirect URI
      const redirectUri = "https://blmarketexp-nqnujejx.manus.space/api/ml/callback";

      // Encode state with userId and return path
      const state = Buffer.from(
        JSON.stringify({ userId, returnPath: "/ml-accounts" })
      ).toString("base64");

      const authUrl = ml.getAuthorizationUrl(redirectUri, state);
      res.json({ authUrl, redirectUri });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
