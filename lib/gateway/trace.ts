/**
 * Structured span logger. Each external call / tool exec / agent turn becomes a
 * span; the full trace feeds the agent-trace panel and the human-readable run
 * summary.
 */

import { nanoid } from "nanoid";
import type { SpanType, TraceSpan } from "@/lib/types";

export class Tracer {
  readonly traceId: string;
  private spans: TraceSpan[] = [];

  constructor(traceId?: string) {
    this.traceId = traceId ?? nanoid(10);
  }

  span(input: {
    type: SpanType;
    label: string;
    tool?: string;
    model?: string;
    durationMs: number;
    tokens?: number;
    error?: string;
  }): void {
    this.spans.push({
      traceId: this.traceId,
      spanId: nanoid(8),
      at: Date.now(),
      ...input,
    });
  }

  all(): TraceSpan[] {
    return this.spans;
  }

  count(type: SpanType): number {
    return this.spans.filter((s) => s.type === type).length;
  }
}
