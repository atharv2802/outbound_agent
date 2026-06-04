/**
 * synthesize_icp — LLM sub-call over the compact structured company signals
 * (not raw markdown). Produces the value prop + ICP with per-dimension
 * provenance, builds the SenderProfile, persists it by domain, and streams the
 * sender-analysis result.
 */

import { z } from "zod";
import { config } from "@/lib/config";
import { callStructured } from "@/lib/guardrails/output";
import { icpSynthesisSchema } from "../schemas";
import { saveSenderProfile } from "../store";
import type { RunState } from "../state";
import type { SenderProfile, ToolResult } from "@/lib/types";

export const synthesizeIcpSchema = z.object({
  thought: z.string().describe("Why the evidence is now sufficient to synthesize."),
});

export type SynthesizeIcpArgs = z.infer<typeof synthesizeIcpSchema>;

export async function synthesizeIcp(
  state: RunState,
  _args: SynthesizeIcpArgs,
): Promise<ToolResult> {
  if (!state.companySignals) {
    return {
      observation:
        "No company signals collected yet. Call analyze_page (focus=company_signals) first.",
      displayable: false,
      isError: true,
    };
  }

  state.emit({ type: "status", message: "Synthesizing value prop + ICP…" });

  const system =
    "You are a sales strategist. From the structured COMPANY SIGNALS, synthesize a crisp value proposition (2-3 sentences) and a complete Ideal Customer Profile.\n\n" +
    "Populate ALL six ICP dimensions — industries, companySizes, personas, triggers, pains, disqualifiers — with at least one concrete entry each. Leaving a dimension empty is not acceptable; an ICP is the core deliverable.\n\n" +
    "Distinguish two kinds of content:\n" +
    "- Verifiable facts (industries, pains, proof points): ground these in the signals and cite the supporting chunkIds.\n" +
    "- Strategic inferences (companySizes and personas, i.e. who buys this): these are rarely stated verbatim on a homepage, so DERIVE them from the targetAudience, productDescription, pricingModel, and differentiators. For companySizes infer the company-size segment(s) the product fits (e.g. \"Startups (1-50)\", \"Mid-market (50-500)\", \"Enterprise\"). For personas infer the buyer roles who own this problem (e.g. \"VP of Sales\", \"Head of Growth\", \"RevOps\"). Cite whatever chunkIds informed the inference; if none directly apply, leave that dimension's chunkIds empty but still provide the value.\n\n" +
    "Inferring a plausible buyer segment/persona from positioning is expected sales reasoning — it is NOT inventing facts. Do not, however, fabricate specific metrics, customer names, or numbers. Reflect genuine uncertainty in `confidence` and `evidenceGaps`, never by leaving an ICP dimension blank.";

  const user = `COMPANY SIGNALS (JSON):\n${JSON.stringify(state.companySignals)}`;

  const { data } = await callStructured(state.gateway, {
    model: config.models.synthesis,
    tool: "synthesize_icp",
    system,
    user,
    schema: icpSynthesisSchema,
    temperature: 0.3,
  });

  const profile: SenderProfile = {
    domain: state.scopeDomain,
    companyName: data.companyName,
    valueProp: data.valueProp,
    valuePropChunkIds: data.valuePropChunkIds,
    icp: {
      industries: data.icp.industries,
      companySizes: data.icp.companySizes,
      personas: data.icp.personas,
      triggers: data.icp.triggers,
      pains: data.icp.pains,
      disqualifiers: data.icp.disqualifiers,
    },
    confidence: data.confidence,
    evidenceGaps: data.evidenceGaps,
    createdAt: Date.now(),
  };

  state.senderProfile = profile;
  saveSenderProfile(profile);

  return {
    observation: `Synthesized ICP for ${profile.companyName} (confidence: ${profile.confidence}). Value prop and ICP are ready.`,
    displayable: true,
    data: { type: "sender_analysis", profile },
  };
}
