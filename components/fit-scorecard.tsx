"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { FitEvaluation } from "@/lib/types";

function scoreTone(score: number): { text: string; bar: string } {
  if (score <= 3) return { text: "text-bad", bar: "bg-bad" };
  if (score <= 6) return { text: "text-warn", bar: "bg-warn" };
  return { text: "text-good", bar: "bg-good" };
}

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let frame: number;
    const start = performance.now();
    const duration = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(t * value * 10) / 10);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{display.toFixed(0)}</>;
}

export function FitScorecard({ evaluation }: { evaluation: FitEvaluation }) {
  const tone = scoreTone(evaluation.overallScore);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card>
        <CardHeader>
          <CardTitle>ICP Fit</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="flex items-start gap-5">
            <div className={cn("font-mono text-5xl font-semibold leading-none", tone.text)}>
              <CountUp value={evaluation.overallScore} />
              <span className="text-2xl text-ink-faint">/10</span>
            </div>
            <p className="flex-1 text-sm leading-relaxed text-ink-muted">
              {evaluation.overallReasoning}
            </p>
          </div>

          <div className="space-y-3">
            {evaluation.dimensions.map((d, i) => {
              const dt = scoreTone(d.score);
              return (
                <div key={i}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-ink">
                      {d.dimension}
                      {d.chunkIds.length > 0 && (
                        <span
                          title={`Evidence: ${d.chunkIds.join(", ")}`}
                          className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full bg-good/15 text-[8px] text-good"
                        >
                          {d.chunkIds.length}
                        </span>
                      )}
                    </span>
                    <span className={cn("font-mono", dt.text)}>{d.score}/10</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${d.score * 10}%` }}
                      transition={{ duration: 0.6, delay: i * 0.05 }}
                      className={cn("h-full rounded-full", dt.bar)}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-ink-faint">{d.reasoning}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {evaluation.strongestSignals.value.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-good">
                  Strongest signals
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {evaluation.strongestSignals.value.map((s, i) => (
                    <Badge key={i} tone="good">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {evaluation.gapsRisks.value.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-warn">
                  Gaps / risks
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {evaluation.gapsRisks.value.map((s, i) => (
                    <Badge key={i} tone="warn">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
