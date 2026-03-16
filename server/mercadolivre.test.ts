import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the ENV
vi.mock("./_core/env", () => ({
  ENV: {
    mlAppId: "571557934407019",
    mlClientSecret: "test-secret",
    cookieSecret: "test-cookie-secret",
  },
}));

// Mock the LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            attributes: [
              { id: "BRAND", value_name: "Test Brand" },
              { id: "GTIN", value_name: "1234567890123" },
            ],
          }),
        },
      },
    ],
  }),
}));

describe("Mercado Livre Integration", () => {
  describe("getAuthorizationUrl", () => {
    it("should generate a valid ML authorization URL", async () => {
      // Dynamic import to use mocked modules
      const { getAuthorizationUrl } = await import("./mercadolivre");

      const redirectUri = "https://example.com/api/ml/callback";
      const state = "test-state-123";

      const url = getAuthorizationUrl(redirectUri, state);

      expect(url).toContain("https://auth.mercadolivre.com.br/authorization");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=571557934407019");
      expect(url).toContain(encodeURIComponent(redirectUri));
      expect(url).toContain(`state=${state}`);
    });

    it("should work without state parameter", async () => {
      const { getAuthorizationUrl } = await import("./mercadolivre");

      const url = getAuthorizationUrl("https://example.com/callback");

      expect(url).toContain("response_type=code");
      expect(url).not.toContain("state=");
    });
  });

  describe("predictCategory", () => {
    it("should call ML domain_discovery API", async () => {
      const { predictCategory } = await import("./mercadolivre");

      // Mock fetch for this test
      const mockResponse = [
        {
          domain_id: "MLB-CELL_PHONES",
          domain_name: "Celulares e Smartphones",
          category_id: "MLB1055",
          category_name: "Celulares e Smartphones",
          attributes: [],
        },
      ];

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await predictCategory("iPhone 15 Pro Max");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/sites/MLB/domain_discovery/search?q=")
      );
      expect(result).toHaveLength(1);
      expect(result[0].categoryId).toBe("MLB1055");
      expect(result[0].categoryName).toBe("Celulares e Smartphones");
    });

    it("should return empty array on API error", async () => {
      const { predictCategory } = await import("./mercadolivre");

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await predictCategory("invalid query");
      expect(result).toEqual([]);
    });
  });

  describe("getCategoryAttributes", () => {
    it("should fetch and parse category attributes", async () => {
      const { getCategoryAttributes } = await import("./mercadolivre");

      const mockAttributes = [
        {
          id: "BRAND",
          name: "Marca",
          value_type: "string",
          tags: { required: true },
          values: [
            { id: "1234", name: "Apple" },
            { id: "5678", name: "Samsung" },
          ],
        },
        {
          id: "COLOR",
          name: "Cor",
          value_type: "string",
          tags: { required: false },
          values: [],
        },
      ];

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAttributes),
      });

      const result = await getCategoryAttributes("MLB1055");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("BRAND");
      expect(result[0].name).toBe("Marca");
      expect(result[0].required).toBe(true);
      expect(result[0].values).toHaveLength(2);
      expect(result[1].required).toBe(false);
    });
  });

  describe("getCategoryInfo", () => {
    it("should fetch category info with path", async () => {
      const { getCategoryInfo } = await import("./mercadolivre");

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "MLB1055",
            name: "Celulares e Smartphones",
            path_from_root: [
              { id: "MLB1051", name: "Celulares e Telefones" },
              { id: "MLB1055", name: "Celulares e Smartphones" },
            ],
            children_categories: [],
            settings: {},
          }),
      });

      const result = await getCategoryInfo("MLB1055");

      expect(result.id).toBe("MLB1055");
      expect(result.name).toBe("Celulares e Smartphones");
      expect(result.pathFromRoot).toBe("Celulares e Telefones > Celulares e Smartphones");
    });
  });

  describe("fillAttributesWithAI", () => {
    it("should call LLM and return parsed attributes", async () => {
      const { fillAttributesWithAI } = await import("./mercadolivre");

      const product = {
        name: "iPhone 15 Pro Max 256GB",
        description: "Smartphone Apple",
        ean: "1234567890123",
      };

      const requiredAttributes = [
        {
          id: "BRAND",
          name: "Marca",
          type: "string",
          values: [
            { id: "1234", name: "Apple" },
            { id: "5678", name: "Samsung" },
          ],
          required: true,
          allowCustomValue: false,
        },
      ];

      const result = await fillAttributesWithAI(product, requiredAttributes);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("value_name");
    });
  });
});
