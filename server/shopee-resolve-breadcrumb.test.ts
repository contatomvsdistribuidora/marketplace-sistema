/**
 * Unit tests for category breadcrumb resolution + brand-attribute injection
 * used by the wizard's Especificações step.
 */
import { describe, it, expect } from "vitest";
import { buildCategoryIndex } from "./shopee-publish";
import { ensureBrandAttribute } from "./routers";

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

describe("ensureBrandAttribute (router fallback splice)", () => {
  it("prepends a synthetic Brand attribute when the list has no BRAND entry", () => {
    const list = [
      { attribute_id: 100278, input_type: "INT_TYPE", display_attribute_name: "Volume" },
      { attribute_id: 100134, input_type: "DROP_DOWN", display_attribute_name: "Material" },
    ];
    const result = ensureBrandAttribute(list);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      input_type: "BRAND",
      original_attribute_name: "Brand",
      display_attribute_name: "Marca",
      is_mandatory: false,
    });
    expect(result[0].attribute_value_list[0]).toMatchObject({
      value_id: 0,
      original_value_name: "Sem marca",
    });
    // Original attributes preserved after the brand entry
    expect(result[1].attribute_id).toBe(100278);
    expect(result[2].attribute_id).toBe(100134);
  });

  it("is idempotent — does not duplicate if input_type=BRAND already present", () => {
    const list = [
      { attribute_id: 999, input_type: "BRAND", display_attribute_name: "Marca", attribute_value_list: [] },
      { attribute_id: 100134, input_type: "DROP_DOWN" },
    ];
    const result = ensureBrandAttribute(list);
    expect(result).toHaveLength(2);
    expect(result[0].attribute_id).toBe(999); // existing entry kept untouched
  });

  it("is idempotent — recognizes brand by display_attribute_name='Marca'", () => {
    const list = [
      { attribute_id: 50, input_type: "DROP_DOWN", display_attribute_name: "Marca", attribute_value_list: [] },
    ];
    const result = ensureBrandAttribute(list);
    expect(result).toHaveLength(1); // not prepended
  });

  it("handles empty input by returning a single Brand entry", () => {
    const result = ensureBrandAttribute([]);
    expect(result).toHaveLength(1);
    expect(result[0].input_type).toBe("BRAND");
  });

  it("handles non-array input defensively (returns Brand-only list)", () => {
    expect(ensureBrandAttribute(null as any)).toHaveLength(1);
    expect(ensureBrandAttribute(undefined as any)).toHaveLength(1);
  });
});
