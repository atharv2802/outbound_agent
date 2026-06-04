/**
 * Agent runtime: deterministic homepage bootstrap + the ReAct loop (structured
 * tool-calls). Also the Mode 1 / Mode 2 orchestrators that resolve the
 * SenderProfile contract and stream results via the provided emit callback.
 */

import { config } from "@/lib/config";
import { Gateway } from "@/lib/gateway";
import { Tracer } from "@/lib/gateway/trace";
import { TokenLedger } from "@/lib/gateway/token-ledger";
import { RetrievalIndex } from "@/lib/retrieval";
import { chunkMarkdown, extractHeadings, usableTokenCount } from "@/lib/retrieval/chunk";
import { getRegistrableDomain, validateUrl } from "@/lib/guardrails/input";
import { countInjections } from "@/lib/guardrails/injection";
import { getSenderProfile } from "./store";
import { compressContext } from "./context";
import { getTool, getTools, toToolSchemas } from "./tool-registry";
import { finishSchema } from "./tools/finish";
import { senderSystemPrompt } from "./prompts/sender-agent";
import { targetSystemPrompt } from "./prompts/target-agent";
import type { AgentMode, RunState } from "./state";
import type { Persona, RunStats, StreamEvent } from "@/lib/types";

export class BootstrapError extends Error {}

type Emit = (event: StreamEvent) => void;

function newRunState(opts: {
  mode: AgentMode;
  rootUrl: string;
  scopeDomain: string;
  gateway: Gateway;
  emit: Emit;
  persona?: Persona;
}): RunState {
  return {
    mode: opts.mode,
    rootUrl: opts.rootUrl,
    scopeDomain: opts.scopeDomain,
    gateway: opts.gateway,
    index: new RetrievalIndex(),
    emit: opts.emit,
    turn: 0,
    startedAt: Date.now(),
    observations: [],
    homepageHeadings: [],
    persona: opts.persona,
    emails: [],
    forceFinish: false,
  };
}

/** Deterministic bootstrap: scrape + index the homepage, seed headings. */
async function bootstrapHomepage(state: RunState): Promise<void> {
  state.emit({ type: "status", message: `Fetching homepage ${state.rootUrl}…` });
  let markdown: string;
  try {
    const result = await state.gateway.scrape(state.rootUrl);
    markdown = result.markdown;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new BootstrapError(`Could not reach homepage ${state.rootUrl}: ${message}`);
  }

  if (usableTokenCount(markdown) < config.retrieval.lowSignalTokenFloor) {
    throw new BootstrapError(
      `Homepage ${state.rootUrl} returned little usable content.`,
    );
  }

  const chunks = chunkMarkdown(markdown, state.rootUrl);
  const flagged = countInjections(chunks.map((c) => c.text));
  if (flagged > 0) {
    state.emit({
      type: "guardrail",
      event: "injection_flagged",
      reason: "Injection-like text in homepage (treated as data only).",
      count: flagged,
    });
  }
  await state.index.add(state.gateway, chunks);
  state.index.markFetched(state.rootUrl);
  state.homepageHeadings = extractHeadings(markdown);
  state.emit({
    type: "status",
    message: `Indexed homepage: ${state.index.size} snippets.`,
  });
}

/** The ReAct loop. */
async function runLoop(state: RunState, systemPrompt: string): Promise<void> {
  while (state.turn < config.run.maxTurns) {
    const elapsed = Date.now() - state.startedAt;
    if (elapsed > config.run.wallClockMs) state.forceFinish = true;
    if (state.gateway.ledger.remaining < config.run.finishThreshold) {
      state.forceFinish = true;
    }

    state.turn += 1;

    const tools = state.forceFinish
      ? getTools(state.mode).filter((t) => t.name === "finish")
      : getTools(state.mode);
    const schemas = toToolSchemas(tools);

    const messages = compressContext(state);

    let completion;
    try {
      completion = await state.gateway.llm({
        model: config.models.orchestration,
        tool: "orchestrate",
        temperature: 0.3,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: schemas,
        toolChoice: state.forceFinish ? { name: "finish" } : "required",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "LLM error";
      state.emit({ type: "error", message, recoverable: false });
      return;
    }

    const toolCall = completion.toolCalls[0];
    if (!toolCall) {
      state.observations.push({
        turn: state.turn,
        thought: "",
        action: "(none)",
        summary: "No tool was called. You must call exactly one tool.",
        isError: true,
      });
      continue;
    }

    const name = toolCall.function.name;
    let rawArgs: Record<string, unknown> = {};
    try {
      rawArgs = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      rawArgs = {};
    }
    const thought = typeof rawArgs.thought === "string" ? rawArgs.thought : "";

    state.emit({ type: "agent_thought", turn: state.turn, thought, action: name });

    const tool = getTool(state.mode, name);
    if (!tool) {
      state.observations.push({
        turn: state.turn,
        thought,
        action: name,
        summary: `Unknown tool "${name}".`,
        isError: true,
      });
      continue;
    }

    try {
      const result = await tool.run(state, rawArgs);
      state.observations.push({
        turn: state.turn,
        thought,
        action: name,
        summary: result.observation,
        isError: result.isError,
      });
      if (result.displayable && result.data) {
        state.emit({ type: "result", data: result.data });
      }
      if (result.terminal) return;
    } catch (err) {
      const message = err instanceof Error ? err.message : "tool error";
      state.observations.push({
        turn: state.turn,
        thought,
        action: name,
        summary: `Tool "${name}" failed: ${message}. Adapt and try a different action.`,
        isError: true,
      });
    }
  }

  // Max turns reached without finish — force a graceful close.
  await forceFinishClose(state);
}

/**
 * Guarantee Mode 1 always yields a SenderProfile. The agent loop is the primary
 * path, but if it runs out of turns/budget before synthesizing, deterministically
 * extract signals (if needed) and synthesize so downstream never sees "no profile".
 */
async function ensureSenderProfileSynthesized(state: RunState): Promise<void> {
  if (state.mode !== "sender" || state.senderProfile) return;

  if (!state.companySignals) {
    const analyze = getTool("sender", "analyze_page");
    if (analyze) {
      try {
        await analyze.run(state, {
          thought: "Fallback: extract company signals before forced synthesis.",
          focus: "company_signals",
        });
      } catch {
        /* best effort */
      }
    }
  }

  if (state.companySignals && !state.senderProfile) {
    const synth = getTool("sender", "synthesize_icp");
    if (synth) {
      try {
        const result = await synth.run(state, {
          thought: "Fallback: synthesize ICP to guarantee a sender profile.",
        });
        if (result.displayable && result.data) {
          state.emit({ type: "result", data: result.data });
        }
      } catch {
        /* best effort */
      }
    }
  }
}

async function forceFinishClose(state: RunState): Promise<void> {
  await ensureSenderProfileSynthesized(state);
  const tool = getTool(state.mode, "finish");
  if (!tool) return;
  const summary =
    state.mode === "sender"
      ? `Analysis complete for ${state.scopeDomain}.`
      : `Outbound prepared for ${state.scopeDomain}.`;
  try {
    const result = await tool.run(state, finishSchema.parse({ thought: "Max turns reached.", summary }));
    if (result.displayable && result.data) {
      state.emit({ type: "result", data: result.data });
    }
  } catch {
    /* best effort */
  }
}

function buildStats(gateway: Gateway, state: RunState): RunStats {
  const tracer = gateway.tracer;
  const ledger = gateway.ledger;
  const verified = state.emails.reduce((s, e) => s + e.verifiedCount, 0);
  const total = state.emails.reduce((s, e) => s + e.totalCount, 0);
  return {
    turns: state.turn,
    llmCalls: tracer.count("llm_call"),
    scrapes: tracer.count("scrape"),
    embedCalls: tracer.count("embed"),
    tokens: ledger.used,
    byModel: ledger.snapshotByModel(),
    byTool: ledger.snapshotByTool(),
    costUsd: Number(ledger.costUsd().toFixed(4)),
    verifiedClaims: `${verified}/${total}`,
    wallClockMs: Date.now() - state.startedAt,
  };
}

// ── Orchestrators ───────────────────────────────────────────────────────────

export interface SenderRunOptions {
  url: string;
  emit: Emit;
}

export async function runSenderAnalysis(opts: SenderRunOptions): Promise<void> {
  const rootUrl = validateUrl(opts.url);
  const scopeDomain = getRegistrableDomain(rootUrl);
  const gateway = new Gateway({ ledger: new TokenLedger(), tracer: new Tracer() });
  const state = newRunState({
    mode: "sender",
    rootUrl,
    scopeDomain,
    gateway,
    emit: opts.emit,
  });

  try {
    await bootstrapHomepage(state);
    await runLoop(state, senderSystemPrompt(state.homepageHeadings));
    await ensureSenderProfileSynthesized(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Run failed.";
    opts.emit({ type: "error", message, recoverable: false });
  } finally {
    opts.emit({ type: "meta", stats: buildStats(gateway, state) });
    opts.emit({ type: "done" });
  }
}

export interface TargetRunOptions {
  targetUrl: string;
  senderUrl?: string;
  persona: Persona;
  emit: Emit;
}

export async function runTargetAnalysis(opts: TargetRunOptions): Promise<void> {
  const targetUrl = validateUrl(opts.targetUrl);
  const targetDomain = getRegistrableDomain(targetUrl);
  const gateway = new Gateway({ ledger: new TokenLedger(), tracer: new Tracer() });

  const state = newRunState({
    mode: "target",
    rootUrl: targetUrl,
    scopeDomain: targetDomain,
    gateway,
    emit: opts.emit,
    persona: opts.persona,
  });

  try {
    // Resolve the SenderProfile contract.
    const senderProfile = await resolveSenderProfile(opts, gateway);
    if (!senderProfile) {
      opts.emit({
        type: "error",
        message:
          "No sender profile available. Provide a sender URL or run Mode 1 first.",
        recoverable: true,
      });
      return;
    }
    state.senderProfile = senderProfile;
    opts.emit({
      type: "result",
      data: { type: "sender_analysis", profile: senderProfile },
    });

    await bootstrapHomepage(state);
    await runLoop(
      state,
      targetSystemPrompt(senderProfile, state.homepageHeadings, opts.persona),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Run failed.";
    opts.emit({ type: "error", message, recoverable: false });
  } finally {
    opts.emit({ type: "meta", stats: buildStats(gateway, state) });
    opts.emit({ type: "done" });
  }
}

/**
 * Resolution order: (1) fresh SenderProfile in the store; (2) run Mode 1 inline
 * from the provided sender URL. Mode 2 is always self-sufficient.
 */
async function resolveSenderProfile(opts: TargetRunOptions, gateway: Gateway) {
  if (opts.senderUrl) {
    const senderDomain = getRegistrableDomain(opts.senderUrl);
    const cached = getSenderProfile(senderDomain);
    if (cached) {
      opts.emit({ type: "status", message: `Reusing sender profile for ${senderDomain}.` });
      return cached;
    }
    // Run Mode 1 inline using the SAME gateway (shared ledger/trace/budget).
    opts.emit({
      type: "status",
      message: `No sender profile cached — analyzing sender ${senderDomain} first…`,
    });
    const senderRoot = validateUrl(opts.senderUrl);
    // Forward the inline run's trace + ICP, but suppress its terminal
    // (empty) claim_map so it doesn't render prematurely in Mode 2.
    const inlineEmit: Emit = (event) => {
      if (event.type === "result" && event.data.type === "claim_map") return;
      opts.emit(event);
    };
    const inlineState = newRunState({
      mode: "sender",
      rootUrl: senderRoot,
      scopeDomain: senderDomain,
      gateway,
      emit: inlineEmit,
    });
    await bootstrapHomepage(inlineState);
    await runLoop(inlineState, senderSystemPrompt(inlineState.homepageHeadings));
    await ensureSenderProfileSynthesized(inlineState);
    return inlineState.senderProfile ?? getSenderProfile(senderDomain);
  }

  // No sender URL: best effort from the target domain's own store entry.
  return getSenderProfile(getRegistrableDomain(opts.targetUrl));
}
