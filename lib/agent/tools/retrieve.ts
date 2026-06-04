/**
 * retrieve — hybrid (cosine + BM25) top-k search over the in-memory index. The
 * only path by which page content reaches a reasoning LLM. Returns snippets with
 * chunkId + sourceUrl so provenance survives into every downstream step.
 */

import { z } from "zod";
import { config } from "@/lib/config";
import type { RunState } from "../state";
import type { ToolResult } from "@/lib/types";

export const retrieveSchema = z.object({
  thought: z.string().describe("Why you need these snippets."),
  query: z.string().describe("A focused natural-language query for the evidence you need."),
  k: z.number().optional().describe("How many snippets to return (default 5)."),
  urlFilter: z
    .string()
    .optional()
    .describe("Optional substring to scope retrieval to one page."),
});

export type RetrieveArgs = z.infer<typeof retrieveSchema>;

export async function retrieve(
  state: RunState,
  args: RetrieveArgs,
): Promise<ToolResult> {
  const k = args.k ?? config.retrieval.defaultK;
  const snippets = await state.index.search(
    state.gateway,
    args.query,
    k,
    args.urlFilter,
  );

  state.emit({
    type: "retrieval",
    turn: state.turn,
    query: args.query,
    hits: snippets.length,
  });

  if (snippets.length === 0) {
    return {
      observation: `No snippets found for "${args.query}". Try a broader query or fetch a relevant page first.`,
      displayable: false,
    };
  }

  const formatted = snippets
    .map(
      (s, i) =>
        `[${i + 1}] chunkId=${s.chunkId} url=${s.sourceUrl} score=${s.score}\n${truncate(
          s.text,
          400,
        )}`,
    )
    .join("\n\n");

  return {
    observation: `Retrieved ${snippets.length} snippet(s) for "${args.query}":\n${formatted}`,
    displayable: false,
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
