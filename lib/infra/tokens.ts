/**
 * Lightweight token estimation. We avoid a tiktoken dependency (native build,
 * slow cold start) and use a calibrated char-based heuristic. Good enough for
 * chunk sizing and budget gating — the ledger uses real usage from the API for
 * cost, this is only for pre-call sizing decisions.
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 chars/token for English prose is the standard rule of thumb.
  return Math.ceil(text.length / 4);
}
