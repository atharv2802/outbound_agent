"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export type Mode = "sender" | "target";

const TABS: { id: Mode; label: string; hint: string }[] = [
  { id: "sender", label: "Sender Analysis", hint: "Value prop + ICP" },
  { id: "target", label: "Target Outbound", hint: "Fit + emails + claims" },
];

export function ModeSwitcher({
  mode,
  onChange,
  disabled,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Mode"
      className="inline-flex rounded-card border border-line bg-bg-raised p-1"
    >
      {TABS.map((tab) => {
        const active = mode === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative rounded-[4px] px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              active ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId="mode-pill"
                className="absolute inset-0 rounded-[4px] border border-line-strong bg-bg-card"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex flex-col items-start leading-tight">
              <span>{tab.label}</span>
              <span className="text-[10px] font-normal text-ink-faint">
                {tab.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
