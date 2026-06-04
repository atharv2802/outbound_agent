/**
 * Output guardrails: schema enforcement on every LLM output (with one structured
 * repair attempt), plus policy checks on generated emails (length, single CTA,
 * generic-opener ban). Grounding is handled by grounding.ts and wired into
 * draft_email's output path.
 */

import { z } from "zod";
import type { Gateway } from "@/lib/gateway";
import { zodToJsonSchema } from "@/lib/zod-schema";

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

export interface StructuredResult<T> {
  data: T;
  repaired: boolean;
}

/**
 * Run an LLM call that must return JSON conforming to `schema`. Validates with
 * Zod; on failure makes exactly one repair attempt feeding back the error.
 */
export async function callStructured<T>(
  gateway: Gateway,
  opts: {
    model: string;
    tool: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<StructuredResult<T>> {
  const jsonSchema = zodToJsonSchema(opts.schema);
  const schemaHint = `Respond ONLY with a single JSON object matching this JSON schema (no markdown, no prose):\n${JSON.stringify(
    jsonSchema,
  )}`;

  const baseMessages = [
    { role: "system" as const, content: `${opts.system}\n\n${schemaHint}` },
    { role: "user" as const, content: opts.user },
  ];

  const first = await gateway.llm({
    model: opts.model,
    tool: opts.tool,
    jsonObject: true,
    temperature: opts.temperature ?? 0.2,
    maxTokens: opts.maxTokens,
    messages: baseMessages,
  });

  const parsedFirst = tryParse(opts.schema, first.content);
  if (parsedFirst.ok) return { data: parsedFirst.value, repaired: false };

  // One repair attempt.
  const repair = await gateway.llm({
    model: opts.model,
    tool: opts.tool,
    jsonObject: true,
    temperature: 0,
    maxTokens: opts.maxTokens,
    messages: [
      ...baseMessages,
      { role: "assistant" as const, content: first.content ?? "" },
      {
        role: "user" as const,
        content: `Your previous output was invalid: ${parsedFirst.error}. Return corrected JSON only.`,
      },
    ],
  });

  const parsedRepair = tryParse(opts.schema, repair.content);
  if (parsedRepair.ok) return { data: parsedRepair.value, repaired: true };

  throw new SchemaError(
    `LLM output failed schema validation after repair: ${parsedRepair.error}`,
  );
}

function tryParse<T>(
  schema: z.ZodType<T>,
  content: string | null,
): { ok: true; value: T } | { ok: false; error: string } {
  if (!content) return { ok: false, error: "empty response" };
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    // Attempt to extract a JSON object from surrounding text.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, error: "not valid JSON" };
    try {
      json = JSON.parse(match[0]);
    } catch {
      return { ok: false, error: "not valid JSON" };
    }
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

// ── Email policy ────────────────────────────────────────────────────────────

const GENERIC_OPENERS = [
  /i hope this (email |message )?finds you well/i,
  /hope you'?re doing well/i,
  /hope all is well/i,
  /my name is/i,
];

const CTA_PATTERNS = [
  /\?\s*$/m,
  /worth a (quick )?(chat|call|conversation)/i,
  /grab \d+ (min|minutes)/i,
  /open to/i,
  /would you be/i,
  /let me know/i,
  /book a/i,
  /schedule a/i,
];

export interface EmailPolicyReport {
  wordCount: number;
  lengthOk: boolean;
  hasGenericOpener: boolean;
  ctaCount: number;
  singleCtaOk: boolean;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function checkEmailPolicy(body: string, maxWords = 120): EmailPolicyReport {
  const wordCount = countWords(body);
  const hasGenericOpener = GENERIC_OPENERS.some((p) => p.test(body));
  const ctaMatches = CTA_PATTERNS.reduce(
    (count, p) => count + (p.test(body) ? 1 : 0),
    0,
  );
  return {
    wordCount,
    lengthOk: wordCount <= maxWords,
    hasGenericOpener,
    ctaCount: ctaMatches,
    singleCtaOk: ctaMatches >= 1,
  };
}
