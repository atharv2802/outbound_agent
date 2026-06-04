/**
 * Orchestration Gateway — the single point of control for every external call.
 *
 * Pipeline for every call:
 *   checkBudget → rateLimiter.acquire → circuitBreaker.execute
 *     → withTimeout → withRetry → client call
 *   → ledger.record → tracer.span
 *
 * LLM completions, embeddings, and Jina scrapes all flow through this one path,
 * so reliability, cost, and observability are uniform across dependencies.
 */

import { config } from "@/lib/config";
import {
  complete,
  embed as embedClient,
  describeOpenAIError,
  type CompletionOptions,
  type CompletionResult,
} from "@/lib/infra/llm-client";
import { scrapeUrl, ScrapeError, type ScrapeResult } from "@/lib/infra/scrape-client";
import { withRetry } from "./retry";
import { TokenBucket } from "./rate-limiter";
import { CircuitBreaker } from "./circuit-breaker";
import { withTimeout } from "./timeout";
import { TokenLedger } from "./token-ledger";
import { Tracer } from "./trace";
import { estimateTokens } from "@/lib/infra/tokens";

export interface GatewayDeps {
  ledger: TokenLedger;
  tracer: Tracer;
}

export interface LLMCallOptions extends Omit<CompletionOptions, "signal"> {
  /** Tool label for per-tool token attribution in the ledger. */
  tool?: string;
}

export class Gateway {
  readonly ledger: TokenLedger;
  readonly tracer: Tracer;

  private llmBucket = new TokenBucket(
    config.gateway.rateLimiter.llm.capacity,
    config.gateway.rateLimiter.llm.refillPerMin,
  );
  private scrapeBucket = new TokenBucket(
    config.gateway.rateLimiter.scrape.capacity,
    config.gateway.rateLimiter.scrape.refillPerMin,
  );
  private llmCircuit = new CircuitBreaker("llm");
  private scrapeCircuit = new CircuitBreaker("scrape");

  constructor(deps?: Partial<GatewayDeps>) {
    this.ledger = deps?.ledger ?? new TokenLedger();
    this.tracer = deps?.tracer ?? new Tracer();
  }

  // ── LLM completion ───────────────────────────────────────────────────────
  async llm(opts: LLMCallOptions): Promise<CompletionResult> {
    this.ledger.checkBudget();
    await this.llmBucket.acquire();
    const start = Date.now();
    try {
      const result = await this.llmCircuit.execute(() =>
        withTimeout(config.gateway.timeouts.llmMs, "LLM call", (signal) =>
          withRetry(
            () => complete({ ...opts, signal }),
            (attempt, delay) =>
              this.tracer.span({
                type: "retry",
                label: `llm retry #${attempt} in ${Math.round(delay)}ms`,
                model: opts.model,
                durationMs: 0,
              }),
          ),
        ),
      );
      this.ledger.record(
        result.model,
        result.inputTokens,
        result.outputTokens,
        opts.tool,
      );
      this.tracer.span({
        type: "llm_call",
        label: `${opts.model} (${opts.tool ?? "orchestration"})`,
        tool: opts.tool,
        model: result.model,
        durationMs: Date.now() - start,
        tokens: result.inputTokens + result.outputTokens,
      });
      return result;
    } catch (err) {
      const desc = describeOpenAIError(err);
      this.tracer.span({
        type: "error",
        label: `llm error: ${desc.message}`,
        model: opts.model,
        durationMs: Date.now() - start,
        error: desc.message,
      });
      // Re-throw with normalized shape so retry/circuit can classify upstream.
      throw Object.assign(new Error(desc.message), {
        status: desc.status,
        code: desc.code,
      });
    }
  }

  // ── Embeddings (share the LLM circuit + rate bucket; ledgered) ────────────
  async embed(inputs: string[], tool = "embed"): Promise<number[][]> {
    if (inputs.length === 0) return [];
    this.ledger.checkBudget();
    await this.llmBucket.acquire();
    const start = Date.now();
    try {
      const result = await this.llmCircuit.execute(() =>
        withTimeout(config.gateway.timeouts.embedMs, "Embedding call", (signal) =>
          withRetry(() =>
            embedClient(config.models.embedding, inputs, signal),
          ),
        ),
      );
      this.ledger.record(result.model, result.inputTokens, 0, tool);
      this.tracer.span({
        type: "embed",
        label: `embed ${inputs.length} chunk(s)`,
        tool,
        model: result.model,
        durationMs: Date.now() - start,
        tokens: result.inputTokens,
      });
      return result.vectors;
    } catch (err) {
      const desc = describeOpenAIError(err);
      this.tracer.span({
        type: "error",
        label: `embed error: ${desc.message}`,
        durationMs: Date.now() - start,
        error: desc.message,
      });
      throw Object.assign(new Error(desc.message), {
        status: desc.status,
        code: desc.code,
      });
    }
  }

  // ── Scrape (Jina) ─────────────────────────────────────────────────────────
  async scrape(url: string): Promise<ScrapeResult> {
    await this.scrapeBucket.acquire();
    const start = Date.now();
    try {
      const result = await this.scrapeCircuit.execute(() =>
        withTimeout(config.gateway.timeouts.scrapeMs, "Scrape", (signal) =>
          withRetry(() => scrapeUrl(url, signal)),
        ),
      );
      this.tracer.span({
        type: "scrape",
        label: `scrape ${url}`,
        durationMs: Date.now() - start,
        tokens: estimateTokens(result.markdown),
      });
      return result;
    } catch (err) {
      const e = err as ScrapeError;
      this.tracer.span({
        type: "error",
        label: `scrape error: ${url}`,
        durationMs: Date.now() - start,
        error: e.message,
      });
      throw err;
    }
  }
}
