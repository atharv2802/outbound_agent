/**
 * Grounding gate (verify_claims). NOT agent-callable — it runs deterministically
 * inside draft_email's output path. Each claim is checked against its cited
 * chunk: a free lexical-overlap heuristic first, then a single gpt-4o-mini
 * yes/no for borderline cases. Unsupported claims are tagged so they can be
 * stripped before display. This is what keeps the claim map honest.
 */

import { nanoid } from "nanoid";
import { config } from "@/lib/config";
import type { Gateway } from "@/lib/gateway";
import type { RetrievalIndex } from "@/lib/retrieval";
import type { Claim, ClaimStatus } from "@/lib/types";
import { tokenize } from "@/lib/retrieval/bm25";

export interface RawClaim {
  text: string;
  chunkId: string;
}

const HIGH_OVERLAP = 0.6;
const LOW_OVERLAP = 0.2;

function lexicalOverlap(claim: string, snippet: string): number {
  const claimTerms = new Set(tokenize(claim));
  if (claimTerms.size === 0) return 0;
  const snippetTerms = new Set(tokenize(snippet));
  let hits = 0;
  for (const t of claimTerms) if (snippetTerms.has(t)) hits += 1;
  return hits / claimTerms.size;
}

async function llmEntails(
  gateway: Gateway,
  claim: string,
  snippet: string,
): Promise<boolean> {
  const res = await gateway.llm({
    model: config.models.orchestration,
    tool: "verify_claims",
    temperature: 0,
    maxTokens: 5,
    messages: [
      {
        role: "system",
        content:
          'You verify grounding. Answer with exactly "YES" if the SNIPPET directly supports the CLAIM, otherwise "NO". No other text.',
      },
      {
        role: "user",
        content: `SNIPPET:\n${snippet}\n\nCLAIM:\n${claim}\n\nDoes the snippet support the claim?`,
      },
    ],
  });
  return /yes/i.test(res.content ?? "");
}

export async function verifyClaims(
  gateway: Gateway,
  index: RetrievalIndex,
  rawClaims: RawClaim[],
): Promise<Claim[]> {
  const results: Claim[] = [];

  for (const raw of rawClaims) {
    const chunk = index.getChunk(raw.chunkId);
    const claimId = nanoid(8);

    if (!chunk) {
      results.push({
        claimId,
        text: raw.text,
        chunkId: raw.chunkId,
        sourceUrl: "",
        snippet: "",
        status: "unsupported",
        reason: "Cited chunk not found in index.",
      });
      continue;
    }

    const overlap = lexicalOverlap(raw.text, chunk.text);
    let status: ClaimStatus;
    let reason: string | undefined;

    if (overlap >= HIGH_OVERLAP) {
      status = "verified";
    } else if (overlap < LOW_OVERLAP) {
      status = "unsupported";
      reason = "Low lexical overlap with cited snippet.";
    } else {
      const entailed = await llmEntails(gateway, raw.text, chunk.text);
      status = entailed ? "verified" : "unsupported";
      if (!entailed) reason = "Judge found snippet does not support claim.";
    }

    results.push({
      claimId,
      text: raw.text,
      chunkId: raw.chunkId,
      sourceUrl: chunk.sourceUrl,
      snippet: chunk.text,
      status,
      reason,
    });
  }

  return results;
}
