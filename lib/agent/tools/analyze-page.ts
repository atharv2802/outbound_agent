/**
 * analyze_page — retrieve snippets for the focus area, then an LLM sub-call over
 * ONLY those retrieved snippets (no raw markdown). Extracts structured signals,
 * each carrying the supporting chunkId(s) so provenance survives into synthesis.
 */

import { z } from "zod";
import { config } from "@/lib/config";
import { callStructured } from "@/lib/guardrails/output";
import { wrapUntrustedSnippets } from "@/lib/guardrails/injection";
import {
  buyerSignalsSchema,
  companySignalsSchema,
} from "../schemas";
import type { RunState } from "../state";
import type { ToolResult } from "@/lib/types";

export const analyzePageSchema = z.object({
  thought: z.string().describe("Why you are analyzing now and what you expect to find."),
  focus: z
    .enum(["company_signals", "buyer_signals"])
    .describe("company_signals for the sender; buyer_signals for the target."),
  query: z
    .string()
    .optional()
    .describe("Optional retrieval query to focus the evidence."),
});

export type AnalyzePageArgs = z.infer<typeof analyzePageSchema>;

const DEFAULT_QUERIES: Record<string, string> = {
  company_signals:
    "product description, value proposition, target customers, pain points solved, pricing model, customer proof, differentiators, technology",
  buyer_signals:
    "what the company does, industry, company size and headcount, tech stack, recent initiatives and news, potential pain points, notable facts",
};

export async function analyzePage(
  state: RunState,
  args: AnalyzePageArgs,
): Promise<ToolResult> {
  const query = args.query ?? DEFAULT_QUERIES[args.focus];
  const snippets = await state.index.search(state.gateway, query, 8);

  state.emit({ type: "retrieval", turn: state.turn, query, hits: snippets.length });

  if (snippets.length === 0) {
    return {
      observation:
        "No indexed snippets to analyze yet. Fetch a relevant page first.",
      displayable: false,
      isError: true,
    };
  }

  const evidence = wrapUntrustedSnippets(snippets);
  const validChunkIds = snippets.map((s) => s.chunkId);

  const system =
    args.focus === "company_signals"
      ? "You extract structured COMPANY signals (the sender's own positioning) from retrieved snippets. Only use facts present in the snippets. Every field's chunkIds must be drawn from the provided snippet chunkIds. If unknown, use an empty value and empty chunkIds."
      : "You extract structured BUYER signals about a TARGET company from retrieved snippets. Only use facts present in the snippets. Every field's chunkIds must be drawn from the provided snippet chunkIds. If unknown, use an empty value and empty chunkIds.";

  const user = `Valid chunkIds: ${validChunkIds.join(", ")}\n\n${evidence}`;

  const emitRepair = (repaired: boolean) => {
    if (repaired) {
      state.emit({
        type: "guardrail",
        event: "schema_repair",
        reason: "analyze_page output repaired to match schema.",
        count: 1,
      });
    }
  };

  if (args.focus === "company_signals") {
    const { data, repaired } = await callStructured(state.gateway, {
      model: config.models.orchestration,
      tool: "analyze_page",
      system,
      user,
      schema: companySignalsSchema,
      temperature: 0.1,
    });
    emitRepair(repaired);
    state.companySignals = data;
    return {
      observation: `Extracted company signals. Product: ${truncate(
        data.productDescription.value,
        120,
      )}`,
      displayable: false,
    };
  }

  const { data, repaired } = await callStructured(state.gateway, {
    model: config.models.orchestration,
    tool: "analyze_page",
    system,
    user,
    schema: buyerSignalsSchema,
    temperature: 0.1,
  });
  emitRepair(repaired);
  state.buyerSignals = data;
  return {
    observation: `Extracted buyer signals. They do: ${truncate(
      data.whatTheyDo.value,
      100,
    )}. Industry: ${truncate(data.industry.value, 60)}`,
    displayable: false,
  };
}

function truncate(text: string, max: number): string {
  if (!text) return "(none)";
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
