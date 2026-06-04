"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui";

export function EmptyState({
  onSenderExample,
  onTargetExample,
}: {
  onSenderExample: (url: string) => void;
  onTargetExample: (sender: string, target: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-6 py-10 text-center"
    >
      <div className="max-w-xl space-y-3">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-ink">
          Turn any company&rsquo;s public footprint into grounded outbound
          strategy.
        </h2>
        <p className="text-balance text-sm text-ink-muted">
          A ReAct agent researches the web in real time, retrieves snippets (not
          whole pages), and writes emails where every claim is bound to verified
          evidence.
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        <Card className="p-4 text-left">
          <p className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
            Try Mode 1
          </p>
          <p className="mb-3 text-sm text-ink-muted">
            Analyze a sender to infer its value prop + ICP.
          </p>
          <button
            onClick={() => onSenderExample("artisan.co")}
            className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
          >
            artisan.co →
          </button>
        </Card>
        <Card className="p-4 text-left">
          <p className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
            Try Mode 2
          </p>
          <p className="mb-3 text-sm text-ink-muted">
            Evaluate a target and draft two grounded emails.
          </p>
          <button
            onClick={() => onTargetExample("artisan.co", "ramp.com")}
            className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
          >
            artisan.co → ramp.com →
          </button>
        </Card>
      </div>
    </motion.div>
  );
}
