/**
 * Embedding wrapper with a content-hash cache. All embedding traffic flows
 * through gateway.embed, so it is retried, rate-limited, and ledgered like any
 * other external call. Identical text (overlapping pages, re-runs) costs nothing.
 */

import { createHash } from "crypto";
import { TTLCache } from "@/lib/infra/cache";
import { config } from "@/lib/config";
import type { Gateway } from "@/lib/gateway";

const embeddingCache = new TTLCache<number[]>(config.store.ttlMs);

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * Embed a batch of texts, using the cache for any already-seen content and a
 * single batched gateway.embed call for the rest.
 */
export async function embedTexts(
  gateway: Gateway,
  texts: string[],
): Promise<number[][]> {
  const results: (number[] | null)[] = texts.map((t) => {
    return embeddingCache.get(hashText(t)) ?? null;
  });

  const misses: { index: number; text: string }[] = [];
  results.forEach((r, i) => {
    if (r === null) misses.push({ index: i, text: texts[i] });
  });

  if (misses.length > 0) {
    const vectors = await gateway.embed(misses.map((m) => m.text));
    misses.forEach((m, j) => {
      const vector = vectors[j];
      embeddingCache.set(hashText(m.text), vector);
      results[m.index] = vector;
    });
  }

  return results as number[][];
}

export async function embedQuery(
  gateway: Gateway,
  query: string,
): Promise<number[]> {
  const [vec] = await embedTexts(gateway, [query]);
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
