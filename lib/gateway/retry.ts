/**
 * Exponential backoff with jitter. Retries only on transient failures
 * (configured status codes + network error codes). Respects Retry-After on 429.
 */

import { config } from "@/lib/config";

export interface RetriableError {
  status?: number;
  code?: string;
  retryAfterMs?: number;
}

function isRetriable(err: RetriableError): boolean {
  const { retriableStatus, retriableCodes } = config.gateway.retry;
  if (err.status && (retriableStatus as readonly number[]).includes(err.status)) {
    return true;
  }
  if (err.code && (retriableCodes as readonly string[]).includes(err.code)) {
    return true;
  }
  return false;
}

function classify(err: unknown): RetriableError {
  const e = err as {
    status?: number;
    code?: string;
    headers?: Record<string, string>;
    response?: { headers?: Record<string, string> };
  };
  let retryAfterMs: number | undefined;
  const headers = e?.headers ?? e?.response?.headers;
  const retryAfter = headers?.["retry-after"];
  if (retryAfter) {
    const secs = parseFloat(retryAfter);
    if (Number.isFinite(secs)) retryAfterMs = secs * 1000;
  }
  return { status: e?.status, code: e?.code, retryAfterMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (attempt: number, delayMs: number) => void,
): Promise<T> {
  const { maxAttempts, baseDelayMs, jitterRatio } = config.gateway.retry;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const classified = classify(err);
      if (attempt >= maxAttempts || !isRetriable(classified)) {
        throw err;
      }
      const exp = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = exp * jitterRatio * (Math.random() * 2 - 1);
      const delay = classified.retryAfterMs ?? Math.max(0, exp + jitter);
      onRetry?.(attempt, delay);
      await sleep(delay);
    }
  }

  throw lastErr;
}
