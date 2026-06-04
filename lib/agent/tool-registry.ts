/**
 * Tool registry: registration, per-mode tool sets, Zod arg schemas, JSON-schema
 * export for OpenAI function-calling, and safe dispatch (args validated before a
 * handler runs).
 *
 * verify_claims is intentionally NOT here — it is an automatic gate inside
 * draft_email's output path, never an agent-callable tool.
 */

import { z } from "zod";
import type { ToolSchema } from "@/lib/infra/llm-client";
import { zodToJsonSchema } from "@/lib/zod-schema";
import type { ToolResult } from "@/lib/types";
import type { AgentMode, RunState } from "./state";

import { fetchPage, fetchPageSchema } from "./tools/fetch-page";
import { retrieve, retrieveSchema } from "./tools/retrieve";
import { analyzePage, analyzePageSchema } from "./tools/analyze-page";
import { synthesizeIcp, synthesizeIcpSchema } from "./tools/synthesize-icp";
import { evaluateFit, evaluateFitSchema } from "./tools/evaluate-fit";
import { selectAngles, selectAnglesSchema } from "./tools/select-angles";
import { draftEmail, draftEmailSchemaArgs } from "./tools/draft-email";
import { finish, finishSchema } from "./tools/finish";

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  run: (state: RunState, rawArgs: unknown) => Promise<ToolResult>;
}

function def<A>(
  name: string,
  description: string,
  schema: z.ZodType<A>,
  handler: (state: RunState, args: A) => Promise<ToolResult>,
): ToolDef {
  return {
    name,
    description,
    schema,
    run: (state, rawArgs) => handler(state, schema.parse(rawArgs)),
  };
}

const fetchPageDef = def(
  "fetch_page",
  "Scrape, chunk, and index one or more pages within the target domain. Returns only an indexed-snippet summary, never page bodies.",
  fetchPageSchema,
  fetchPage,
);

const retrieveDef = def(
  "retrieve",
  "Hybrid top-k search over indexed pages. Returns grounded snippets with chunkIds. The only way to read page content.",
  retrieveSchema,
  retrieve,
);

const analyzePageDef = def(
  "analyze_page",
  "Extract structured signals from retrieved snippets (company_signals for sender, buyer_signals for target).",
  analyzePageSchema,
  analyzePage,
);

const synthesizeIcpDef = def(
  "synthesize_icp",
  "Synthesize the value proposition and ICP from collected company signals. Produces the sender profile.",
  synthesizeIcpSchema,
  synthesizeIcp,
);

const evaluateFitDef = def(
  "evaluate_fit",
  "Score the target against the sender's ICP with per-dimension reasoning.",
  evaluateFitSchema,
  evaluateFit,
);

const selectAnglesDef = def(
  "select_angles",
  "Select two outreach angles of DIFFERENT types. Rejected if both types match.",
  selectAnglesSchema,
  selectAngles,
);

const draftEmailDef = def(
  "draft_email",
  "Draft one email for a selected angle (angle_index 0 or 1). Claims are auto-verified against snippets.",
  draftEmailSchemaArgs,
  draftEmail,
);

const finishDef = def(
  "finish",
  "Finish the run. Provide a short executive summary headline. Assembles the verified claim map.",
  finishSchema,
  finish,
);

const SENDER_TOOLS: ToolDef[] = [
  fetchPageDef,
  retrieveDef,
  analyzePageDef,
  synthesizeIcpDef,
  finishDef,
];

const TARGET_TOOLS: ToolDef[] = [
  fetchPageDef,
  retrieveDef,
  analyzePageDef,
  evaluateFitDef,
  selectAnglesDef,
  draftEmailDef,
  finishDef,
];

export function getTools(mode: AgentMode): ToolDef[] {
  return mode === "sender" ? SENDER_TOOLS : TARGET_TOOLS;
}

export function getTool(mode: AgentMode, name: string): ToolDef | undefined {
  return getTools(mode).find((t) => t.name === name);
}

export function toToolSchemas(defs: ToolDef[]): ToolSchema[] {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: zodToJsonSchema(d.schema) as Record<string, unknown>,
  }));
}
