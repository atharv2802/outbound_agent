/**
 * Context compression. Old turns (>3 ago) collapse to one line each; the last 3
 * stay in full detail as working memory. Keeps the loop context roughly flat
 * regardless of how many turns the agent takes.
 */

import type { LLMMessage } from "@/lib/infra/llm-client";
import type { RunState } from "./state";

const RECENT_FULL = 3;

export function compressContext(state: RunState): LLMMessage[] {
  const { observations } = state;

  if (observations.length === 0) {
    return [
      {
        role: "user",
        content:
          "Begin. The homepage is already indexed. Decide your first action and call a tool.",
      },
    ];
  }

  const splitAt = Math.max(0, observations.length - RECENT_FULL);
  const older = observations.slice(0, splitAt);
  const recent = observations.slice(splitAt);

  const lines: string[] = ["RESEARCH SO FAR:"];

  for (const o of older) {
    lines.push(
      `Turn ${o.turn}: ${o.action} → ${truncate(o.summary, 160)}${o.isError ? " [error]" : ""}`,
    );
  }

  if (recent.length > 0) {
    lines.push("", "RECENT TURNS (full detail):");
    for (const o of recent) {
      lines.push(
        `Turn ${o.turn}:`,
        `  thought: ${truncate(o.thought, 240)}`,
        `  action: ${o.action}`,
        `  result: ${truncate(o.summary, 600)}${o.isError ? " [error — adapt]" : ""}`,
      );
    }
  }

  lines.push(
    "",
    "Decide the next best action and call exactly one tool. Do not repeat work already done.",
  );

  return [{ role: "user", content: lines.join("\n") }];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
