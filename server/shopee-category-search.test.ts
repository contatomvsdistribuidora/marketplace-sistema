import { describe, it, expect } from "vitest";
import { buildCategoryIndex, fuzzyMatchCategories } from "./shopee-publish";

// Mini tree that exercises the breadcrumb walk + scoring heuristics.
const tree = [
  { category_id: 1, parent_category_id: 0, original_category_name: "Indústria", display_category_name: "Indústria", has_children: true },
  { category_id: 2, parent_category_id: 1, original_category_name: "Embalagens", display_category_name: "Embalagens", has_children: true },
  { category_id: 3, parent_category_id: 2, original_category_name: "Descartáveis", display_category_name: "Descartáveis", has_children: false },
  { category_id: 4, parent_category_id: 2, original_category_name: "Sacos de Lixo",  display_category_name: "Sacos de Lixo",  has_children: false },
  { category_id: 5, parent_category_id: 0, original_category_name: "Casa", display_category_name: "Casa", has_children: true },
  { category_id: 6, parent_category_id: 5, original_category_name: "Limpeza", display_category_name: "Limpeza", has_children: false },
];

describe("buildCategoryIndex", () => {
  it("resolves breadcrumbs via parent chain", () => {
    const idx = buildCategoryIndex(tree as any);
    const byId = new Map(idx.map((c) => [c.category_id, c]));
    expect(byId.get(1)!.breadcrumb).toBe("Indústria");
    expect(byId.get(2)!.breadcrumb).toBe("Indústria > Embalagens");
    expect(byId.get(3)!.breadcrumb).toBe("Indústria > Embalagens > Descartáveis");
    expect(byId.get(4)!.breadcrumb).toBe("Indústria > Embalagens > Sacos de Lixo");
    expect(byId.get(6)!.breadcrumb).toBe("Casa > Limpeza");
  });

  it("preserves has_children so the frontend can filter leaves if needed", () => {
    const idx = buildCategoryIndex(tree as any);
    const bl = idx.find((c) => c.category_id === 4)!;
    expect(bl.has_children).toBe(false);
    const casa = idx.find((c) => c.category_id === 5)!;
    expect(casa.has_children).toBe(true);
  });
});

describe("fuzzyMatchCategories", () => {
  const idx = buildCategoryIndex(tree as any);

  it("matches by whole-word tokens case-insensitively", () => {
    const results = fuzzyMatchCategories(idx, "saco lixo");
    expect(results).toHaveLength(1);
    expect(results[0].category_id).toBe(4);
  });

  it("is accent-insensitive (descartaveis matches Descartáveis)", () => {
    const results = fuzzyMatchCategories(idx, "descartaveis");
    expect(results[0]?.category_id).toBe(3);
  });

  it("requires ALL tokens to be present somewhere in the breadcrumb (AND semantics)", () => {
    // "Embalagens" matches the parent chain but "foobar" does not.
    const results = fuzzyMatchCategories(idx, "embalagens foobar");
    expect(results).toHaveLength(0);
  });

  it("prefers leaves over parent categories when both match", () => {
    // "Casa" matches both id=5 (Casa itself, parent) and id=6 (Casa > Limpeza, leaf).
    const results = fuzzyMatchCategories(idx, "casa");
    expect(results[0].category_id).toBe(6); // leaf wins
    expect(results.some((r) => r.category_id === 5)).toBe(true); // parent still included
  });

  it("returns empty array when query is blank or whitespace", () => {
    expect(fuzzyMatchCategories(idx, "")).toEqual([]);
    expect(fuzzyMatchCategories(idx, "   ")).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const results = fuzzyMatchCategories(idx, "indústria", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
