/**
 * Local Authentication Module
 * Handles email/password registration and login, independent of Manus OAuth.
 * Uses bcryptjs for password hashing and the existing JWT session system.
 */

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import crypto from "crypto";
import { db } from "./db";

const SALT_ROUNDS = 12;

/**
 * Generate a unique openId for local users (not from Manus OAuth)
 */
function generateLocalOpenId(): string {
  // Use a prefix to distinguish local users from OAuth users
  const randomPart = crypto.randomUUID().replace(/-/g, "");
  return `local_${randomPart}`;
}

/**
 * Register a new user with email and password
 */
export async function registerUser(email: string, password: string, name: string) {

  // Check if email already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    throw new Error("Este email já está cadastrado. Tente fazer login.");
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Generate a unique openId for this local user
  const openId = generateLocalOpenId();

  // Insert user
  await db.insert(users).values({
    openId,
    email,
    name,
    passwordHash,
    loginMethod: "email",
    role: "user",
    lastSignedIn: new Date(),
  });

  // Get the created user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  if (!user) {
    throw new Error("Erro ao criar usuário");
  }

  // Create session token
  const sessionToken = await sdk.createSessionToken(openId, {
    name: name,
  });

  return { user, sessionToken };
}

/**
 * Login with email and password
 */
export async function loginUser(email: string, password: string) {

  // Find user by email
  let user: typeof users.$inferSelect | undefined;
  try {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    user = result[0];
  } catch (err: any) {
    console.error("[loginUser] DB query failed:", err?.message, "cause:", err?.cause?.message ?? err?.cause);
    throw new Error("Erro ao conectar ao banco de dados. Tente novamente.");
  }

  if (!user) {
    throw new Error("Email ou senha incorretos.");
  }

  if (!user!.passwordHash) {
    throw new Error("Esta conta usa login via Manus. Use o botão 'Entrar com Manus' para acessar.");
  }

  // Verify password
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw new Error("Email ou senha incorretos.");
  }

  // Update last signed in
  await db
    .update(users)
    .set({ lastSignedIn: new Date() })
    .where(eq(users.id, user.id));

  // Create session token
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name || "",
  });

  return { user, sessionToken };
}

/**
 * Change password for an existing user
 */
export async function changePassword(userId: number, currentPassword: string, newPassword: string) {

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error("Usuário não encontrado");
  }

  if (!user.passwordHash) {
    throw new Error("Esta conta não usa senha local");
  }

  // Verify current password
  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) {
    throw new Error("Senha atual incorreta");
  }

  // Hash new password
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Update password
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, userId));

  return { success: true };
}

/**
 * Get user by email (for checking if exists)
 */
export async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user || null;
}
