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
  publishProductFromWizard,
  batchPublish,
  promoteSimpleToVariated,
  PublishValidationError,
} from "./shopee-publish";

// Mock getItemBaseInfo / getModelList so tests don't depend on ./shopee internals.
vi.mock("./shopee", () => ({
  getItemBaseInfo: vi.fn(),
  getModelList: vi.fn(),
}));
import * as shopeeMod from "./shopee";
const mockGetItemBaseInfo = shopeeMod.getItemBaseInfo as unknown as ReturnType<typeof vi.fn>;
const mockGetModelList = shopeeMod.getModelList as unknown as ReturnType<typeof vi.fn>;

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
      expect(body.seller_stock).toEqual([{ stock: 100 }]);
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

  describe("publishProductFromWizard", () => {
    it("should round decimal dimensions to integers in add_item payload", async () => {
      // image download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });
      // image upload
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { image_info: { image_id: "img_id_1" } } }),
      });
      // add_item
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { item_id: 777888999 } }),
      });
      // init_tier_variation
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: {} }),
      });

      await publishProductFromWizard("test_token", 12345, {
        title: "Produto Wizard Dimensões Decimais",
        description: "Descrição longa suficiente para passar no filtro da Shopee no teste de arredondamento.",
        categoryId: 100001,
        imageUrls: ["https://example.com/img1.jpg"],
        variationTypeName: "Quantidade",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5, length: 29.2, width: 15.7, height: 10.9 },
          { label: "Kit 2", price: 56.81, stock: 50,  weight: 1.0, length: 29.2, width: 15.7, height: 10.9 },
        ],
      });

      const addItemCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/add_item"));
      expect(addItemCall).toBeDefined();
      const body = JSON.parse(addItemCall![1].body);
      expect(body.dimension).toEqual({
        package_length: 29,  // 29.2 -> 29
        package_width: 16,   // 15.7 -> 16
        package_height: 11,  // 10.9 -> 11
      });
      expect(Number.isInteger(body.dimension.package_length)).toBe(true);
      expect(Number.isInteger(body.dimension.package_width)).toBe(true);
      expect(Number.isInteger(body.dimension.package_height)).toBe(true);
    });
  });

  describe("publishProductFromWizard — update mode", () => {
    beforeEach(() => {
      mockGetItemBaseInfo.mockReset();
      mockGetModelList.mockReset();
    });

    function baseInput(overrides: Partial<Parameters<typeof publishProductFromWizard>[2]> = {}) {
      return {
        title: "Produto Atualizado",
        description: "Descrição longa suficiente para passar no filtro da Shopee no teste de update.",
        categoryId: 101220,
        imageUrls: ["https://example.com/a.jpg"],
        variationTypeName: "Quantidade",
        variations: [
          { label: "1 Un", price: 29.9, stock: 100, weight: 0.5, length: 29.2, width: 15.7, height: 10.9 },
        ],
        sourceItemId: 5555,
        ...overrides,
      } as Parameters<typeof publishProductFromWizard>[2];
    }

    it("should update a simple product (no variations) via update_item with price+seller_stock", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        { category_id: 101220, has_model: false, image: { image_url_list: ["https://example.com/a.jpg"], image_id_list: ["remote_id_1"] } },
      ]);
      // update_item
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: {} }),
      });

      const res = await publishProductFromWizard("tok", 12345, baseInput());
      expect(res.mode).toBe("update");
      expect(res.itemId).toBe(5555);
      expect(res.imagesUploaded).toBe(0); // reused remote ids

      const call = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/update_item"));
      expect(call).toBeDefined();
      const body = JSON.parse(call![1].body);
      expect(body.item_id).toBe(5555);
      expect(body.image.image_id_list).toEqual(["remote_id_1"]);
      expect(body.original_price).toBe(29.9);
      expect(body.seller_stock).toEqual([{ stock: 100 }]);
      expect(body.dimension).toEqual({ package_length: 29, package_width: 16, package_height: 11 });
      expect(body.logistic_info).toBeUndefined();
      expect(body.brand).toBeUndefined();
    });

    it("should update a product with variations via update_item (no price/stock) + update_price + update_stock", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: true,
          tier_variation: [{ name: "Quantidade", option_list: [{ option: "1 Un" }, { option: "Kit 2" }] }],
          image: { image_url_list: ["https://example.com/a.jpg"], image_id_list: ["rid"] },
        },
      ]);
      // update_item
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });
      // getModelList returns two models
      mockGetModelList.mockResolvedValueOnce([
        { model_id: 8001, tier_index: [0] },
        { model_id: 8002, tier_index: [1] },
      ]);
      // update_price
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });
      // update_stock
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });

      const res = await publishProductFromWizard("tok", 12345, baseInput({
        variations: [
          { label: "1 Un",  price: 29.9,  stock: 100, weight: 0.5, length: 29, width: 15, height: 10 },
          { label: "Kit 2", price: 56.81, stock: 50,  weight: 1.0, length: 29, width: 15, height: 10 },
        ],
      }));

      expect(res.mode).toBe("update");

      const updateItemCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/update_item"));
      const itemBody = JSON.parse(updateItemCall![1].body);
      expect(itemBody.original_price).toBeUndefined();
      expect(itemBody.seller_stock).toBeUndefined();

      const priceCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/update_price"));
      const priceBody = JSON.parse(priceCall![1].body);
      expect(priceBody.item_id).toBe(5555);
      expect(priceBody.price_list).toEqual([
        { model_id: 8001, original_price: 29.9 },
        { model_id: 8002, original_price: 56.81 },
      ]);

      const stockCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/update_stock"));
      const stockBody = JSON.parse(stockCall![1].body);
      expect(stockBody.stock_list).toEqual([
        { model_id: 8001, seller_stock: [{ stock: 100 }] },
        { model_id: 8002, seller_stock: [{ stock: 50 }] },
      ]);
    });

    it("should reject update when category changed", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([{ category_id: 999999, has_model: false, image: { image_url_list: [], image_id_list: [] } }]);
      await expect(publishProductFromWizard("tok", 12345, baseInput())).rejects.toMatchObject({
        code: "CATEGORY_CHANGED",
      });
    });

    it("should reject update when variation count differs", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: true,
          tier_variation: [{ name: "Quantidade", option_list: [{ option: "1 Un" }, { option: "Kit 2" }, { option: "Kit 3" }] }],
          image: { image_url_list: [], image_id_list: [] },
        },
      ]);
      await expect(publishProductFromWizard("tok", 12345, baseInput({
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
      }))).rejects.toMatchObject({ code: "VARIATION_COUNT_CHANGED" });
    });

    it("should reject update when a variation label is missing on Shopee", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: true,
          tier_variation: [{ name: "Quantidade", option_list: [{ option: "1 Un" }, { option: "Kit 2" }] }],
          image: { image_url_list: [], image_id_list: [] },
        },
      ]);
      await expect(publishProductFromWizard("tok", 12345, baseInput({
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 5", price: 99.0, stock: 10,  weight: 1.0 }, // label doesn't exist
        ],
      }))).rejects.toMatchObject({ code: "VARIATION_LABEL_MISSING" });
    });

    it("should prefer NEEDS_USER_DECISION over VARIATION_COUNT_CHANGED when remote tier_variation is empty", async () => {
      // Edge case observed in production: Shopee returns has_model=true but with
      // no actual tier options. Must be treated as "effectively simple" so the
      // decision modal fires instead of the misleading "Shopee: 0" count error.
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: true,
          tier_variation: [{ name: "Quantidade", option_list: [] }],
          image: { image_url_list: [], image_id_list: [] },
        },
      ]);

      await expect(publishProductFromWizard("tok", 12345, baseInput({
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
          { label: "Kit 3", price: 80.0, stock: 30,  weight: 1.5 },
          { label: "Kit 4", price: 100,  stock: 20,  weight: 2.0 },
        ],
        // no overrideMode — must prompt the user, not fire VARIATION_COUNT_CHANGED
      }))).rejects.toMatchObject({
        code: "NEEDS_USER_DECISION",
        availableModes: ["create", "promote"],
      });
    });

    it("should require user decision when simple product has local variations (NEEDS_USER_DECISION)", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: false,
          image: { image_url_list: ["https://example.com/a.jpg"], image_id_list: ["rid"] },
        },
      ]);

      await expect(publishProductFromWizard("tok", 12345, baseInput({
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
        // no overrideMode — backend must ask caller to decide
      }))).rejects.toMatchObject({
        code: "NEEDS_USER_DECISION",
        availableModes: ["create", "promote"],
      });

      // Must not have triggered any writes.
      const writeCalls = mockFetch.mock.calls.filter((c: any) =>
        ["init_tier_variation", "add_tier_variation", "update_item", "add_item"].some((p) => String(c[0]).includes(p)),
      );
      expect(writeCalls).toHaveLength(0);
    });

    it("should promote when overrideMode='promote' via init_tier_variation", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: false,
          image: { image_url_list: ["https://example.com/a.jpg"], image_id_list: ["rid"] },
        },
      ]);
      // init_tier_variation
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });
      // update_item (post-promote)
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });

      const res = await publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "promote",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
      }));

      expect(res.mode).toBe("promote");
      expect(res.itemId).toBe(5555);

      // Must hit init_tier_variation (NOT add_tier_variation — that returns error_not_found
      // on simple products, validated against a live item 2026-04-24).
      const initCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/init_tier_variation"));
      expect(initCall).toBeDefined();
      const addTierCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/add_tier_variation"));
      expect(addTierCall).toBeUndefined();
      const initBody = JSON.parse(initCall![1].body);
      expect(initBody.item_id).toBe(5555);
      expect(initBody.tier_variation).toEqual([
        { name: "Quantidade", option_list: [{ option: "1 Un" }, { option: "Kit 2" }] },
      ]);
      expect(initBody.model).toHaveLength(2);
      expect(initBody.model[0]).toMatchObject({ tier_index: [0], original_price: 29.9, seller_stock: [{ stock: 100 }] });
      expect(initBody.model[1]).toMatchObject({ tier_index: [1], original_price: 56.0, seller_stock: [{ stock: 50 }] });

      // update_item must be called without price/seller_stock (product is now variated)
      const updCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/update_item"));
      expect(updCall).toBeDefined();
      const updBody = JSON.parse(updCall![1].body);
      expect(updBody.original_price).toBeUndefined();
      expect(updBody.seller_stock).toBeUndefined();
    });

    it("should force CREATE when overrideMode='create' (ignores sourceItemId)", async () => {
      // getItemBaseInfo MUST NOT be called — we bypass the UPDATE path entirely.
      // image download
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });
      // image upload
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { image_info: { image_id: "new_img" } } }),
      });
      // add_item → new item_id
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { item_id: 99999 } }),
      });
      // init_tier_variation
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });

      const res = await publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
      }));

      expect(res.mode).toBe("create");
      expect(res.itemId).toBe(99999); // NEW id, not sourceItemId=5555
      expect(mockGetItemBaseInfo).not.toHaveBeenCalled();

      // update_item must NOT be called (we're creating, not updating)
      const updCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/update_item"));
      expect(updCall).toBeUndefined();
    });

    it("should forward per-variation sku as model_sku in init_tier_variation", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { image_info: { image_id: "img1" } } }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { item_id: 1000 } }),
      });
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });

      await publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5, sku: "CUSTOM-SKU-A" },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0, sku: "CUSTOM-SKU-B" },
        ],
      }));

      const initCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/init_tier_variation"));
      const body = JSON.parse(initCall![1].body);
      expect(body.model[0].model_sku).toBe("CUSTOM-SKU-A");
      expect(body.model[1].model_sku).toBe("CUSTOM-SKU-B");
    });

    it("should pass EAN as gtin_code when the product has a single variation", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { image_info: { image_id: "img1" } } }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { item_id: 1001 } }),
      });

      await publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        variations: [
          { label: "1 Un", price: 29.9, stock: 100, weight: 0.5, ean: "7891234567890" },
        ],
      }));

      const addItemCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/add_item"));
      const body = JSON.parse(addItemCall![1].body);
      expect(body.gtin_code).toBe("7891234567890");
    });

    it("should reject publish when an EAN has the wrong number of digits", async () => {
      await expect(publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        variations: [
          { label: "1 Un", price: 29.9, stock: 100, weight: 0.5, ean: "123456" }, // 6 digits → invalid
        ],
      }))).rejects.toThrow(/EAN.*8, 12, 13 ou 14 dígitos/);
    });

    it("should reject publish when an EAN has non-numeric characters", async () => {
      await expect(publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        variations: [
          { label: "1 Un", price: 29.9, stock: 100, weight: 0.5, ean: "789ABC1234567" },
        ],
      }))).rejects.toThrow(/não numéricos/);
    });

    it("should use newItemName in add_item payload when provided with overrideMode='create'", async () => {
      // image download + upload
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { image_info: { image_id: "img1" } } }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { item_id: 42 } }),
      });
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });

      await publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        newItemName: "Produto Atualizado - V2",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
      }));

      const addItemCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/add_item"));
      const body = JSON.parse(addItemCall![1].body);
      expect(body.item_name).toBe("Produto Atualizado - V2");
    });

    it("should append timestamp-based SKU suffix when overrideMode='create' with sourceItemId", async () => {
      // image download + upload
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { image_info: { image_id: "img1" } } }),
      });
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { item_id: 43 } }),
      });
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });

      await publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        baseSku: "SAC-15L-100",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
      }));

      const addItemCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/add_item"));
      const addBody = JSON.parse(addItemCall![1].body);
      // Top-level SKU is base + "-V<4 base36 chars>"
      expect(addBody.item_sku).toMatch(/^SAC-15L-100-V[0-9A-Z]{4}$/);

      // Per-model SKU reuses the suffixed base: "<prefix>-V<4>-<index>"
      const initCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/init_tier_variation"));
      const initBody = JSON.parse(initCall![1].body);
      expect(initBody.model[0].model_sku).toMatch(/^SAC-15L-100-V[0-9A-Z]{4}-1$/);
      expect(initBody.model[1].model_sku).toMatch(/^SAC-15L-100-V[0-9A-Z]{4}-2$/);
      // Both models share the same suffix (derived from one Date.now() call).
      const suffix0 = initBody.model[0].model_sku.slice(0, -2); // strip "-1"
      const suffix1 = initBody.model[1].model_sku.slice(0, -2);
      expect(suffix0).toBe(suffix1);
    });

    it("should reject NAME_INVALID when newItemName is empty", async () => {
      await expect(publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        newItemName: "",
        variations: [
          { label: "1 Un", price: 29.9, stock: 100, weight: 0.5 },
        ],
      }))).rejects.toMatchObject({ code: "NAME_INVALID" });
    });

    it("should reject NAME_INVALID when newItemName exceeds 120 chars", async () => {
      await expect(publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "create",
        newItemName: "A".repeat(121),
        variations: [
          { label: "1 Un", price: 29.9, stock: 100, weight: 0.5 },
        ],
      }))).rejects.toMatchObject({ code: "NAME_INVALID" });
    });

    it("should propagate shopee error during promote as PROMOTE_FAILED", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: false,
          image: { image_url_list: ["https://example.com/a.jpg"], image_id_list: ["rid"] },
        },
      ]);
      // init_tier_variation fails
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "invalid_option", message: "duplicate option name" }),
      });

      await expect(publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "promote",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
      }))).rejects.toMatchObject({ code: "PROMOTE_FAILED" });
    });

    it("should treat race ('item already has variations') as PROMOTE_FAILED and skip update_item", async () => {
      // We read the product as simple (has_model=false)...
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: false,
          image: { image_url_list: ["https://example.com/a.jpg"], image_id_list: ["rid"] },
        },
      ]);
      // ...but by the time init_tier_variation is called, Shopee already sees it as variated.
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          error: "error_param",
          message: "item already has variations",
        }),
      });

      await expect(publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "promote",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
      }))).rejects.toMatchObject({
        code: "PROMOTE_FAILED",
        userMessage: expect.stringContaining("item already has variations"),
      });

      // update_item MUST NOT be called when promote fails — otherwise we'd
      // overwrite top-level fields on a product whose variation state we
      // misread.
      const updCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/update_item"));
      expect(updCall).toBeUndefined();
    });

    it("should apply SKU suffix by index to models during promote", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          category_id: 101220,
          has_model: false,
          image: { image_url_list: ["https://example.com/a.jpg"], image_id_list: ["rid"] },
        },
      ]);
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });

      await publishProductFromWizard("tok", 12345, baseInput({
        overrideMode: "promote",
        baseSku: "SKU-BASE",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100, weight: 0.5 },
          { label: "Kit 2", price: 56.0, stock: 50,  weight: 1.0 },
        ],
      }));

      const initCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/init_tier_variation"));
      const body = JSON.parse(initCall![1].body);
      expect(body.model[0].model_sku).toBe("SKU-BASE-1");
      expect(body.model[1].model_sku).toBe("SKU-BASE-2");
    });

    it("should re-upload images when URLs differ from remote", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        { category_id: 101220, has_model: false, image: { image_url_list: ["https://example.com/OLD.jpg"], image_id_list: ["rid_old"] } },
      ]);
      // image download (url changed → new upload)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        headers: new Map([["content-type", "image/jpeg"]]),
      });
      // image upload
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: { image_info: { image_id: "rid_new" } } }),
      });
      // update_item
      mockFetch.mockResolvedValueOnce({ json: () => Promise.resolve({ error: "", response: {} }) });

      const res = await publishProductFromWizard("tok", 12345, baseInput({
        imageUrls: ["https://example.com/NEW.jpg"],
      }));

      expect(res.imagesUploaded).toBe(1);
      const call = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/update_item"));
      const body = JSON.parse(call![1].body);
      expect(body.image.image_id_list).toEqual(["rid_new"]);
    });
  });

  // Pre-flight guard added 2026-04 to surface a clearer error when the
  // wizard tries to promote a product that ALREADY has tier_variation
  // (Shopee responds with the unhelpful "tier-variation not change").
  describe("promoteSimpleToVariated — pre-flight has_model guard", () => {
    it("throws PRECONDITION_FAILED when get_item_base_info reports has_model=true", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        {
          item_id: 999,
          has_model: true,
          tier_variation: [{ name: "Cor", option_list: [{ option: "Vermelho" }] }],
        },
      ]);

      await expect(promoteSimpleToVariated("tok", 12345, {
        itemId: 999,
        variationTypeName: "Quantidade",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100 },
          { label: "Kit 2", price: 56.0, stock: 50 },
        ],
      })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      // init_tier_variation MUST NOT be called when the guard fires.
      const initCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/init_tier_variation"));
      expect(initCall).toBeUndefined();
    });

    it("proceeds with init_tier_variation when has_model=false (no remote variations)", async () => {
      mockGetItemBaseInfo.mockResolvedValueOnce([
        { item_id: 1000, has_model: false, tier_variation: [] },
      ]);
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ error: "", response: {} }),
      });

      const res = await promoteSimpleToVariated("tok", 12345, {
        itemId: 1000,
        variationTypeName: "Quantidade",
        variations: [
          { label: "1 Un",  price: 29.9, stock: 100 },
          { label: "Kit 2", price: 56.0, stock: 50 },
        ],
      });

      expect(res.modelsCreated).toBe(2);
      const initCall = mockFetch.mock.calls.find((c: any) => String(c[0]).includes("/api/v2/product/init_tier_variation"));
      expect(initCall).toBeDefined();
      const body = JSON.parse(initCall![1].body);
      expect(body.item_id).toBe(1000);
      expect(body.tier_variation[0].option_list).toHaveLength(2);
    });
  });
});
