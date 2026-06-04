"use client";

import { motion } from "framer-motion";
import type { RunStats } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-sm text-ink">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-ink-faint">
        {label}
      </span>
    </div>
  );
}

export function RunStatsBar({ stats }: { stats: RunStats }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-card border border-line bg-bg-raised px-5 py-3"
    >
      <Stat label="Turns" value={String(stats.turns)} />
      <Stat label="LLM calls" value={String(stats.llmCalls)} />
      <Stat label="Scrapes" value={String(stats.scrapes)} />
      <Stat label="Embed calls" value={String(stats.embedCalls)} />
      <Stat label="Tokens" value={`${(stats.tokens / 1000).toFixed(1)}k`} />
      <Stat label="Est. cost" value={`$${stats.costUsd.toFixed(3)}`} />
      <Stat label="Claims verified" value={stats.verifiedClaims} />
      <Stat label="Wall clock" value={`${(stats.wallClockMs / 1000).toFixed(1)}s`} />
    </motion.div>
  );
}
