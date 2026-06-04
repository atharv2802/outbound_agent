"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ModeSwitcher, type Mode } from "@/components/mode-switcher";
import { SenderForm } from "@/components/sender-form";
import { TargetForm, type TargetSubmit } from "@/components/target-form";
import { SenderResults } from "@/components/sender-results";
import { TargetResults } from "@/components/target-results";
import { AgentTrace } from "@/components/agent-trace";
import { RunStatsBar } from "@/components/run-stats";
import { EmptyState } from "@/components/empty-state";
import { Button, Card, CardBody } from "@/components/ui";
import { useAgentStream } from "@/lib/hooks/use-agent-stream";

export default function Home() {
  const [mode, setMode] = useState<Mode>("sender");
  const { state, start, reset } = useAgentStream();
  const lastRun = useRef<null | (() => void)>(null);
  const [seed, setSeed] = useState<{ sender?: string; target?: TargetSubmit }>({});

  const running = state.status === "running";

  const runSender = useCallback(
    (url: string) => {
      lastRun.current = () => start("/api/analyze-sender", { url });
      lastRun.current();
    },
    [start],
  );

  const runTarget = useCallback(
    (data: TargetSubmit) => {
      lastRun.current = () =>
        start("/api/analyze-target", {
          senderUrl: data.senderUrl,
          targetUrl: data.targetUrl,
          persona: { role: data.role, seniority: data.seniority },
        });
      lastRun.current();
    },
    [start],
  );

  const switchMode = (m: Mode) => {
    if (running) return;
    setMode(m);
    reset();
  };

  const onSenderExample = (url: string) => {
    setMode("sender");
    setSeed({ sender: url });
    runSender(url);
  };

  const onTargetExample = (sender: string, target: string) => {
    setMode("target");
    const data: TargetSubmit = {
      senderUrl: sender,
      targetUrl: target,
      role: "VP of Sales",
      seniority: "Executive",
    };
    setSeed({ target: data });
    runTarget(data);
  };

  const showWorkspace =
    state.status !== "idle" || state.trace.length > 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Outbound Strategy Engine
          </h1>
          <p className="text-xs text-ink-muted">
            Agentic research · retrieval-grounded · verified claims
          </p>
        </div>
        <ModeSwitcher mode={mode} onChange={switchMode} disabled={running} />
      </header>

      <Card>
        <CardBody className="pt-5">
          {mode === "sender" ? (
            <SenderForm
              onSubmit={runSender}
              running={running}
              initialUrl={seed.sender}
            />
          ) : (
            <TargetForm onSubmit={runTarget} running={running} initial={seed.target} />
          )}
        </CardBody>
      </Card>

      {state.status === "error" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between rounded-card border border-bad/40 bg-bad/10 px-4 py-3"
        >
          <p className="text-sm text-bad">{state.error}</p>
          {lastRun.current && (
            <Button variant="outline" onClick={() => lastRun.current?.()}>
              Retry
            </Button>
          )}
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {!showWorkspace ? (
          <EmptyState
            key="empty"
            onSenderExample={onSenderExample}
            onTargetExample={onTargetExample}
          />
        ) : (
          <motion.div
            key="workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]"
          >
            <div className="order-2 h-[60vh] lg:order-1 lg:h-[calc(100vh-280px)] lg:sticky lg:top-6">
              <AgentTrace trace={state.trace} status={state.status} stats={state.stats} />
            </div>
            <div className="order-1 space-y-4 lg:order-2">
              {state.senderProfile && <SenderResults profile={state.senderProfile} />}
              {mode === "target" && <TargetResults state={state} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {state.stats && (state.status === "done" || state.status === "error") && (
        <RunStatsBar stats={state.stats} />
      )}
    </main>
  );
}
