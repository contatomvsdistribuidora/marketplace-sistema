import { describe, it, expect } from "vitest";
import { generateSign } from "./tiktokshop";

describe("TikTok Shop Integration", () => {
  describe("generateSign", () => {
    it("should generate HMAC-SHA256 signature correctly", () => {
      const path = "/product/202309/products";
      const queryParams = {
        app_key: "test_app_key",
        timestamp: "1700000000",
        version: "202309",
        shop_cipher: "test_cipher",
      };
      const body = JSON.stringify({ title: "Test Product" });
      const appSecret = "test_secret";

      const sign = generateSign(path, queryParams, body, appSecret);

      // Signature should be a 64-char hex string (SHA-256)
      expect(sign).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should exclude sign and access_token from signature input", () => {
      const path = "/test";
      const queryParams1 = {
        app_key: "key1",
        timestamp: "123",
        version: "202309",
        sign: "old_sign",
        access_token: "token123",
      };
      const queryParams2 = {
        app_key: "key1",
        timestamp: "123",
        version: "202309",
      };
      const appSecret = "secret";

      const sign1 = generateSign(path, queryParams1, null, appSecret);
      const sign2 = generateSign(path, queryParams2, null, appSecret);

      expect(sign1).toBe(sign2);
    });

    it("should sort query params alphabetically", () => {
      const path = "/test";
      const queryParams1 = {
        z_param: "z",
        a_param: "a",
        app_key: "key",
      };
      const queryParams2 = {
        a_param: "a",
        app_key: "key",
        z_param: "z",
      };
      const appSecret = "secret";

      const sign1 = generateSign(path, queryParams1, null, appSecret);
      const sign2 = generateSign(path, queryParams2, null, appSecret);

      expect(sign1).toBe(sign2);
    });

    it("should produce different signatures for different bodies", () => {
      const path = "/test";
      const queryParams = { app_key: "key", timestamp: "123" };
      const appSecret = "secret";

      const sign1 = generateSign(path, queryParams, '{"a":1}', appSecret);
      const sign2 = generateSign(path, queryParams, '{"b":2}', appSecret);

      expect(sign1).not.toBe(sign2);
    });

    it("should handle null body correctly", () => {
      const path = "/test";
      const queryParams = { app_key: "key", timestamp: "123" };
      const appSecret = "secret";

      const sign = generateSign(path, queryParams, null, appSecret);
      expect(sign).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce different signatures for different secrets", () => {
      const path = "/test";
      const queryParams = { app_key: "key" };

      const sign1 = generateSign(path, queryParams, null, "secret1");
      const sign2 = generateSign(path, queryParams, null, "secret2");

      expect(sign1).not.toBe(sign2);
    });
  });

  describe("Authorization URL", () => {
    it("should be importable", async () => {
      const mod = await import("./tiktokshop");
      expect(typeof mod.getAuthorizationUrl).toBe("function");
    });
  });

  describe("Module exports", () => {
    it("should export all required functions", async () => {
      const mod = await import("./tiktokshop");
      expect(typeof mod.generateSign).toBe("function");
      expect(typeof mod.getAuthorizationUrl).toBe("function");
      expect(typeof mod.exchangeCodeForToken).toBe("function");
      expect(typeof mod.refreshAccessToken).toBe("function");
      expect(typeof mod.getAuthorizedShops).toBe("function");
      expect(typeof mod.getCategories).toBe("function");
      expect(typeof mod.recommendCategory).toBe("function");
      expect(typeof mod.getCategoryAttributes).toBe("function");
      expect(typeof mod.uploadProductImage).toBe("function");
      expect(typeof mod.createProduct).toBe("function");
      expect(typeof mod.saveTiktokAccount).toBe("function");
      expect(typeof mod.getUserTiktokAccounts).toBe("function");
      expect(typeof mod.disconnectTiktokAccount).toBe("function");
    });
  });
});
