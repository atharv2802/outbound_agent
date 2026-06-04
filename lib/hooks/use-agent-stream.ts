"use client";

import { useCallback, useRef, useState } from "react";
import type {
  Angle,
  ClaimMap,
  Email,
  FitEvaluation,
  RunStats,
  SenderProfile,
  StreamEvent,
} from "@/lib/types";

export type RunStatus = "idle" | "running" | "done" | "error";

export interface TraceItem {
  id: number;
  kind: "thought" | "retrieval" | "guardrail" | "status";
  turn?: number;
  text: string;
  action?: string;
  query?: string;
  hits?: number;
  event?: string;
}

export interface AgentStreamState {
  status: RunStatus;
  statusMessage?: string;
  trace: TraceItem[];
  senderProfile?: SenderProfile;
  fitEvaluation?: FitEvaluation;
  angles?: [Angle, Angle];
  emails: Email[];
  claimMap?: ClaimMap;
  stats?: RunStats;
  error?: string;
}

const initialState: AgentStreamState = {
  status: "idle",
  trace: [],
  emails: [],
};

export function useAgentStream() {
  const [state, setState] = useState<AgentStreamState>(initialState);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    idRef.current = 0;
    setState(initialState);
  }, []);

  const apply = useCallback((event: StreamEvent) => {
    setState((prev) => {
      const next: AgentStreamState = { ...prev };
      switch (event.type) {
        case "status": {
          next.statusMessage = event.message;
          next.trace = [
            ...prev.trace,
            { id: idRef.current++, kind: "status", text: event.message },
          ];
          break;
        }
        case "agent_thought": {
          next.trace = [
            ...prev.trace,
            {
              id: idRef.current++,
              kind: "thought",
              turn: event.turn,
              text: event.thought,
              action: event.action,
            },
          ];
          break;
        }
        case "retrieval": {
          next.trace = [
            ...prev.trace,
            {
              id: idRef.current++,
              kind: "retrieval",
              turn: event.turn,
              text: event.query,
              query: event.query,
              hits: event.hits,
            },
          ];
          break;
        }
        case "guardrail": {
          next.trace = [
            ...prev.trace,
            {
              id: idRef.current++,
              kind: "guardrail",
              text: event.reason,
              event: event.event,
              hits: event.count,
            },
          ];
          break;
        }
        case "result": {
          const data = event.data;
          if (data.type === "sender_analysis") next.senderProfile = data.profile;
          else if (data.type === "fit_evaluation") next.fitEvaluation = data.evaluation;
          else if (data.type === "angles") next.angles = data.angles;
          else if (data.type === "email") {
            const others = prev.emails.filter((e) => e.angleIndex !== data.angleIndex);
            next.emails = [...others, data].sort((a, b) => a.angleIndex - b.angleIndex);
          } else if (data.type === "claim_map") next.claimMap = data;
          break;
        }
        case "meta": {
          next.stats = event.stats;
          break;
        }
        case "error": {
          next.status = "error";
          next.error = event.message;
          break;
        }
        case "done": {
          next.status = prev.status === "error" ? "error" : "done";
          next.statusMessage = undefined;
          break;
        }
      }
      return next;
    });
  }, []);

  const start = useCallback(
    async (endpoint: string, body: unknown) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      idRef.current = 0;
      setState({ ...initialState, status: "running" });

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let message = `Request failed (${res.status}).`;
          try {
            const json = await res.json();
            if (json?.error) message = json.error;
          } catch {
            /* ignore */
          }
          setState((p) => ({ ...p, status: "error", error: message }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              apply(JSON.parse(line.slice(6)) as StreamEvent);
            } catch {
              /* skip malformed frame */
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Connection lost. Please retry.";
        setState((p) => ({ ...p, status: "error", error: message }));
      }
    },
    [apply],
  );

  return { state, start, reset };
}
