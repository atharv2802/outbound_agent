/**
 * select_angles — picks two outreach angles. The distinct-type constraint is
 * enforced PROGRAMMATICALLY: if the model returns two angles of the same type,
 * the tool rejects with an error observation and the agent must re-select.
 */

import { z } from "zod";
import { config } from "@/lib/config";
import { callStructured } from "@/lib/guardrails/output";
import { anglesSchema } from "../schemas";
import type { RunState } from "../state";
import type { Angle, ToolResult } from "@/lib/types";

export const selectAnglesSchema = z.object({
  thought: z.string().describe("Your strategy for choosing two distinct angles."),
});

export type SelectAnglesArgs = z.infer<typeof selectAnglesSchema>;

export async function selectAngles(
  state: RunState,
  _args: SelectAnglesArgs,
): Promise<ToolResult> {
  if (!state.senderProfile || !state.buyerSignals || !state.fitEvaluation) {
    return {
      observation:
        "Need sender profile, buyer signals, and fit evaluation before selecting angles.",
      displayable: false,
      isError: true,
    };
  }

  state.emit({ type: "status", message: "Selecting two distinct angles…" });

  const system =
    "You are a sales strategist. Choose exactly TWO outreach angles that are of DIFFERENT types (pain-led, trigger-led, value-led, social-proof-led). Each angle: a clear label, a one-sentence thesis tying the sender's value to the target, and evidenceChunkIds drawn from the buyer signals / fit evaluation.\n\n" +
    "The two angles MUST be genuinely distinct so the resulting emails barely overlap: give them different `type` values, anchor each on DIFFERENT evidence (do not reuse the same chunkIds across both), and lead with different specific facts about the target. Avoid theses that are rewordings of each other — they should read as two separate strategic bets, not one idea phrased twice.";

  const user = `SENDER VALUE PROP: ${state.senderProfile.valueProp}\n\nFIT EVALUATION (JSON):\n${JSON.stringify(
    state.fitEvaluation,
  )}\n\nTARGET BUYER SIGNALS (JSON):\n${JSON.stringify(state.buyerSignals)}`;

  const { data } = await callStructured(state.gateway, {
    model: config.models.synthesis,
    tool: "select_angles",
    system,
    user,
    schema: anglesSchema,
    temperature: 0.4,
  });

  const [a, b] = data.angles;
  if (a.type === b.type) {
    return {
      observation: `Rejected: both angles are "${a.type}". The two angles MUST be different types. Re-select with distinct types.`,
      displayable: false,
      isError: true,
    };
  }

  const angles: [Angle, Angle] = [
    { type: a.type, label: a.label, thesis: a.thesis, evidenceChunkIds: a.evidenceChunkIds },
    { type: b.type, label: b.label, thesis: b.thesis, evidenceChunkIds: b.evidenceChunkIds },
  ];
  state.angles = angles;

  return {
    observation: `Selected two angles: [0] ${angles[0].type} — ${angles[0].label}; [1] ${angles[1].type} — ${angles[1].label}. Now draft_email for each.`,
    displayable: true,
    data: { type: "angles", angles },
  };
}
