/**
 * In-memory hybrid retrieval store, scoped to a single agent run.
 *
 * Embeddings (cosine) are primary; BM25 is an additive re-rank boost. Search
 * returns top-k snippets each carrying chunkId + sourceUrl — the only path by
 * which page content reaches a reasoning LLM.
 */

import type { Gateway } from "@/lib/gateway";
import type { Chunk, Snippet } from "@/lib/types";
import { config } from "@/lib/config";
import { BM25 } from "./bm25";
import { cosineSimilarity, embedQuery, embedTexts } from "./embed";

interface StoredChunk extends Chunk {
  vector: number[];
}

function normalize(scores: Map<string, number>): Map<string, number> {
  const values = [...scores.values()];
  if (values.length === 0) return scores;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const out = new Map<string, number>();
  for (const [k, v] of scores) out.set(k, (v - min) / range);
  return out;
}

export class RetrievalIndex {
  private chunks = new Map<string, StoredChunk>();
  private bm25 = new BM25();
  private fetchedUrls = new Set<string>();

  get size(): number {
    return this.chunks.size;
  }

  hasUrl(url: string): boolean {
    return this.fetchedUrls.has(url);
  }

  markFetched(url: string): void {
    this.fetchedUrls.add(url);
  }

  getChunk(chunkId: string): Chunk | undefined {
    return this.chunks.get(chunkId);
  }

  getChunks(chunkIds: string[]): Chunk[] {
    return chunkIds
      .map((id) => this.chunks.get(id))
      .filter((c): c is StoredChunk => Boolean(c));
  }

  async add(gateway: Gateway, chunks: Chunk[]): Promise<number> {
    if (chunks.length === 0) return 0;
    const vectors = await embedTexts(
      gateway,
      chunks.map((c) => `${c.heading}\n${c.text}`),
    );
    chunks.forEach((chunk, i) => {
      this.chunks.set(chunk.chunkId, { ...chunk, vector: vectors[i] });
      this.bm25.add(chunk.chunkId, `${chunk.heading} ${chunk.text}`);
    });
    return chunks.length;
  }

  async search(
    gateway: Gateway,
    query: string,
    k: number = config.retrieval.defaultK,
    urlFilter?: string,
  ): Promise<Snippet[]> {
    if (this.chunks.size === 0) return [];

    const queryVec = await embedQuery(gateway, query);
    const cosineScores = new Map<string, number>();
    for (const [id, chunk] of this.chunks) {
      if (urlFilter && !chunk.sourceUrl.includes(urlFilter)) continue;
      cosineScores.set(id, cosineSimilarity(queryVec, chunk.vector));
    }

    const bm25Raw = this.bm25.score(query);
    const bm25Scores = new Map<string, number>();
    for (const [id, score] of bm25Raw) {
      if (urlFilter) {
        const chunk = this.chunks.get(id);
        if (!chunk || !chunk.sourceUrl.includes(urlFilter)) continue;
      }
      bm25Scores.set(id, score);
    }

    const normCosine = normalize(cosineScores);
    const normBm25 = normalize(bm25Scores);
    const alpha = config.retrieval.bm25Alpha;

    const hybrid = new Map<string, number>();
    for (const id of cosineScores.keys()) {
      const c = normCosine.get(id) ?? 0;
      const b = normBm25.get(id) ?? 0;
      hybrid.set(id, c + alpha * b);
    }

    return [...hybrid.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([id, score]) => {
        const chunk = this.chunks.get(id)!;
        return {
          chunkId: chunk.chunkId,
          sourceUrl: chunk.sourceUrl,
          heading: chunk.heading,
          text: chunk.text,
          score: Number(score.toFixed(4)),
        };
      });
  }
}
