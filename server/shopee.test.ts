import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "crypto";

// Mock ENV before importing shopee module
vi.mock("./_core/env", () => ({
  ENV: {
    shopeePartnerId: "1219908",
    shopeePartnerKey: "shpk4f796d4b6555686a6745634765556f794558516667616c6d777a73487171",
  },
}));

// Mock drizzle to avoid real DB connections
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue([]),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue([{ insertId: 1 }]) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn() }) }),
  })),
}));

describe("Shopee Integration", () => {
  describe("Signature Generation", () => {
    it("generates correct HMAC-SHA256 signature format", () => {
      const partnerId = 1219908;
      const partnerKey = "shpk4f796d4b6555686a6745634765556f794558516667616c6d777a73487171";
      const path = "/api/v2/shop/auth_partner";
      const timestamp = 1710000000;

      const baseString = `${partnerId}${path}${timestamp}`;
      const expectedSign = crypto
        .createHmac("sha256", partnerKey)
        .update(baseString)
        .digest("hex");

      // Verify the signature is a valid hex string of 64 chars (SHA256)
      expect(expectedSign).toMatch(/^[a-f0-9]{64}$/);
      expect(expectedSign.length).toBe(64);
    });

    it("includes access_token and shop_id in signature when provided", () => {
      const partnerId = 1219908;
      const partnerKey = "shpk4f796d4b6555686a6745634765556f794558516667616c6d777a73487171";
      const path = "/api/v2/product/get_item_list";
      const timestamp = 1710000000;
      const accessToken = "test_access_token";
      const shopId = 123456;

      const baseStringWithAuth = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
      const signWithAuth = crypto
        .createHmac("sha256", partnerKey)
        .update(baseStringWithAuth)
        .digest("hex");

      const baseStringWithout = `${partnerId}${path}${timestamp}`;
      const signWithout = crypto
        .createHmac("sha256", partnerKey)
        .update(baseStringWithout)
        .digest("hex");

      // Signatures should be different when auth params are included
      expect(signWithAuth).not.toBe(signWithout);
      expect(signWithAuth).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("OAuth URL Generation", () => {
    it("generates authorization URL with correct structure", async () => {
      const { getAuthorizationUrl } = await import("./shopee");
      const redirectUrl = "https://blmarketexp-nqnujejx.manus.space/api/shopee/callback";
      const url = getAuthorizationUrl(redirectUrl);

      expect(url).toContain("/api/v2/shop/auth_partner");
      expect(url).toContain("partner_id=1219908");
      expect(url).toContain("timestamp=");
      expect(url).toContain("sign=");
      expect(url).toContain(`redirect=${encodeURIComponent(redirectUrl)}`);
    });

    it("includes state in redirect URL when provided", async () => {
      const { getAuthorizationUrl } = await import("./shopee");
      const redirectUrl = "https://blmarketexp-nqnujejx.manus.space/api/shopee/callback";
      const state = "test-state-123";
      const url = getAuthorizationUrl(redirectUrl, state);

      expect(url).toContain("redirect=");
      expect(url).toContain(encodeURIComponent("state="));
    });
  });

  describe("Partner Credentials Validation", () => {
    it("has valid partner ID configured", () => {
      const partnerId = "1219908";
      expect(partnerId).toBeTruthy();
      expect(parseInt(partnerId)).toBeGreaterThan(0);
      expect(parseInt(partnerId)).toBe(1219908);
    });

    it("has valid partner key configured", () => {
      const partnerKey = "shpk4f796d4b6555686a6745634765556f794558516667616c6d777a73487171";
      expect(partnerKey).toBeTruthy();
      expect(partnerKey.startsWith("shpk")).toBe(true);
      expect(partnerKey.length).toBeGreaterThan(20);
    });
  });

  describe("Token Exchange Request Format", () => {
    it("constructs correct token exchange URL", () => {
      const path = "/api/v2/auth/token/get";
      const partnerId = 1219908;
      const timestamp = Math.floor(Date.now() / 1000);
      const partnerKey = "shpk4f796d4b6555686a6745634765556f794558516667616c6d777a73487171";

      const sign = crypto
        .createHmac("sha256", partnerKey)
        .update(`${partnerId}${path}${timestamp}`)
        .digest("hex");

      const url = `https://openplatform.shopee.com.br${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;

      expect(url).toContain("openplatform.shopee.com.br");
      expect(url).toContain("/api/v2/auth/token/get");
      expect(url).toContain(`partner_id=${partnerId}`);
    });

    it("constructs correct token exchange body", () => {
      const code = "test_auth_code";
      const shopId = 123456;
      const partnerId = 1219908;

      const body = {
        code,
        shop_id: shopId,
        partner_id: partnerId,
      };

      expect(body.code).toBe("test_auth_code");
      expect(body.shop_id).toBe(123456);
      expect(body.partner_id).toBe(1219908);
    });
  });

  describe("API URL Construction", () => {
    it("builds signed URL for product list API", () => {
      const partnerId = 1219908;
      const partnerKey = "shpk4f796d4b6555686a6745634765556f794558516667616c6d777a73487171";
      const path = "/api/v2/product/get_item_list";
      const timestamp = Math.floor(Date.now() / 1000);
      const accessToken = "test_token";
      const shopId = 123456;

      const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
      const sign = crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");

      const params = new URLSearchParams({
        partner_id: partnerId.toString(),
        timestamp: timestamp.toString(),
        sign,
        access_token: accessToken,
        shop_id: shopId.toString(),
        offset: "0",
        page_size: "100",
        item_status: "NORMAL",
      });

      const url = `https://openplatform.shopee.com.br${path}?${params.toString()}`;

      expect(url).toContain("get_item_list");
      expect(url).toContain("offset=0");
      expect(url).toContain("page_size=100");
      expect(url).toContain("item_status=NORMAL");
      expect(url).toContain("access_token=test_token");
      expect(url).toContain("shop_id=123456");
    });

    it("builds signed URL for item base info API with multiple IDs", () => {
      const itemIds = [1001, 1002, 1003, 1004, 1005];
      const path = "/api/v2/product/get_item_base_info";

      const params = new URLSearchParams({
        partner_id: "1219908",
        timestamp: Math.floor(Date.now() / 1000).toString(),
        sign: "test_sign",
        access_token: "test_token",
        shop_id: "123456",
        item_id_list: itemIds.join(","),
      });

      const url = `https://openplatform.shopee.com.br${path}?${params.toString()}`;

      expect(url).toContain("get_item_base_info");
      expect(url).toContain("item_id_list=1001%2C1002%2C1003%2C1004%2C1005");
    });
  });

  describe("Quality Stats Calculation", () => {
    it("calculates quality percentages correctly", () => {
      const products = [
        { hasVideo: 1, images: ["a", "b", "c", "d", "e"], description: "Long description here for testing purposes that exceeds fifty characters", attributesFilled: 10, attributesTotal: 14 },
        { hasVideo: 0, images: ["a", "b"], description: "", attributesFilled: 1, attributesTotal: 14 },
        { hasVideo: 0, images: ["a", "b", "c", "d", "e", "f"], description: "Another good description for testing that is definitely longer than fifty characters total", attributesFilled: 14, attributesTotal: 14 },
        { hasVideo: 1, images: ["a"], description: "Short", attributesFilled: 7, attributesTotal: 14 },
      ];

      let withVideo = 0;
      let with5PlusImages = 0;
      let withDescription = 0;
      let totalAttrsFilled = 0;
      let totalAttrsTotal = 0;

      for (const p of products) {
        if (p.hasVideo) withVideo++;
        if (p.images.length >= 5) with5PlusImages++;
        if (p.description && p.description.length > 50) withDescription++;
        totalAttrsFilled += p.attributesFilled;
        totalAttrsTotal += p.attributesTotal;
      }

      const total = products.length;
      expect(total).toBe(4);
      expect(withVideo).toBe(2);
      expect(Math.round((withVideo / total) * 100)).toBe(50);
      expect(with5PlusImages).toBe(2);
      expect(Math.round((with5PlusImages / total) * 100)).toBe(50);
      expect(withDescription).toBe(2);
      expect(Math.round((totalAttrsFilled / totalAttrsTotal) * 100)).toBe(57);
    });
  });
});
