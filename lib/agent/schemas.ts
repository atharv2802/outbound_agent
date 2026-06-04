/**
 * Zod schemas for structured LLM outputs. Used by callStructured to enforce
 * shape (with one repair attempt) and by zodToJsonSchema to instruct the model.
 */

import { z } from "zod";

const groundedString = z.object({
  value: z.string(),
  chunkIds: z.array(z.string()),
});

const groundedList = z.object({
  value: z.array(z.string()),
  chunkIds: z.array(z.string()),
});

export const companySignalsSchema = z.object({
  productDescription: groundedString,
  targetAudience: groundedString,
  painPointsAddressed: groundedList,
  proofPoints: groundedList,
  pricingModel: groundedString,
  differentiators: groundedList,
  technologies: groundedList,
});

export const buyerSignalsSchema = z.object({
  whatTheyDo: groundedString,
  industry: groundedString,
  scaleClues: groundedList,
  techStack: groundedList,
  recentInitiatives: groundedList,
  potentialPainPoints: groundedList,
  notableFacts: groundedList,
});

export const icpSynthesisSchema = z.object({
  companyName: z.string(),
  valueProp: z.string(),
  valuePropChunkIds: z.array(z.string()),
  icp: z.object({
    industries: groundedList,
    companySizes: groundedList,
    personas: groundedList,
    triggers: groundedList,
    pains: groundedList,
    disqualifiers: groundedList,
  }),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceGaps: z.array(z.string()),
});

export const fitEvaluationSchema = z.object({
  overallScore: z.number(),
  overallReasoning: z.string(),
  dimensions: z.array(
    z.object({
      dimension: z.string(),
      score: z.number(),
      reasoning: z.string(),
      chunkIds: z.array(z.string()),
    }),
  ),
  strongestSignals: groundedList,
  gapsRisks: groundedList,
});

export const anglesSchema = z.object({
  angles: z
    .array(
      z.object({
        type: z.enum(["pain-led", "trigger-led", "value-led", "social-proof-led"]),
        label: z.string(),
        thesis: z.string(),
        evidenceChunkIds: z.array(z.string()),
      }),
    )
    .length(2),
});

export const draftEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
  claims: z.array(
    z.object({
      text: z.string(),
      chunkId: z.string(),
    }),
  ),
});

export type CompanySignalsOut = z.infer<typeof companySignalsSchema>;
export type BuyerSignalsOut = z.infer<typeof buyerSignalsSchema>;
export type IcpSynthesisOut = z.infer<typeof icpSynthesisSchema>;
export type FitEvaluationOut = z.infer<typeof fitEvaluationSchema>;
export type AnglesOut = z.infer<typeof anglesSchema>;
export type DraftEmailOut = z.infer<typeof draftEmailSchema>;
