import { describe, it, expect } from "vitest";
import { fuzzyMatchBrands } from "./shopee-publish";

const brands = [
  { brand_id: 0,   original_brand_name: "No Brand",          display_brand_name: "No Brand" },
  { brand_id: 101, original_brand_name: "Nike",              display_brand_name: "Nike" },
  { brand_id: 102, original_brand_name: "Nestlé",            display_brand_name: "Nestlé" },
  { brand_id: 103, original_brand_name: "Samsung Electronics", display_brand_name: "Samsung" },
  { brand_id: 104, original_brand_name: "Samsung Mobile",    display_brand_name: "Samsung Mobile" },
  { brand_id: 105, original_brand_name: "Plastilânia",       display_brand_name: "Plastilânia" },
];

describe("fuzzyMatchBrands", () => {
  it("matches prefix in display name (Samsung → both Samsung entries, 'Samsung' first)", () => {
    const results = fuzzyMatchBrands(brands, "samsung");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Display name "Samsung" is a pure prefix match → scores higher than "Samsung Mobile"
    expect(results[0].brand_id).toBe(103);
    expect(results.some((b) => b.brand_id === 104)).toBe(true);
  });

  it("is accent-insensitive (plastilania → Plastilânia)", () => {
    const results = fuzzyMatchBrands(brands, "plastilania");
    expect(results[0]?.brand_id).toBe(105);
  });

  it("requires every token to match (Samsung Mobile narrows to 1)", () => {
    const results = fuzzyMatchBrands(brands, "samsung mobile");
    expect(results.map((b) => b.brand_id)).toEqual([104]);
  });

  it("returns empty array when no match", () => {
    expect(fuzzyMatchBrands(brands, "asdqwezxc")).toEqual([]);
  });

  it("returns the head of the list when query is empty (initial dropdown)", () => {
    const results = fuzzyMatchBrands(brands, "", 3);
    expect(results).toHaveLength(3);
  });

  it("respects the limit", () => {
    const results = fuzzyMatchBrands(brands, "s", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
