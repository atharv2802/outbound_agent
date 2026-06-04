/**
 * Central configuration. Model names are pinned here so they are trivial to
 * change in one place. Numeric limits read from env where it is useful to tune
 * them at deploy time, otherwise fall back to sensible defaults.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  models: {
    /** High-stakes synthesis, angle selection, and drafting. */
    synthesis: "gpt-4o-2024-08-06",
    /** High-frequency orchestration turns + cheap verification. */
    orchestration: "gpt-4o-mini-2024-07-18",
    /** Embeddings powering snippet grounding. */
    embedding: "text-embedding-3-small",
  },

  /** Approximate USD cost per 1K tokens, used only for the run-stats estimate. */
  pricing: {
    "gpt-4o-2024-08-06": { input: 0.0025, output: 0.01 },
    "gpt-4o-mini-2024-07-18": { input: 0.00015, output: 0.0006 },
    "text-embedding-3-small": { input: 0.00002, output: 0 },
  } as Record<string, { input: number; output: number }>,

  gateway: {
    retry: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      jitterRatio: 0.3,
      retriableStatus: [429, 500, 502, 503] as number[],
      retriableCodes: ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN"],
    },
    rateLimiter: {
      llm: { capacity: 30, refillPerMin: 30 },
      scrape: { capacity: 20, refillPerMin: 20 },
    },
    circuitBreaker: {
      failureThreshold: 5,
      openMs: 30_000,
      halfOpenMax: 2,
    },
    timeouts: {
      llmMs: 30_000,
      scrapeMs: 15_000,
      embedMs: 30_000,
    },
  },

  run: {
    tokenBudget: envInt("TOKEN_BUDGET", 60_000),
    /** When fewer than this many tokens remain, the agent is forced to finish. */
    finishThreshold: 2_000,
    wallClockMs: envInt("RUN_TIMEOUT_MS", 180_000),
    maxTurns: 16,
  },

  retrieval: {
    chunkTargetTokens: 300,
    chunkMinTokens: 40,
    chunkOverlapRatio: 0.15,
    defaultK: 5,
    /** Weight on the BM25 signal relative to cosine (embeddings-weighted). */
    bm25Alpha: 0.4,
    /** Minimum usable tokens after boilerplate strip before a page is "thin". */
    lowSignalTokenFloor: 80,
  },

  scrape: {
    jinaBase: "https://r.jina.ai/",
  },

  store: {
    /** TTL for cached pages, embeddings, and sender profiles. */
    ttlMs: 1000 * 60 * 30,
    senderProfileTtlMs: 1000 * 60 * 60,
  },
} as const;

export function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      "OPENAI_API_KEY is not set. Copy .env.example to .env.local and add your key.",
    );
  }
  return key;
}

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}
