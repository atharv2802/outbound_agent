/**
 * Per-run token + cost ledger. Records usage for every external call including
 * embeddings, broken down by model and by tool, so model-routing savings are
 * measurable and the budget gate is enforceable.
 */

import { config } from "@/lib/config";
import type { ModelUsage } from "@/lib/types";

export class BudgetExceededError extends Error {
  constructor() {
    super("Token budget exhausted for this run.");
    this.name = "BudgetExceededError";
  }
}

export class TokenLedger {
  private byModel = new Map<string, ModelUsage>();
  private byTool = new Map<string, number>();
  private total = 0;

  constructor(private budget: number = config.run.tokenBudget) {}

  get used(): number {
    return this.total;
  }

  get remaining(): number {
    return Math.max(0, this.budget - this.total);
  }

  /** Throw before a call if we are already over budget. */
  checkBudget(): void {
    if (this.remaining <= 0) throw new BudgetExceededError();
  }

  record(
    model: string,
    inputTokens: number,
    outputTokens: number,
    tool?: string,
  ): void {
    const existing =
      this.byModel.get(model) ?? { inputTokens: 0, outputTokens: 0, calls: 0 };
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.calls += 1;
    this.byModel.set(model, existing);

    const sum = inputTokens + outputTokens;
    this.total += sum;

    if (tool) {
      this.byTool.set(tool, (this.byTool.get(tool) ?? 0) + sum);
    }
  }

  costUsd(): number {
    let cost = 0;
    for (const [model, usage] of this.byModel.entries()) {
      const price = config.pricing[model];
      if (!price) continue;
      cost +=
        (usage.inputTokens / 1000) * price.input +
        (usage.outputTokens / 1000) * price.output;
    }
    return cost;
  }

  snapshotByModel(): Record<string, ModelUsage> {
    return Object.fromEntries(this.byModel);
  }

  snapshotByTool(): Record<string, number> {
    return Object.fromEntries(this.byTool);
  }
}
