/**
 * Shared types for the Outbound Strategy Engine.
 *
 * These are the integration seam between the backend agent and the frontend.
 * The SSE event union (StreamEvent) and the result payloads must stay in sync
 * with `useAgentStream` and the result components.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval primitives
// ─────────────────────────────────────────────────────────────────────────────

export interface Chunk {
  chunkId: string;
  sourceUrl: string;
  heading: string;
  text: string;
  tokenCount: number;
}

export interface Snippet {
  chunkId: string;
  sourceUrl: string;
  heading: string;
  text: string;
  score: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signals (analyze_page output)
// ─────────────────────────────────────────────────────────────────────────────

export interface GroundedField<T = string> {
  value: T;
  chunkIds: string[];
}

export interface CompanySignals {
  productDescription: GroundedField;
  targetAudience: GroundedField;
  painPointsAddressed: GroundedField<string[]>;
  proofPoints: GroundedField<string[]>;
  pricingModel: GroundedField;
  differentiators: GroundedField<string[]>;
  technologies: GroundedField<string[]>;
}

export interface BuyerSignals {
  whatTheyDo: GroundedField;
  industry: GroundedField;
  scaleClues: GroundedField<string[]>;
  techStack: GroundedField<string[]>;
  recentInitiatives: GroundedField<string[]>;
  potentialPainPoints: GroundedField<string[]>;
  notableFacts: GroundedField<string[]>;
}

export type AnalyzeFocus = "company_signals" | "buyer_signals";

// ─────────────────────────────────────────────────────────────────────────────
// Sender profile (Mode 1 output → Mode 2 input contract)
// ─────────────────────────────────────────────────────────────────────────────

export type Confidence = "high" | "medium" | "low";

export interface ICP {
  industries: GroundedField<string[]>;
  companySizes: GroundedField<string[]>;
  personas: GroundedField<string[]>;
  triggers: GroundedField<string[]>;
  pains: GroundedField<string[]>;
  disqualifiers: GroundedField<string[]>;
}

export interface SenderProfile {
  domain: string;
  companyName: string;
  valueProp: string;
  valuePropChunkIds: string[];
  icp: ICP;
  confidence: Confidence;
  evidenceGaps: string[];
  createdAt: number;
}

export interface SenderAnalysisResult {
  type: "sender_analysis";
  profile: SenderProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fit evaluation (Mode 2)
// ─────────────────────────────────────────────────────────────────────────────

export interface DimensionScore {
  dimension: string;
  score: number; // 1-10
  reasoning: string;
  chunkIds: string[];
}

export interface FitEvaluation {
  overallScore: number; // 1-10
  overallReasoning: string;
  dimensions: DimensionScore[];
  strongestSignals: GroundedField<string[]>;
  gapsRisks: GroundedField<string[]>;
}

export interface FitEvaluationResult {
  type: "fit_evaluation";
  evaluation: FitEvaluation;
}

// ─────────────────────────────────────────────────────────────────────────────
// Angles + emails + claims
// ─────────────────────────────────────────────────────────────────────────────

export type AngleType =
  | "pain-led"
  | "trigger-led"
  | "value-led"
  | "social-proof-led";

export interface Angle {
  type: AngleType;
  label: string;
  thesis: string;
  evidenceChunkIds: string[];
}

export interface AnglePair {
  type: "angles";
  angles: [Angle, Angle];
}

export type ClaimStatus = "verified" | "unsupported";

export interface Claim {
  claimId: string;
  text: string;
  chunkId: string;
  sourceUrl: string;
  snippet: string;
  status: ClaimStatus;
  reason?: string;
}

export interface Email {
  type: "email";
  angleIndex: number;
  angleType: AngleType;
  angleLabel: string;
  subject: string;
  body: string;
  persona: Persona;
  wordCount: number;
  claims: Claim[];
  verifiedCount: number;
  totalCount: number;
}

export interface Persona {
  role: string;
  seniority: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claim map (finish)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimGroup {
  sourceUrl: string;
  claims: Claim[];
}

export interface ClaimMap {
  type: "claim_map";
  summary: string;
  verified: number;
  total: number;
  groups: ClaimGroup[];
  stripped: Claim[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Run stats + trace
// ─────────────────────────────────────────────────────────────────────────────

export type SpanType =
  | "llm_call"
  | "scrape"
  | "embed"
  | "tool_exec"
  | "agent_turn"
  | "error"
  | "retry";

export interface TraceSpan {
  traceId: string;
  spanId: string;
  type: SpanType;
  label: string;
  tool?: string;
  model?: string;
  durationMs: number;
  tokens?: number;
  error?: string;
  at: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface RunStats {
  turns: number;
  llmCalls: number;
  scrapes: number;
  embedCalls: number;
  tokens: number;
  byModel: Record<string, ModelUsage>;
  byTool: Record<string, number>;
  costUsd: number;
  verifiedClaims: string; // "7/8"
  wallClockMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result payload union (what gets emitted in `result` SSE events)
// ─────────────────────────────────────────────────────────────────────────────

export type ResultPayload =
  | SenderAnalysisResult
  | FitEvaluationResult
  | AnglePair
  | Email
  | ClaimMap;

// ─────────────────────────────────────────────────────────────────────────────
// SSE streaming protocol
// ─────────────────────────────────────────────────────────────────────────────

export type GuardrailEventKind =
  | "claim_stripped"
  | "injection_flagged"
  | "url_blocked"
  | "schema_repair";

export type StreamEvent =
  | { type: "status"; message: string }
  | {
      type: "agent_thought";
      turn: number;
      thought: string;
      action: string;
    }
  | { type: "retrieval"; turn: number; query: string; hits: number }
  | { type: "result"; data: ResultPayload }
  | {
      type: "guardrail";
      event: GuardrailEventKind;
      reason: string;
      count: number;
    }
  | { type: "meta"; stats: RunStats }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "done" };

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution result envelope
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolResult {
  /** Compact, human-readable observation appended to agent context. */
  observation: string;
  /** Whether this result should be streamed to the UI as a result payload. */
  displayable: boolean;
  data?: ResultPayload;
  /** Marks a terminal tool (finish). */
  terminal?: boolean;
  /** Soft error: surfaced to the agent as an observation, loop continues. */
  isError?: boolean;
}
