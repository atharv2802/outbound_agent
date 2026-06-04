/**
 * Lightweight BM25 keyword scorer. On a small per-run corpus IDF stats are weak,
 * so this is a re-rank boost over embeddings (see config.retrieval.bm25Alpha),
 * not the primary signal. Exact-term matches (product names, numbers, proper
 * nouns) are where it earns its keep.
 */

const K1 = 1.5;
const B = 0.75;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "be", "as", "at", "by", "this", "that", "it", "we", "you", "our",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface Doc {
  id: string;
  terms: string[];
  length: number;
  termFreq: Map<string, number>;
}

export class BM25 {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgLength = 0;

  add(id: string, text: string): void {
    const terms = tokenize(text);
    const termFreq = new Map<string, number>();
    for (const t of terms) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    for (const t of termFreq.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.push({ id, terms, length: terms.length, termFreq });
    this.recomputeAvg();
  }

  private recomputeAvg(): void {
    if (this.docs.length === 0) {
      this.avgLength = 0;
      return;
    }
    this.avgLength =
      this.docs.reduce((sum, d) => sum + d.length, 0) / this.docs.length;
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** Returns a map of docId → raw BM25 score for the query. */
  score(query: string): Map<string, number> {
    const qTerms = tokenize(query);
    const scores = new Map<string, number>();
    for (const doc of this.docs) {
      let score = 0;
      for (const term of qTerms) {
        const tf = doc.termFreq.get(term);
        if (!tf) continue;
        const idf = this.idf(term);
        const denom =
          tf + K1 * (1 - B + (B * doc.length) / (this.avgLength || 1));
        score += idf * ((tf * (K1 + 1)) / denom);
      }
      if (score > 0) scores.set(doc.id, score);
    }
    return scores;
  }
}
