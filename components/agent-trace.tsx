"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import type { RunStats } from "@/lib/types";
import type { RunStatus, TraceItem } from "@/lib/hooks/use-agent-stream";

const ACTION_TONES: Record<string, string> = {
  fetch_page: "text-accent",
  retrieve: "text-good",
  analyze_page: "text-warn",
  synthesize_icp: "text-accent",
  evaluate_fit: "text-warn",
  select_angles: "text-accent",
  draft_email: "text-good",
  finish: "text-ink",
};

export function AgentTrace({
  trace,
  status,
  stats,
}: {
  trace: TraceItem[];
  status: RunStatus;
  stats?: RunStats;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [trace.length]);

  return (
    <div className="flex h-full flex-col rounded-card border border-line bg-bg-raised">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              status === "running"
                ? "animate-pulse-soft bg-good"
                : status === "error"
                  ? "bg-bad"
                  : "bg-ink-faint",
            )}
          />
          <h2 className="font-mono text-xs uppercase tracking-wider text-ink-muted">
            Agent trace
          </h2>
        </div>
        <span className="font-mono text-[11px] text-ink-faint">
          {trace.filter((t) => t.kind === "thought").length} turns
        </span>
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed"
      >
        {trace.length === 0 && (
          <p className="text-ink-faint">Waiting for the agent to start…</p>
        )}
        <AnimatePresence initial={false}>
          {trace.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "rounded border border-transparent px-2 py-1.5",
                i === trace.length - 1 && status === "running" && "border-line bg-bg-card",
              )}
            >
              <TraceRow item={item} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {(status === "done" || status === "error") && stats && (
        <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-ink-muted">
          {stats.turns} turns · {stats.llmCalls} LLM · {stats.scrapes} scrapes ·{" "}
          {(stats.tokens / 1000).toFixed(1)}k tokens ·{" "}
          {(stats.wallClockMs / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
}

function TraceRow({ item }: { item: TraceItem }) {
  if (item.kind === "status") {
    return <p className="text-ink-faint">▸ {item.text}</p>;
  }

  if (item.kind === "retrieval") {
    return (
      <p className="text-good">
        <span className="text-ink-faint">retrieve</span> “{item.query}”{" "}
        <span className="text-ink-muted">→ {item.hits} hits</span>
      </p>
    );
  }

  if (item.kind === "guardrail") {
    return (
      <p className="flex items-start gap-1 text-warn">
        <span className="rounded bg-warn/15 px-1 text-[10px] uppercase">
          {item.event?.replace(/_/g, " ")}
        </span>
        <span className="text-ink-muted">{item.text}</span>
      </p>
    );
  }

  return (
    <div>
      <div className="mb-0.5 flex items-center gap-2">
        {item.turn !== undefined && (
          <span className="rounded bg-bg-hover px-1.5 text-[10px] text-ink-faint">
            T{item.turn}
          </span>
        )}
        <span className={cn("font-medium", ACTION_TONES[item.action ?? ""] ?? "text-ink")}>
          {item.action}
        </span>
      </div>
      {item.text && <p className="pl-1 text-ink-muted">{item.text}</p>}
    </div>
  );
}
