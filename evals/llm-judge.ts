/**
 * LLM-as-judge email rubric scorer. Pinned model + temperature 0 for
 * repeatability. Scores personalization / specificity / CTA clarity / length,
 * 1-5 each, against a fixed rubric.
 */

import { z } from "zod";
import { config } from "@/lib/config";
import type { Gateway } from "@/lib/gateway";
import { callStructured } from "@/lib/guardrails/output";
import type { Email } from "@/lib/types";

const judgeSchema = z.object({
  personalization: z.number(),
  specificity: z.number(),
  ctaClarity: z.number(),
  length: z.number(),
  rationale: z.string(),
});

export interface JudgeScore {
  personalization: number;
  specificity: number;
  ctaClarity: number;
  length: number;
  avg: number;
  rationale: string;
}

const RUBRIC = `Score this B2B cold email 1-5 on each dimension (5 = excellent):
- personalization: is the opening specific to the recipient company, not generic? A soft paraphrase, a compliment ("impressive"), or anything copy-pasteable to another company is at most a 3 — only a hard, unmistakably-them fact (a specific number, named product, or specific role) earns 4-5.
- specificity: are claims concrete and evidence-like rather than vague?
- ctaClarity: is there exactly one clear, low-friction call to action?
- length: is it appropriately concise (roughly 70-95 words, <= 120 max, scannable)? Too short (< 65 words) or padded (> 110) should score at most 3.
Be a strict but fair reviewer.`;

export async function judgeEmail(
  gateway: Gateway,
  email: Email,
): Promise<JudgeScore> {
  const { data } = await callStructured(gateway, {
    model: config.models.orchestration,
    tool: "llm_judge",
    system: RUBRIC,
    user: `SUBJECT: ${email.subject}\n\nBODY:\n${email.body}`,
    schema: judgeSchema,
    temperature: 0,
  });

  const clamp = (n: number) => Math.max(1, Math.min(5, n));
  const personalization = clamp(data.personalization);
  const specificity = clamp(data.specificity);
  const ctaClarity = clamp(data.ctaClarity);
  const length = clamp(data.length);
  const avg = (personalization + specificity + ctaClarity + length) / 4;

  return {
    personalization,
    specificity,
    ctaClarity,
    length,
    avg: Number(avg.toFixed(2)),
    rationale: data.rationale,
  };
}
