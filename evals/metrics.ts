/**
 * Deterministic (non-LLM) metrics over a collected run: groundedness, ICP
 * coverage, schema validity, angle distinctiveness, and budget compliance.
 */

import { config } from "@/lib/config";
import { tokenize } from "@/lib/retrieval/bm25";
import type {
  Angle,
  ClaimMap,
  Email,
  FitEvaluation,
  RunStats,
  SenderProfile,
} from "@/lib/types";

export interface CollectedRun {
  senderProfile?: SenderProfile;
  fitEvaluation?: FitEvaluation;
  angles?: [Angle, Angle];
  emails: Email[];
  claimMap?: ClaimMap;
  stats?: RunStats;
  error?: string;
}

export interface MetricResult {
  name: string;
  value: number | string;
  pass: boolean;
  detail?: string;
}

/** % of shipped email claims that are verified. Target: 100%. */
export function groundedness(run: CollectedRun): MetricResult {
  const claims = run.emails.flatMap((e) => e.claims);
  if (claims.length === 0) {
    return { name: "Groundedness", value: "n/a", pass: true, detail: "no claims" };
  }
  const verified = claims.filter((c) => c.status === "verified").length;
  // The headline guarantee: nothing UNSUPPORTED is left in a displayed body.
  const shippedUnsupported = run.emails.some((e) =>
    e.claims.some(
      (c) => c.status === "unsupported" && bodyContains(e.body, c.text),
    ),
  );
  const pct = Math.round((verified / claims.length) * 100);
  return {
    name: "Groundedness",
    value: `${pct}% (${verified}/${claims.length})`,
    pass: !shippedUnsupported,
    detail: shippedUnsupported ? "an unsupported claim survived in a body" : "no ungrounded claim shipped",
  };
}

export function icpCoverage(
  run: CollectedRun,
  required: string[],
): MetricResult {
  if (!run.senderProfile) {
    return { name: "ICP coverage", value: "0%", pass: false, detail: "no profile" };
  }
  const icp = run.senderProfile.icp;
  const present = required.filter((dim) => {
    const field = (icp as unknown as Record<string, { value: string[] }>)[dim];
    return field && Array.isArray(field.value) && field.value.length > 0;
  });
  const pass = present.length === required.length;
  return {
    name: "ICP coverage",
    value: `${present.length}/${required.length}`,
    pass,
    detail: pass ? "all dimensions populated" : `missing: ${required.filter((d) => !present.includes(d)).join(", ")}`,
  };
}

export function schemaValidity(run: CollectedRun): MetricResult {
  // If the run produced typed results without error, schemas validated (the
  // runtime enforces Zod parsing with one repair on every LLM output).
  const ok = !run.error;
  return {
    name: "Schema validity",
    value: ok ? "100%" : "failed",
    pass: ok,
    detail: run.error ?? "all outputs parsed",
  };
}

export function angleDistinctiveness(run: CollectedRun): MetricResult {
  if (!run.angles) {
    return { name: "Angle distinctiveness", value: "n/a", pass: false, detail: "no angles" };
  }
  const [a, b] = run.angles;
  const differentType = a.type !== b.type;
  const overlap = bodyOverlap(run.emails);
  const pass = differentType && overlap < 0.6;
  return {
    name: "Angle distinctiveness",
    value: `types ${a.type}/${b.type}, overlap ${(overlap * 100).toFixed(0)}%`,
    pass,
    detail: differentType ? "distinct types" : "DUPLICATE types",
  };
}

export function budgetCompliance(run: CollectedRun): MetricResult {
  const tokens = run.stats?.tokens ?? 0;
  const ms = run.stats?.wallClockMs ?? 0;
  const tokenOk = tokens <= config.run.tokenBudget;
  const timeOk = ms <= config.run.wallClockMs;
  return {
    name: "Budget",
    value: `${(tokens / 1000).toFixed(1)}k tok / ${(ms / 1000).toFixed(0)}s`,
    pass: tokenOk && timeOk,
    detail: `limits ${(config.run.tokenBudget / 1000).toFixed(0)}k / ${config.run.wallClockMs / 1000}s`,
  };
}

function bodyContains(body: string, text: string): boolean {
  return body.toLowerCase().includes(text.toLowerCase());
}

function bodyOverlap(emails: Email[]): number {
  if (emails.length < 2) return 0;
  const a = new Set(tokenize(emails[0].body));
  const b = new Set(tokenize(emails[1].body));
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / Math.min(a.size, b.size);
}
