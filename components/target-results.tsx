"use client";

import { useCallback, useRef, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import { FitScorecard } from "./fit-scorecard";
import { EmailCard } from "./email-card";
import { ClaimMapPanel } from "./claim-map";
import type { AgentStreamState } from "@/lib/hooks/use-agent-stream";

export function TargetResults({ state }: { state: AgentStreamState }) {
  const [highlightedClaimId, setHighlighted] = useState<string | null>(null);
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  }, []);

  const activateClaim = useCallback((id: string) => {
    setHighlighted(id);
    const el = refs.current.get(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlighted((cur) => (cur === id ? null : cur)), 2200);
  }, []);

  const running = state.status === "running";
  const hasResults =
    state.fitEvaluation || state.emails.length > 0 || state.claimMap;

  return (
    <div className="space-y-4">
      {state.fitEvaluation ? (
        <FitScorecard evaluation={state.fitEvaluation} />
      ) : running ? (
        <Card>
          <CardHeader>
            <CardTitle>ICP Fit</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Skeleton className="h-12 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </CardBody>
        </Card>
      ) : null}

      {state.emails.length > 0 && (
        <div className="space-y-3">
          {state.emails.map((email) => (
            <EmailCard
              key={email.angleIndex}
              email={email}
              highlightedClaimId={highlightedClaimId}
              onClaimActivate={activateClaim}
              onClaimHover={setHighlighted}
            />
          ))}
        </div>
      )}

      {running && state.fitEvaluation && state.emails.length < 2 && (
        <Skeleton className="h-32 w-full" />
      )}

      {state.claimMap ? (
        <ClaimMapPanel
          claimMap={state.claimMap}
          highlightedClaimId={highlightedClaimId}
          onClaimHover={setHighlighted}
          registerRef={registerRef}
        />
      ) : null}

      {!hasResults && !running && (
        <p className="text-sm text-ink-faint">No results yet.</p>
      )}
    </div>
  );
}
