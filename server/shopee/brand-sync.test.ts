/**
 * Tests for the lazy + bulk brand-sync infrastructure.
 *
 * Mocks:
 *   - ../_core/env  → fixed partner credentials
 *   - ../db         → in-memory rows for shopeeBrandCache + shopeeBrandSyncProgress
 *   - ../shopee     → getValidToken returns a fixed token
 *   - ./brand-sync exports fetchBrandPage; we stub it directly via vi.spyOn so
 *     the tests don't have to mock global fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/env", () => ({
  ENV: { shopeePartnerId: "1", shopeePartnerKey: "k", cookieSecret: "c" },
}));

interface FakeRow {
  table: "shopee_brand_cache" | "shopee_brand_sync_progress";
  data: any;
}

const state = {
  cache: [] as any[],
  progress: [] as any[],
  inserts: [] as FakeRow[],
};

let progressIdSeq = 1;
let cacheIdSeq = 1;

vi.mock("../db", () => {
  // Drizzle's chained query builder: select().from(table).where(...).limit(1).
  // We reproduce just enough of the surface to exercise the brand-sync paths.
  const selectChain = () => {
    let currentTable: string | null = null;
    const filterPredicates: Array<(row: any) => boolean> = [];
    const chain: any = {
      from: (table: any) => {
        currentTable = (table?._?.name as string) || (table?.[Symbol.for("drizzle:Name")] as string);
        // The mocked schema (see below) sets Symbol.for("drizzle:Name").
        return chain;
      },
      where: (_predicate: any) => {
        // Predicates from drizzle are opaque — we just track that one was applied.
        filterPredicates.push(() => true);
        return chain;
      },
      limit: (_n: number) => {
        const rows = currentTable === "shopee_brand_cache" ? state.cache : state.progress;
        // The brand-sync code always filters by (account, category) or
        // (region, category); we mimic that by returning every row that
        // matches the most recently set filters tracked in state.queryFilters.
        const matched = rows.filter((r) => state.queryFilters.every((p) => p(r)));
        return Promise.resolve(matched.slice(0, _n));
      },
      orderBy: () => chain,
      execute: () => Promise.resolve([]),
      then: (resolve: any) => {
        const rows = currentTable === "shopee_brand_cache" ? state.cache : state.progress;
        const matched = rows.filter((r) => state.queryFilters.every((p) => p(r)));
        return Promise.resolve(matched).then(resolve);
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
        if (tableName === "shopee_brand_cache") {
          state.cache.push({ id: cacheIdSeq++, updatedAt: new Date(), ...r });
        } else if (tableName === "shopee_brand_sync_progress") {
          state.progress.push({
            id: progressIdSeq++,
            createdAt: new Date(),
            updatedAt: new Date(),
            totalBrands: 0,
            syncedPages: 0,
            lastSyncedAt: null,
            errorMessage: null,
            ...r,
          });
        }
        state.inserts.push({ table: tableName as any, data: r });
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
          where: (_predicate: any) => {
            const tableName: string =
              (table?._?.name as string) || (table?.[Symbol.for("drizzle:Name")] as string);
            const rows = tableName === "shopee_brand_cache" ? state.cache : state.progress;
            // Apply the patch to whichever subset matches the active filters.
            const matched = rows.filter((r) => state.queryFilters.every((p) => p(r)));
            for (const row of matched) Object.assign(row, pending, { updatedAt: new Date() });
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

// Replace the schema module with stubs that drizzle-style table objects can
// stand in for (only their name string is read by the mocked db chain).
vi.mock("../../drizzle/schema", () => {
  const tagged = (name: string) => ({
    [Symbol.for("drizzle:Name")]: name,
    _: { name },
    shopeeAccountId: { name: "shopeeAccountId" },
    categoryId: { name: "categoryId" },
    region: { name: "region" },
    id: { name: "id" },
    status: { name: "status" },
    updatedAt: { name: "updatedAt" },
    lastSyncedAt: { name: "lastSyncedAt" },
  });
  return {
    shopeeBrandCache: tagged("shopee_brand_cache"),
    shopeeBrandSyncProgress: tagged("shopee_brand_sync_progress"),
  };
});

// drizzle-orm exports `and` / `eq` — for our mock they only need to track
// the (table, value) pairs used so the where chain can filter correctly.
vi.mock("drizzle-orm", () => {
  const eq = (col: any, val: any) => ({ kind: "eq", col: col?.name ?? "?", val });
  const and = (...preds: any[]) => ({ kind: "and", preds });
  const inArray = (col: any, vals: any[]) => ({ kind: "in", col: col?.name ?? "?", vals });
  return { eq, and, inArray };
});

// The mock above tracks predicates via a side-channel because drizzle's
// where() takes opaque expressions. Easier route: each test seeds rows that
// already match what the SUT will filter by — the .filter(state.queryFilters)
// is then a no-op since we leave queryFilters empty.
(state as any).queryFilters = [] as Array<(r: any) => boolean>;

import {
  syncBrandsForCategory,
  getBrandsForCategory,
  fetchBrandPage,
  TTL_MS,
  __test,
} from "./brand-sync";
import { withRateLimit, ShopeeHttpError } from "./rate-limit";

const fetchSpy = vi.spyOn(__test, "fetchBrandPage");

beforeEach(() => {
  state.cache.length = 0;
  state.progress.length = 0;
  state.inserts.length = 0;
  progressIdSeq = 1;
  cacheIdSeq = 1;
  mockGetValidToken.mockReset();
  mockGetValidToken.mockResolvedValue({ accessToken: "tok", shopId: 1311085163 });
  fetchSpy.mockReset();
});

describe("syncBrandsForCategory", () => {
  it("returns fromCache=true when last_synced_at < 24h", async () => {
    state.progress.push({
      id: 1,
      shopeeAccountId: 7,
      categoryId: 101208,
      status: "done",
      totalBrands: 30,
      syncedPages: 1,
      lastSyncedAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    });
    const out = await syncBrandsForCategory(7, 101208);
    expect(out.fromCache).toBe(true);
    expect(out.totalBrands).toBe(30);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cache miss: calls Shopee, persists progress=done, writes cache", async () => {
    fetchSpy.mockResolvedValueOnce({
      brand_list: [{ brand_id: 1, original_brand_name: "Nike" }],
      is_end: true,
    });
    const out = await syncBrandsForCategory(7, 101208);
    expect(out.fromCache).toBe(false);
    expect(out.totalBrands).toBe(1);
    const progress = state.progress.find((p) => p.categoryId === 101208);
    expect(progress?.status).toBe("done");
    expect(progress?.totalBrands).toBe(1);
    const cached = state.cache.find((c) => c.categoryId === 101208);
    expect(cached?.brandList?.length).toBe(1);
  });

  it("paginates: 3 pages of 30 = 90 brands", async () => {
    const page = (start: number) =>
      Array.from({ length: 30 }, (_, i) => ({
        brand_id: start + i,
        original_brand_name: `B${start + i}`,
      }));
    fetchSpy
      .mockResolvedValueOnce({ brand_list: page(0), is_end: false })
      .mockResolvedValueOnce({ brand_list: page(30), is_end: false })
      .mockResolvedValueOnce({ brand_list: page(60), is_end: true });
    const out = await syncBrandsForCategory(7, 101208);
    expect(out.totalBrands).toBe(90);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const cached = state.cache.find((c) => c.categoryId === 101208);
    expect(cached?.brandList?.length).toBe(90);
  });

  it("stops at is_end=true even with full page", async () => {
    const page = Array.from({ length: 30 }, (_, i) => ({
      brand_id: i,
      original_brand_name: `B${i}`,
    }));
    fetchSpy.mockResolvedValueOnce({ brand_list: page, is_end: true });
    const out = await syncBrandsForCategory(7, 101208);
    expect(out.totalBrands).toBe(30);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("hard limit at 50 pages even if Shopee never sends is_end", async () => {
    const page = Array.from({ length: 30 }, (_, i) => ({
      brand_id: i,
      original_brand_name: `B${i}`,
    }));
    fetchSpy.mockResolvedValue({ brand_list: page, is_end: false });
    await syncBrandsForCategory(7, 101208);
    expect(fetchSpy).toHaveBeenCalledTimes(50);
  }, 30000);

  it("on Shopee error, marks progress status=error and rethrows", async () => {
    fetchSpy.mockRejectedValueOnce(new ShopeeHttpError(401, "auth"));
    await expect(syncBrandsForCategory(7, 101208)).rejects.toThrow();
    const progress = state.progress.find((p) => p.categoryId === 101208);
    expect(progress?.status).toBe("error");
    expect(progress?.errorMessage).toContain("auth");
  });
});

describe("getBrandsForCategory", () => {
  it("dispatches background sync when cache is empty", async () => {
    fetchSpy.mockResolvedValueOnce({ brand_list: [], is_end: true });
    const out = await getBrandsForCategory(7, 101208);
    expect(out).toEqual([]);
    // The dispatch goes through withRateLimit, which sleeps 200ms before
    // the first attempt. Give it room before asserting.
    await new Promise((r) => setTimeout(r, 250));
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("serves stale cache (stale-while-revalidate) when cache is older than TTL", async () => {
    state.cache.push({
      id: 1,
      region: "BR",
      categoryId: 101208,
      brandList: [{ brand_id: 5, original_brand_name: "Old" }],
      updatedAt: new Date(Date.now() - TTL_MS - 1000),
    });
    fetchSpy.mockResolvedValueOnce({ brand_list: [], is_end: true });
    const out = await getBrandsForCategory(7, 101208);
    expect(out).toEqual([{ brand_id: 5, original_brand_name: "Old" }]);
    await new Promise((r) => setImmediate(r));
  });
});

describe("withRateLimit", () => {
  it("retries on 429 up to maxRetries then throws", async () => {
    const fn = vi.fn().mockRejectedValue(new ShopeeHttpError(429, "rate"));
    await expect(
      withRateLimit(fn, { delayMs: 1, maxRetries: 3, endpoint: "test" }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it("does NOT retry on 401 (auth)", async () => {
    const fn = vi.fn().mockRejectedValue(new ShopeeHttpError(401, "no-auth"));
    await expect(
      withRateLimit(fn, { delayMs: 1, maxRetries: 3, endpoint: "test" }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns successfully after a transient retry", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ShopeeHttpError(503, "boom"))
      .mockResolvedValueOnce("ok");
    const out = await withRateLimit(fn, { delayMs: 1, maxRetries: 3, endpoint: "test" });
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("fetchBrandPage signature", () => {
  it("builds a properly formed request with deterministic HMAC", async () => {
    const calls: string[] = [];
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url: any) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ response: { brand_list: [], is_end: true } }),
      } as any;
    }) as any;
    try {
      const out = await fetchBrandPage("tok123", 1311085163, 101208, 0);
      expect(out.is_end).toBe(true);
      expect(calls[0]).toContain("/api/v2/product/get_brand_list");
      expect(calls[0]).toContain("category_id=101208");
      expect(calls[0]).toContain("page_size=30");
      expect(calls[0]).toMatch(/sign=[a-f0-9]{64}/);
    } finally {
      global.fetch = realFetch;
    }
  });
});
