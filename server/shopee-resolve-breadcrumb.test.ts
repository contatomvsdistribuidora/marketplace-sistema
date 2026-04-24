/**
 * Unit tests for the wizard hydration helpers introduced to fix the
 * "CategoryPicker shows ID, BrandPicker is empty" UX bug.
 *
 * - Server: `buildCategoryIndex` already covered in shopee-category-search.test.ts;
 *   here we sanity-check the find-by-id pattern used by resolveCategoryBreadcrumb.
 * - Client-side helper: brand extraction from `product.attributes` (input_type=BRAND).
 *   Pure function copy of the wizard's `initialBrand` memo so we can test it
 *   without mounting React.
 */
import { describe, it, expect } from "vitest";
import { buildCategoryIndex } from "./shopee-publish";

// Mirror of the client-side initialBrand logic — kept here as a pure
// function so the regression is testable without React infra.
function extractBrandFromAttributes(attributes: unknown): { brandId: number; brandName: string } {
  const attrs: any[] = Array.isArray(attributes) ? attributes : [];
  const brandAttr = attrs.find((a: any) =>
    a?.input_type === "BRAND" ||
    a?.original_attribute_name === "Brand" ||
    a?.display_attribute_name === "Marca",
  );
  const v = brandAttr?.attribute_value_list?.[0];
  if (v && (v.value_id || v.original_value_name || v.display_value_name)) {
    return {
      brandId: Number(v.value_id ?? 0),
      brandName: String(v.display_value_name ?? v.original_value_name ?? "No Brand"),
    };
  }
  return { brandId: 0, brandName: "No Brand" };
}

const tree = [
  { category_id: 100, parent_category_id: 0, original_category_name: "Casa", display_category_name: "Casa", has_children: true },
  { category_id: 101, parent_category_id: 100, original_category_name: "Limpeza", display_category_name: "Limpeza", has_children: true },
  { category_id: 102, parent_category_id: 101, original_category_name: "Sacos de Lixo", display_category_name: "Sacos de Lixo", has_children: false },
];

describe("resolveCategoryBreadcrumb (server-side index lookup)", () => {
  it("finds the breadcrumb for a leaf category id", () => {
    const idx = buildCategoryIndex(tree as any);
    const found = idx.find((c) => c.category_id === 102);
    expect(found?.breadcrumb).toBe("Casa > Limpeza > Sacos de Lixo");
    expect(found?.display_category_name).toBe("Sacos de Lixo");
  });

  it("returns undefined for an id that's not in the cached tree", () => {
    const idx = buildCategoryIndex(tree as any);
    const found = idx.find((c) => c.category_id === 999);
    expect(found).toBeUndefined();
  });
});

describe("extractBrandFromAttributes (wizard initial brand hydration)", () => {
  it("extracts brand from a BRAND-typed attribute", () => {
    const attrs = [
      {
        input_type: "BRAND",
        original_attribute_name: "Brand",
        display_attribute_name: "Marca",
        attribute_value_list: [
          { value_id: 1145795, original_value_name: "Taiwan Collection", display_value_name: "Taiwan Collection" },
        ],
      },
      {
        input_type: "DROP_DOWN",
        original_attribute_name: "Material",
        attribute_value_list: [{ value_id: 1207, original_value_name: "Plastic" }],
      },
    ];
    expect(extractBrandFromAttributes(attrs)).toEqual({
      brandId: 1145795,
      brandName: "Taiwan Collection",
    });
  });

  it("matches by display name 'Marca' as a secondary key (PT-BR labelling)", () => {
    const attrs = [
      {
        input_type: "DROP_DOWN", // not BRAND, but display name matches
        display_attribute_name: "Marca",
        attribute_value_list: [{ value_id: 99, original_value_name: "Acme" }],
      },
    ];
    expect(extractBrandFromAttributes(attrs).brandName).toBe("Acme");
  });

  it("returns 'No Brand' sentinel when attributes is empty", () => {
    expect(extractBrandFromAttributes([])).toEqual({ brandId: 0, brandName: "No Brand" });
  });

  it("returns 'No Brand' sentinel when attributes is null/undefined", () => {
    expect(extractBrandFromAttributes(null)).toEqual({ brandId: 0, brandName: "No Brand" });
    expect(extractBrandFromAttributes(undefined)).toEqual({ brandId: 0, brandName: "No Brand" });
  });

  it("returns 'No Brand' when no brand attribute exists in the list", () => {
    const attrs = [
      { input_type: "DROP_DOWN", original_attribute_name: "Material", attribute_value_list: [] },
    ];
    expect(extractBrandFromAttributes(attrs)).toEqual({ brandId: 0, brandName: "No Brand" });
  });

  it("handles brand attribute with empty value_list (synced but unfilled)", () => {
    const attrs = [
      { input_type: "BRAND", original_attribute_name: "Brand", attribute_value_list: [] },
    ];
    expect(extractBrandFromAttributes(attrs)).toEqual({ brandId: 0, brandName: "No Brand" });
  });

  it("prefers display_value_name over original_value_name when both present", () => {
    const attrs = [
      {
        input_type: "BRAND",
        attribute_value_list: [
          { value_id: 5, original_value_name: "PT", display_value_name: "PT-BR" },
        ],
      },
    ];
    expect(extractBrandFromAttributes(attrs).brandName).toBe("PT-BR");
  });
});
