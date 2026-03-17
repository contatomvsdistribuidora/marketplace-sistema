import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("Product Name Filter - Contains/Not Contains", () => {
  const caller = appRouter.createCaller(createAuthContext().ctx);

  it("should accept searchNameMode 'contains' in filterProducts input", async () => {
    // This tests that the input schema accepts the new searchNameMode field
    try {
      await caller.baselinker.filterProducts({
        inventoryId: 1,
        filters: {
          searchName: "tintas",
          searchNameMode: "contains",
        },
        page: 1,
        pageSize: 10,
      });
    } catch (error: any) {
      // May fail due to missing token/inventory, but should NOT fail on input validation
      expect(error.message).not.toContain("invalid_type");
      expect(error.message).not.toContain("invalid_enum_value");
    }
  });

  it("should accept searchNameMode 'not_contains' in filterProducts input", async () => {
    try {
      await caller.baselinker.filterProducts({
        inventoryId: 1,
        filters: {
          searchName: "tintas",
          searchNameMode: "not_contains",
        },
        page: 1,
        pageSize: 10,
      });
    } catch (error: any) {
      // May fail due to missing token/inventory, but should NOT fail on input validation
      expect(error.message).not.toContain("invalid_type");
      expect(error.message).not.toContain("invalid_enum_value");
    }
  });

  it("should work without searchNameMode (backward compatible)", async () => {
    try {
      await caller.baselinker.filterProducts({
        inventoryId: 1,
        filters: {
          searchName: "tintas",
          // No searchNameMode - should default to "contains"
        },
        page: 1,
        pageSize: 10,
      });
    } catch (error: any) {
      // May fail due to missing token/inventory, but should NOT fail on input validation
      expect(error.message).not.toContain("invalid_type");
      expect(error.message).not.toContain("invalid_enum_value");
    }
  });

  it("should reject invalid searchNameMode values", async () => {
    try {
      await caller.baselinker.filterProducts({
        inventoryId: 1,
        filters: {
          searchName: "tintas",
          searchNameMode: "invalid_mode" as any,
        },
        page: 1,
        pageSize: 10,
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Should fail on input validation (Zod v3 uses 'Invalid option' for enum errors)
      expect(error.message).toMatch(/invalid_enum_value|Invalid option/);
    }
  });
});
