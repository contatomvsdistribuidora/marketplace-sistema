/**
 * Tests for the lazy + bulk attribute-sync infrastructure.
 *
 * Mocks mirror brand-sync.test.ts: in-memory rows for the two new tables
 * and a stub on the network call so we don't have to mock global fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/env", () => ({
  ENV: { shopeePartnerId: "1", shopeePartnerKey: "k", cookieSecret: "c" },
}));

const state = {
  cache: [] as any[],
  progress: [] as any[],
};

let progressIdSeq = 1;
let cacheIdSeq = 1;

vi.mock("../db", () => {
  const selectChain = () => {
    let currentTable: string | null = null;
    const chain: any = {
      from: (table: any) => {
        currentTable =
          (table?._?.name as string) || (table?.[Symbol.for("drizzle:Name")] as string);
        return chain;
      },
      where: () => chain,
      limit: (n: number) => {
        const rows =
          currentTable === "shopee_category_attribute_cache" ? state.cache : state.progress;
        return Promise.resolve(rows.slice(0, n));
      },
      orderBy: () => chain,
      execute: () => Promise.resolve([]),
      then: (resolve: any) => {
        const rows =
          currentTable === "shopee_category_attribute_cache" ? state.cache : state.progress;
        return Promise.resolve(rows).then(resolve);
      },
    };
    return chain;
  };

  const insertChain = (table: any) => ({
    values: (data: any) => {
      const tableName: string =
        (table?._?.name as string) || (table?.[Symbol.for("drizzle:Name")] as string);
      const rows = Array.isArray(data) ? data : [data];
      for (const r of rows) {
        if (tableName === "shopee_category_attribute_cache") {
          state.cache.push({ id: cacheIdSeq++, updatedAt: new Date(), ...r });
        } else if (tableName === "shopee_category_attribute_sync_progress") {
          state.progress.push({
            id: progressIdSeq++,
            createdAt: new Date(),
            updatedAt: new Date(),
            attributeCount: 0,
            lastSyncedAt: null,
            errorMessage: null,
            ...r,
          });
        }
      }
      return Promise.resolve();
    },
  });

  const updateChain = (table: any) => {
    let pending: any = null;
    return {
      set: (payload: any) => {
        pending = payload;
        return {
          where: () => {
            const tableName: string =
              (table?._?.name as string) || (table?.[Symbol.for("drizzle:Name")] as string);
            const rows =
              tableName === "shopee_category_attribute_cache" ? state.cache : state.progress;
            for (const row of rows) Object.assign(row, pending, { updatedAt: new Date() });
            return Promise.resolve();
          },
        };
      },
    };
  };

  const chain: any = {
    select: () => selectChain(),
    selectDistinct: () => selectChain(),
    insert: (table: any) => insertChain(table),
    update: (table: any) => updateChain(table),
  };
  return { db: chain, getSetting: vi.fn(), setSetting: vi.fn() };
});

const mockGetValidToken = vi.fn();
vi.mock("../shopee", () => ({
  getValidToken: (...a: any[]) => mockGetValidToken(...a),
}));

vi.mock("../../drizzle/schema", () => {
  const tagged = (name: string) => ({
    [Symbol.for("drizzle:Name")]: name,
    _: { name },
    shopeeAccountId: { name: "shopeeAccountId" },
    categoryId: { name: "categoryId" },
    region: { name: "region" },
    language: { name: "language" },
    id: { name: "id" },
    status: { name: "status" },
    updatedAt: { name: "updatedAt" },
    lastSyncedAt: { name: "lastSyncedAt" },
  });
  return {
    shopeeCategoryAttributeCache: tagged("shopee_category_attribute_cache"),
    shopeeCategoryAttributeSyncProgress: tagged("shopee_category_attribute_sync_progress"),
  };
});

vi.mock("drizzle-orm", () => {
  const eq = (col: any, val: any) => ({ kind: "eq", col: col?.name ?? "?", val });
  const and = (...preds: any[]) => ({ kind: "and", preds });
  const inArray = (col: any, vals: any[]) => ({ kind: "in", col: col?.name ?? "?", vals });
  return { eq, and, inArray };
});

import {
  syncAttributesForCategory,
  getAttributesForCategory,
  TTL_MS,
} from "./attribute-sync";
import { __test as attributeTreeTest, parseAttribute } from "./attribute-tree";

const fetchSpy = vi.spyOn(attributeTreeTest, "fetchAttributeTree");

beforeEach(() => {
  state.cache.length = 0;
  state.progress.length = 0;
  progressIdSeq = 1;
  cacheIdSeq = 1;
  mockGetValidToken.mockReset();
  mockGetValidToken.mockResolvedValue({ accessToken: "tok", shopId: 1311085163 });
  fetchSpy.mockReset();
});

describe("syncAttributesForCategory", () => {
  it("returns fromCache=true when last_synced_at < 24h", async () => {
    state.progress.push({
      id: 1,
      shopeeAccountId: 7,
      categoryId: 101208,
      language: "pt-BR",
      status: "done",
      attributeCount: 13,
      lastSyncedAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    });
    const out = await syncAttributesForCategory(7, 101208);
    expect(out.fromCache).toBe(true);
    expect(out.count).toBe(13);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cache miss: calls Shopee, persists progress=done, writes cache", async () => {
    fetchSpy.mockResolvedValueOnce([
      {
        category_id: 101208,
        attribute_tree: [
          {
            attribute_id: 100002,
            display_attribute_name: "Marca",
            original_attribute_name: "Brand",
            is_mandatory: true,
            input_type: 1,
            attribute_value_list: [
              { value_id: 1, original_value_name: "Nike", display_value_name: "Nike" },
            ],
          },
        ],
      },
    ]);
    const out = await syncAttributesForCategory(7, 101208);
    expect(out.fromCache).toBe(false);
    expect(out.count).toBe(1);
    const progress = state.progress.find((p) => p.categoryId === 101208);
    expect(progress?.status).toBe("done");
    expect(progress?.attributeCount).toBe(1);
    const cached = state.cache.find((c) => c.categoryId === 101208);
    expect(Array.isArray(cached?.attributeTree)).toBe(true);
    expect((cached?.attributeTree as any[]).length).toBe(1);
  });

  it("13 attributes (Sacos Plásticos cat 101208) round-trip into cache", async () => {
    const attrs = Array.from({ length: 13 }, (_, i) => ({
      attribute_id: 1000 + i,
      display_attribute_name: `Atributo ${i}`,
      original_attribute_name: `Attribute ${i}`,
      is_mandatory: i < 3,
      input_type: 1,
      attribute_value_list: [],
    }));
    fetchSpy.mockResolvedValueOnce([{ category_id: 101208, attribute_tree: attrs }]);
    const out = await syncAttributesForCategory(7, 101208);
    expect(out.count).toBe(13);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const cached = state.cache.find((c) => c.categoryId === 101208);
    expect(cached?.attributeCount).toBe(13);
  });

  it("on Shopee error, marks progress status=error and rethrows", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("boom"));
    await expect(syncAttributesForCategory(7, 101208)).rejects.toThrow();
    const progress = state.progress.find((p) => p.categoryId === 101208);
    expect(progress?.status).toBe("error");
    expect(progress?.errorMessage).toContain("boom");
  });
});

describe("getAttributesForCategory", () => {
  it("dispatches background sync when cache is empty", async () => {
    fetchSpy.mockResolvedValueOnce([{ category_id: 101208, attribute_tree: [] }]);
    const out = await getAttributesForCategory(7, 101208);
    expect(out).toEqual([]);
    // withRateLimit sleeps 200ms before first attempt — give it room.
    await new Promise((r) => setTimeout(r, 250));
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("serves parsed cache when fresh", async () => {
    state.cache.push({
      id: 1,
      region: "BR",
      categoryId: 101208,
      language: "pt-BR",
      attributeTree: [
        {
          attribute_id: 100002,
          display_attribute_name: "Marca",
          original_attribute_name: "Brand",
          is_mandatory: true,
          input_type: 1,
          attribute_value_list: [
            { value_id: 5, original_value_name: "Nike", display_value_name: "Nike" },
          ],
        },
      ],
      attributeCount: 1,
      updatedAt: new Date(Date.now() - 60_000),
    });
    const out = await getAttributesForCategory(7, 101208);
    expect(out).toHaveLength(1);
    expect(out[0].input_type).toBe("DROP_DOWN");
    expect(out[0].display_attribute_name).toBe("Marca");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves stale-while-revalidate when cache is older than TTL", async () => {
    state.cache.push({
      id: 1,
      region: "BR",
      categoryId: 101208,
      language: "pt-BR",
      attributeTree: [
        {
          attribute_id: 1,
          display_attribute_name: "Old",
          original_attribute_name: "Old",
          is_mandatory: false,
          input_type: 3,
          attribute_value_list: [],
        },
      ],
      attributeCount: 1,
      updatedAt: new Date(Date.now() - TTL_MS - 1000),
    });
    fetchSpy.mockResolvedValueOnce([{ category_id: 101208, attribute_tree: [] }]);
    const out = await getAttributesForCategory(7, 101208);
    expect(out).toHaveLength(1);
    expect(out[0].display_attribute_name).toBe("Old");
    await new Promise((r) => setImmediate(r));
  });
});

describe("parseAttribute", () => {
  it("input_type=1 with values → DROP_DOWN", () => {
    const out = parseAttribute({
      attribute_id: 1,
      display_attribute_name: "Marca",
      original_attribute_name: "Brand",
      is_mandatory: true,
      input_type: 1,
      attribute_value_list: [
        { value_id: 5, original_value_name: "Nike", display_value_name: "Nike" },
      ],
    });
    expect(out.input_type).toBe("DROP_DOWN");
    expect(out._api_input_type).toBe(1);
    expect(out.attribute_value_list[0].original_value_name).toBe("Nike");
    expect(out.attribute_value_list[0].display_value_name).toBe("Nike");
  });

  it("input_type=1 with NO values → TEXT_FIELD", () => {
    const out = parseAttribute({
      attribute_id: 1,
      display_attribute_name: "Cor",
      original_attribute_name: "Color",
      is_mandatory: false,
      input_type: 1,
      attribute_value_list: [],
    });
    expect(out.input_type).toBe("TEXT_FIELD");
  });

  it("input_type=3 + validation=1 → INT_TYPE", () => {
    const out = parseAttribute({
      attribute_id: 1,
      display_attribute_name: "Quantidade",
      original_attribute_name: "Qty",
      is_mandatory: false,
      input_type: 3,
      input_validation_type: 1,
      attribute_value_list: [],
    });
    expect(out.input_type).toBe("INT_TYPE");
    expect(out.input_validation_type).toBe(1);
  });

  it("input_type=3 + validation=2 → FLOAT_TYPE", () => {
    const out = parseAttribute({
      attribute_id: 1,
      display_attribute_name: "Peso",
      original_attribute_name: "Weight",
      is_mandatory: false,
      input_type: 3,
      input_validation_type: 2,
      attribute_value_list: [],
    });
    expect(out.input_type).toBe("FLOAT_TYPE");
  });

  it("input_type=3 + no validation → TEXT_FIELD", () => {
    const out = parseAttribute({
      attribute_id: 1,
      display_attribute_name: "Notas",
      original_attribute_name: "Notes",
      is_mandatory: false,
      input_type: 3,
      attribute_value_list: [],
    });
    expect(out.input_type).toBe("TEXT_FIELD");
  });

  it("multi_lang pt-BR overrides display_value_name", () => {
    const out = parseAttribute({
      attribute_id: 1,
      display_attribute_name: "Brand",
      original_attribute_name: "Brand",
      is_mandatory: true,
      input_type: 1,
      attribute_value_list: [
        {
          value_id: 5,
          original_value_name: "X",
          display_value_name: "X",
          multi_lang: [{ language: "pt-BR", name: "Marca-X-PT" }],
        },
      ],
    });
    expect(out.attribute_value_list[0].display_value_name).toBe("Marca-X-PT");
    expect(out.attribute_value_list[0].multi_lang?.[0]?.name).toBe("Marca-X-PT");
  });
});
