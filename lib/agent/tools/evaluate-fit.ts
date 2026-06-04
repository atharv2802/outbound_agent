/**
 * evaluate_fit — scores the target against the SENDER's ICP. Reads the resolved
 * SenderProfile + collected buyer signals from state (explicit dependency, not
 * an ambient cache lookup). Streams the fit scorecard.
 */

import { z } from "zod";
import { config } from "@/lib/config";
import { callStructured } from "@/lib/guardrails/output";
import { fitEvaluationSchema } from "../schemas";
import type { RunState } from "../state";
import type { FitEvaluation, ToolResult } from "@/lib/types";

export const evaluateFitSchema = z.object({
  thought: z.string().describe("Why you are ready to evaluate fit."),
});

export type EvaluateFitArgs = z.infer<typeof evaluateFitSchema>;

export async function evaluateFit(
  state: RunState,
  _args: EvaluateFitArgs,
): Promise<ToolResult> {
  if (!state.senderProfile) {
    return {
      observation: "No sender profile available — cannot evaluate fit.",
      displayable: false,
      isError: true,
    };
  }
  if (!state.buyerSignals) {
    return {
      observation:
        "No buyer signals collected yet. Call analyze_page (focus=buyer_signals) first.",
      displayable: false,
      isError: true,
    };
  }

  state.emit({ type: "status", message: "Evaluating ICP fit…" });

  const sender = state.senderProfile;
  const system =
    "You are a sales strategist evaluating whether a TARGET company fits the SENDER's ICP. Score 1-10 overall and per ICP dimension (industry, company size, persona, triggers, pains). Ground each dimension's reasoning in the buyer-signal chunkIds. Be calibrated: a weak match should score low. Cite chunkIds that come from the buyer signals.";

  const user = `SENDER ICP (JSON):\n${JSON.stringify(sender.icp)}\n\nSENDER VALUE PROP: ${sender.valueProp}\n\nTARGET BUYER SIGNALS (JSON):\n${JSON.stringify(
    state.buyerSignals,
  )}`;

  const { data } = await callStructured(state.gateway, {
    model: config.models.synthesis,
    tool: "evaluate_fit",
    system,
    user,
    schema: fitEvaluationSchema,
    temperature: 0.2,
  });

  const evaluation: FitEvaluation = {
    overallScore: clampScore(data.overallScore),
    overallReasoning: data.overallReasoning,
    dimensions: data.dimensions.map((d) => ({
      dimension: d.dimension,
      score: clampScore(d.score),
      reasoning: d.reasoning,
      chunkIds: d.chunkIds,
    })),
    strongestSignals: data.strongestSignals,
    gapsRisks: data.gapsRisks,
  };

  state.fitEvaluation = evaluation;

  return {
    observation: `Fit evaluated: ${evaluation.overallScore}/10. ${truncate(
      evaluation.overallReasoning,
      160,
    )}`,
    displayable: true,
    data: { type: "fit_evaluation", evaluation },
  };
}

function clampScore(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
