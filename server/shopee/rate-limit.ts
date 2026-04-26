/**
 * Generic rate-limit + retry wrapper for Shopee API calls.
 *
 * - delayMs: minimum gap inserted before each attempt (200ms by default).
 * - maxRetries: how many times we retry on a *retryable* failure.
 *
 * Retryable: network errors (TypeError on fetch) and HTTP 429/500/502/503/504.
 * Non-retryable: 401/403 (auth) and any other 4xx — we fail fast so the
 * caller can surface the real Shopee error instead of waiting on backoff.
 *
 * Backoff is exponential: delayMs, delayMs*2, delayMs*4, ...
 */

export interface RateLimitOptions {
  delayMs?: number;
  maxRetries?: number;
  endpoint?: string;
}

export class ShopeeHttpError extends Error {
  status: number;
  body?: string;
  constructor(status: number, message: string, body?: string) {
    super(message);
    this.name = "ShopeeHttpError";
    this.status = status;
    this.body = body;
  }
}

const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  if (err instanceof ShopeeHttpError) return RETRYABLE_HTTP.has(err.status);
  // Network / fetch errors throw TypeError or generic Error; we treat them as retryable.
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("socket hang up")
    ) {
      return true;
    }
  }
  return false;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRateLimit<T>(
  fn: () => Promise<T>,
  options: RateLimitOptions = {},
): Promise<T> {
  const delayMs = options.delayMs ?? 200;
  const maxRetries = options.maxRetries ?? 3;
  const endpoint = options.endpoint ?? "shopee";

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt === 0) {
      await sleep(delayMs);
    } else {
      const backoff = delayMs * Math.pow(2, attempt - 1);
      console.log(`[Shopee RateLimit] retry attempt ${attempt} for ${endpoint} after ${backoff}ms`);
      await sleep(backoff);
    }

    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxRetries) {
        throw err;
      }
    }
  }
  throw lastErr;
}
