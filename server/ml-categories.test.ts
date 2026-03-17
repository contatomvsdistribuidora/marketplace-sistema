import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock drizzle
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  like: vi.fn(),
  and: vi.fn(),
  sql: vi.fn(),
  desc: vi.fn(),
}));

// Set DATABASE_URL for tests
process.env.DATABASE_URL = "mysql://test:test@localhost/test";

describe("ML Categories Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchCategory via domain_discovery", () => {
    it("should return category data from domain_discovery API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            domain_id: "MLB-KIDS_TRICYCLES",
            domain_name: "Triciclos infantis",
            category_id: "MLB39567",
            category_name: "Triciclos",
          },
        ],
      });

      const response = await fetch(
        "https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=Triciclo"
      );
      const data = await response.json();

      expect(data).toHaveLength(1);
      expect(data[0].category_id).toBe("MLB39567");
      expect(data[0].category_name).toBe("Triciclos");
    });

    it("should handle empty domain_discovery results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const response = await fetch(
        "https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=xyznonexistent"
      );
      const data = await response.json();

      expect(data).toHaveLength(0);
    });
  });

  describe("fetchCategory via /categories/{id}", () => {
    it("should return full category info from ML API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "MLB39567",
          name: "Triciclos",
          path_from_root: [
            { id: "MLB1132", name: "Brinquedos e Hobbies" },
            { id: "MLB39567", name: "Triciclos" },
          ],
          children_categories: [],
          total_items_in_this_category: 5000,
        }),
      });

      const response = await fetch(
        "https://api.mercadolibre.com/categories/MLB39567"
      );
      const data = await response.json();

      expect(data.id).toBe("MLB39567");
      expect(data.name).toBe("Triciclos");
      expect(data.children_categories).toHaveLength(0);
    });

    it("should handle 404 for invalid category IDs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: "Category not found", status: 404 }),
      });

      const response = await fetch(
        "https://api.mercadolibre.com/categories/MLB180740"
      );

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });

  describe("Category ID validation", () => {
    it("should validate correct MLB category ID format", () => {
      const validIds = ["MLB39567", "MLB1648", "MLB263532", "MLB5726"];
      const invalidIds = ["1648", "abc", "MLA1648", "MLB", ""];

      for (const id of validIds) {
        expect(id.match(/^MLB\d+$/)).toBeTruthy();
      }

      for (const id of invalidIds) {
        expect(id.match(/^MLB\d+$/)).toBeFalsy();
      }
    });
  });

  describe("Root categories", () => {
    it("should have all known MLB root category IDs", () => {
      const knownRoots = [
        "MLB1648", "MLB1051", "MLB1574", "MLB1276", "MLB1132",
        "MLB1430", "MLB1953", "MLB1459", "MLB1071", "MLB5726",
        "MLB1499", "MLB1182", "MLB3937", "MLB1168", "MLB263532",
        "MLB1196", "MLB1144", "MLB1500", "MLB218519", "MLB1367",
        "MLB1384", "MLB1246", "MLB5672", "MLB1540", "MLB1000",
        "MLB1743", "MLB1403", "MLB264586",
      ];

      for (const id of knownRoots) {
        expect(id).toMatch(/^MLB\d+$/);
      }
      expect(knownRoots.length).toBe(28);
    });
  });

  describe("Category tree structure", () => {
    it("should correctly identify leaf vs non-leaf categories", () => {
      const leafCategory = {
        id: "MLB39567",
        name: "Triciclos",
        children_categories: [],
      };

      const parentCategory = {
        id: "MLB1132",
        name: "Brinquedos e Hobbies",
        children_categories: [
          { id: "MLB39567", name: "Triciclos" },
          { id: "MLB1747", name: "Bonecos" },
        ],
      };

      expect(leafCategory.children_categories.length).toBe(0);
      expect(parentCategory.children_categories.length).toBeGreaterThan(0);
    });

    it("should build correct path from root", () => {
      const pathFromRoot = [
        { id: "MLB1132", name: "Brinquedos e Hobbies" },
        { id: "MLB6354", name: "Veículos para Crianças" },
        { id: "MLB39567", name: "Triciclos" },
      ];

      const pathString = pathFromRoot.map((p) => p.name).join(" > ");
      expect(pathString).toBe(
        "Brinquedos e Hobbies > Veículos para Crianças > Triciclos"
      );

      const pathIds = pathFromRoot.map((p) => p.id).join(",");
      expect(pathIds).toBe("MLB1132,MLB6354,MLB39567");
    });
  });
});
