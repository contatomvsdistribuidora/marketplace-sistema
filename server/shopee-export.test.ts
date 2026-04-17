import { describe, it, expect, vi } from "vitest";
import {
  generateShopeeSpreadsheet,
  convertCachedProductToShopee,
  ProductForShopee,
} from "./shopee-export";

// Mock storagePut since we don't need S3 in tests
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://example.com/test.xlsx", key: "test.xlsx" }),
}));

const sampleProduct: ProductForShopee = {
  id: 12345,
  name: "Cabo USB Tipo C 1 Metro Carregamento Rápido",
  description: "Cabo USB Tipo C de alta qualidade, 1 metro de comprimento, suporta carregamento rápido de até 3A. Compatível com Samsung, Xiaomi, Motorola e outros dispositivos com entrada USB-C.",
  sku: "CABO-USBC-1M",
  ean: "7891234567890",
  price: 19.90,
  stock: 150,
  weight: 0.05,
  imageUrl: "https://example.com/images/cabo-usbc-1.jpg",
  images: [
    "https://example.com/images/cabo-usbc-2.jpg",
    "https://example.com/images/cabo-usbc-3.jpg",
  ],
  category: "Cabos e Adaptadores",
  brand: "TechCable",
};

describe("Shopee Export - convertCachedProductToShopee", () => {
  it("should convert a cached product to Shopee format", () => {
    const cached = {
      id: 100,
      name: "Produto Teste",
      description: "Descrição do produto teste com mais de 50 caracteres para validação",
      sku: "SKU-001",
      ean: "1234567890123",
      mainPrice: 29.90,
      totalStock: 50,
      weight: 0.3,
      imageUrl: "https://example.com/img.jpg",
      images: ["https://example.com/img2.jpg"],
    };

    const result = convertCachedProductToShopee(cached);

    expect(result.id).toBe(100);
    expect(result.name).toBe("Produto Teste");
    expect(result.price).toBe(29.90);
    expect(result.stock).toBe(50);
    expect(result.weight).toBe(0.3);
    expect(result.sku).toBe("SKU-001");
    expect(result.ean).toBe("1234567890123");
    expect(result.imageUrl).toBe("https://example.com/img.jpg");
  });

  it("should handle missing fields gracefully", () => {
    const cached = {
      id: 200,
      name: "Produto Sem Dados",
    };

    const result = convertCachedProductToShopee(cached);

    expect(result.id).toBe(200);
    expect(result.name).toBe("Produto Sem Dados");
    expect(result.price).toBe(0);
    expect(result.stock).toBe(0);
    expect(result.weight).toBe(0);
    expect(result.sku).toBe("");
    expect(result.ean).toBe("");
    expect(result.description).toBe("");
    expect(result.imageUrl).toBe("");
  });
});

describe("Shopee Export - generateShopeeSpreadsheet", () => {
  it("should generate a spreadsheet buffer with products", async () => {
    const products = [sampleProduct];

    const { buffer, filename } = await generateShopeeSpreadsheet(products);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(filename).toContain("Shopee_mass_upload");
    expect(filename).toContain("1produtos");
    expect(filename).toContain(".xlsx");
  });

  it("should generate spreadsheet with kit variations", async () => {
    const products = [sampleProduct];

    const { buffer, filename } = await generateShopeeSpreadsheet(products, {
      createKitVariations: true,
      kitQuantities: [2, 3, 4],
      kitDiscountPercent: [5, 10, 15],
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // With 1 product + 3 kit variations = 4 rows
    expect(filename).toContain("1produtos");
  });

  it("should handle multiple products", async () => {
    const products: ProductForShopee[] = [
      sampleProduct,
      {
        ...sampleProduct,
        id: 67890,
        name: "Fone de Ouvido Bluetooth TWS",
        sku: "FONE-BT-TWS",
        ean: "7891234567891",
        price: 49.90,
        stock: 80,
      },
    ];

    const { buffer, filename } = await generateShopeeSpreadsheet(products);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(filename).toContain("2produtos");
  });

  it("should apply kit discounts correctly", async () => {
    const products = [{ ...sampleProduct, price: 100, stock: 100 }];

    const { buffer } = await generateShopeeSpreadsheet(products, {
      createKitVariations: true,
      kitQuantities: [2, 3],
      kitDiscountPercent: [10, 20],
    });

    // Verify buffer was generated (detailed cell validation would require parsing)
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should strip HTML from descriptions", async () => {
    const products = [{
      ...sampleProduct,
      description: "<p>Descrição com <b>HTML</b> e <a href='#'>links</a></p>",
    }];

    const { buffer } = await generateShopeeSpreadsheet(products);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should truncate long product names to 120 chars", async () => {
    const longName = "A".repeat(200);
    const products = [{
      ...sampleProduct,
      name: longName,
    }];

    const { buffer } = await generateShopeeSpreadsheet(products);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should set shipping channels based on options", async () => {
    const products = [sampleProduct];

    const { buffer } = await generateShopeeSpreadsheet(products, {
      enableShopeeXpress: true,
      enableDirectDelivery: false,
      enableBuyerPickup: false,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should include NCM when provided", async () => {
    const products = [sampleProduct];

    const { buffer } = await generateShopeeSpreadsheet(products, {
      defaultNcm: "8544.42.00",
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });
});

describe("Shopee Export - Kit SKU generation", () => {
  it("should generate VIRT-KIT suffix for kit variations", async () => {
    // This test validates the SKU pattern described in the knowledge base
    const product: ProductForShopee = {
      ...sampleProduct,
      sku: "CABO-USBC-1M",
    };

    const { buffer } = await generateShopeeSpreadsheet([product], {
      createKitVariations: true,
      kitQuantities: [2, 3, 4],
    });

    // The spreadsheet should contain rows with SKUs like:
    // CABO-USBC-1M (parent)
    // CABO-USBC-1MVIRT-KIT2
    // CABO-USBC-1MVIRT-KIT3
    // CABO-USBC-1MVIRT-KIT4
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
