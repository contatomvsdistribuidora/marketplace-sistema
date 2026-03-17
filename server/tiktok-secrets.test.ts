import { describe, it, expect } from "vitest";

describe("TikTok Shop Credentials", () => {
  it("should have TIKTOK_APP_KEY configured", () => {
    const appKey = process.env.TIKTOK_APP_KEY;
    expect(appKey).toBeDefined();
    expect(appKey).not.toBe("");
    expect(appKey).toBe("6jd0f6vkb6hns");
  });

  it("should have TIKTOK_APP_SECRET configured", () => {
    const appSecret = process.env.TIKTOK_APP_SECRET;
    expect(appSecret).toBeDefined();
    expect(appSecret).not.toBe("");
    // Verify it's a 40-char hex string (SHA-1 format)
    expect(appSecret).toMatch(/^[a-f0-9]{40}$/);
  });
});
