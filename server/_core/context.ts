import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // TEMP: bypass auth
  const user = { id: 1, openId: "local_admin", name: "Admin", email: "admin@admin.com", role: "admin" as const, loginMethod: "email", passwordHash: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as User;

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
