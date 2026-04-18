import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ENV
vi.mock("./_core/env", () => ({
  ENV: {
    shopeePartnerId: "2030365",
    shopeePartnerKey: "shpk6a6b436a7271784d7048465a487a4474561757279456d4d4c5044425873",
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  getCategories,
  getCategoryAttributes,
  getLogisticsChannels,
  uploadImageFromUrl,
  createProduct,
  initTierVariation,
  publishProduct,
  batchPublish,
} from "./shopee-publish";

describe("Shopee Publish Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCategories", () => {
    it("should fetch categories from Shopee API", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: {
              category_list: [
                {
                  category_id: 100001,
                  parent_category_id: 0,
                  original_category_name: "Eletrônicos",
                  display_category_name: "Eletrônicos",
                  has_children: true,
                },
                {
                  category_id: 100002,
                  parent_category_id: 0,
                  original_category_name: "Casa",
                  display_category_name: "Casa",
                  has_children: true,
                },
              ],
            },
          }),
      });

      const categories = await getCategories("test_token", 12345);
      expect(categories).toHaveLength(2);
      expect(categories[0].category_id).toBe(100001);
      expect(categories[0].original_category_name).toBe("Eletrônicos");

      // Verify URL contains correct parameters
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("/api/v2/product/get_category");
      expect(calledUrl).toContain("partner_id=2030365");
      expect(calledUrl).toContain("shop_id=12345");
    });

    it("should throw on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "error_auth",
            message: "Invalid access token",
          }),
      });

      await expect(getCategories("bad_token", 12345)).rejects.toThrow(
        "error_auth"
      );
    });
  });

  describe("getCategoryAttributes", () => {
    it("should fetch attributes for a category", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: {
              attribute_list: [
                {
                  attribute_id: 1001,
                  original_attribute_name: "Marca",
                  is_mandatory: true,
                },
              ],
            },
          }),
      });

      const attrs = await getCategoryAttributes("test_token", 12345, 100001);
      expect(attrs).toHaveLength(1);
      expect(attrs[0].attribute_id).toBe(1001);
    });
  });

  describe("getLogisticsChannels", () => {
    it("should fetch logistics channels", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: {
              logistics_channel_list: [
                { logistics_channel_id: 1, logistics_channel_name: "Shopee Envios", enabled: true },
                { logistics_channel_id: 2, logistics_channel_name: "Correios", enabled: true },
              ],
            },
          }),
      });

      const channels = await getLogisticsChannels("test_token", 12345);
      expect(channels).toHaveLength(2);
      expect(channels[0].logistics_channel_name).toBe("Shopee Envios");
    });
  });

  describe("createProduct", () => {
    it("should create a product on Shopee", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: {
              item_id: 999888777,
            },
          }),
      });

      const result = await createProduct("test_token", 12345, {
        itemName: "Produto Teste",
        description: "Descrição do produto teste com mais de 50 caracteres para ser válida na Shopee",
        categoryId: 100001,
        price: 29.9,
        stock: 100,
        weight: 0.5,
        imageIds: ["img_id_1", "img_id_2"],
        sku: "SKU-001",
      });

      expect(result.itemId).toBe(999888777);

      // Verify POST body
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("/api/v2/product/add_item");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.item_name).toBe("Produto Teste");
      expect(body.original_price).toBe(29.9);
      expect(body.normal_stock).toBe(100);
      expect(body.category_id).toBe(100001);
      expect(body.image.image_id_list).toEqual(["img_id_1", "img_id_2"]);
    });

    it("should truncate long names to 120 chars", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: { item_id: 123 },
          }),
      });

      const longName = "A".repeat(200);
      await createProduct("test_token", 12345, {
        itemName: longName,
        description: "Descrição válida com mais de cinquenta caracteres para a API da Shopee aceitar",
        categoryId: 100001,
        price: 10,
        stock: 50,
        weight: 0.3,
        imageIds: ["img1"],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.item_name.length).toBe(120);
    });
  });

  describe("initTierVariation", () => {
    it("should initialize kit variations for a product", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: {},
          }),
      });

      await initTierVariation("test_token", 12345, 999888777, {
        name: "Quantidade",
        options: ["1 Unidade", "Kit 2 Unidades", "Kit 3 Unidades"],
        models: [
          { tierIndex: [0], price: 29.9, stock: 100, sku: "SKU-001-1UN" },
          { tierIndex: [1], price: 56.81, stock: 50, sku: "SKU-001-KIT2" },
          { tierIndex: [2], price: 80.73, stock: 33, sku: "SKU-001-KIT3" },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.item_id).toBe(999888777);
      expect(body.tier_variation[0].name).toBe("Quantidade");
      expect(body.tier_variation[0].option_list).toHaveLength(3);
      expect(body.model).toHaveLength(3);
      expect(body.model[0].original_price).toBe(29.9);
    });
  });

  describe("publishProduct", () => {
    it("should upload images, create product, and add variations", async () => {
      // Mock image download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });

      // Mock image upload
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: { image_info: { image_id: "uploaded_img_1" } },
          }),
      });

      // Mock product creation
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: { item_id: 555666777 },
          }),
      });

      // Mock tier variation
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: {},
          }),
      });

      const result = await publishProduct("test_token", 12345, {
        name: "Produto Teste Completo",
        description: "Descrição completa do produto teste com informações detalhadas para publicação na Shopee",
        sku: "SKU-TEST",
        ean: "7891234567890",
        price: 49.9,
        stock: 200,
        weight: 0.8,
        imageUrls: ["https://example.com/img1.jpg"],
        categoryId: 100001,
        createKits: true,
        kitQuantities: [2, 3],
        kitDiscounts: [5, 10],
      });

      expect(result.success).toBe(true);
      expect(result.itemId).toBe(555666777);
      expect(result.imagesUploaded).toBe(1);
      expect(result.hasVariations).toBe(true);
    });

    it("should handle image upload failure gracefully", async () => {
      // Mock image download failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
      });

      const result = await publishProduct("test_token", 12345, {
        name: "Produto Sem Imagem",
        description: "Descrição do produto sem imagem que vai falhar no upload",
        sku: "SKU-NOIMG",
        ean: "",
        price: 19.9,
        stock: 50,
        weight: 0.3,
        imageUrls: ["https://example.com/broken.jpg"],
        categoryId: 100001,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Nenhuma imagem");
    });
  });

  describe("batchPublish", () => {
    it("should process multiple products sequentially", async () => {
      // Product 1: success
      // Image download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });
      // Image upload
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: { image_info: { image_id: "img1" } },
          }),
      });
      // Create product
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: "",
            response: { item_id: 111 },
          }),
      });

      // Product 2: failure
      mockFetch.mockResolvedValueOnce({ ok: false });

      const results = await batchPublish("test_token", 12345, [
        {
          name: "Produto 1",
          description: "Descrição do primeiro produto para teste de batch publish na Shopee",
          sku: "P1",
          ean: "",
          price: 10,
          stock: 100,
          weight: 0.5,
          imageUrls: ["https://example.com/p1.jpg"],
          categoryId: 100001,
        },
        {
          name: "Produto 2",
          description: "Descrição do segundo produto para teste de batch publish na Shopee",
          sku: "P2",
          ean: "",
          price: 20,
          stock: 50,
          weight: 0.3,
          imageUrls: ["https://example.com/p2.jpg"],
          categoryId: 100001,
        },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].itemId).toBe(111);
      expect(results[1].success).toBe(false);
    });
  });
});
