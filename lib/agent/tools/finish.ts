/**
 * finish — terminal tool. Assembles the final claim map from all VERIFIED
 * draft_email claims (merged, deduped, grouped by source URL), surfaces the
 * verified/total ratio, and lists any stripped claims transparently.
 */

import { z } from "zod";
import type { RunState } from "../state";
import type { Claim, ClaimGroup, ClaimMap, ToolResult } from "@/lib/types";

export const finishSchema = z.object({
  thought: z.string().describe("Why the run is complete."),
  summary: z
    .string()
    .describe("A short executive headline summarizing the run, shown above the results."),
});

export type FinishArgs = z.infer<typeof finishSchema>;

export async function finish(state: RunState, args: FinishArgs): Promise<ToolResult> {
  const allClaims: Claim[] = state.emails.flatMap((e) => e.claims);
  const verified = allClaims.filter((c) => c.status === "verified");
  const stripped = allClaims.filter((c) => c.status === "unsupported");

  // Dedupe verified by chunkId + normalized text, group by sourceUrl.
  const seen = new Set<string>();
  const groupsMap = new Map<string, Claim[]>();
  for (const c of verified) {
    const key = `${c.chunkId}::${c.text.toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = groupsMap.get(c.sourceUrl) ?? [];
    list.push(c);
    groupsMap.set(c.sourceUrl, list);
  }

  const groups: ClaimGroup[] = [...groupsMap.entries()].map(([sourceUrl, claims]) => ({
    sourceUrl,
    claims,
  }));

  const claimMap: ClaimMap = {
    type: "claim_map",
    summary: args.summary,
    verified: verified.length,
    total: allClaims.length,
    groups,
    stripped,
  };

  return {
    observation: `Run complete. ${verified.length}/${allClaims.length} claims verified.`,
    displayable: true,
    data: claimMap,
    terminal: true,
  };
}
