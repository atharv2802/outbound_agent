/**
 * AbortController-based timeout wrapper. Passes a signal into the wrapped fn so
 * the underlying fetch / SDK call is actually cancelled, not just abandoned.
 */

export class TimeoutError extends Error {
  code = "ETIMEDOUT";
  constructor(ms: number, label: string) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  ms: number,
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new TimeoutError(ms, label);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
