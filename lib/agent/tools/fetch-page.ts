/**
 * fetch_page — scrape → chunk → index. Accepts a batch so the agent can fan out
 * research in one turn; URLs are fetched in parallel, bounded by the gateway
 * rate limiter. Never returns page bodies — only an indexed-snippet summary.
 */

import { z } from "zod";
import { config } from "@/lib/config";
import { chunkMarkdown, extractHeadings, usableTokenCount } from "@/lib/retrieval/chunk";
import { validateUrl, UrlBlockedError } from "@/lib/guardrails/input";
import { countInjections } from "@/lib/guardrails/injection";
import { ScrapeError } from "@/lib/infra/scrape-client";
import { CircuitOpenError } from "@/lib/gateway/circuit-breaker";
import type { RunState } from "../state";
import type { ToolResult } from "@/lib/types";

export const fetchPageSchema = z.object({
  thought: z.string().describe("Why you are fetching these page(s)."),
  url: z
    .union([z.string(), z.array(z.string())])
    .describe("A URL or list of URLs to fetch (must be within the target domain)."),
});

export type FetchPageArgs = z.infer<typeof fetchPageSchema>;

async function fetchOne(state: RunState, rawUrl: string): Promise<string> {
  let url: string;
  try {
    url = validateUrl(rawUrl, { scopeDomain: state.scopeDomain });
  } catch (err) {
    if (err instanceof UrlBlockedError) {
      state.emit({
        type: "guardrail",
        event: "url_blocked",
        reason: err.message,
        count: 1,
      });
      return `Blocked ${rawUrl}: ${err.message}`;
    }
    throw err;
  }

  if (state.index.hasUrl(url)) {
    return `${url} already fetched and indexed — use retrieve instead of re-fetching.`;
  }

  try {
    const { markdown } = await state.gateway.scrape(url);

    if (usableTokenCount(markdown) < config.retrieval.lowSignalTokenFloor) {
      state.index.markFetched(url);
      return `Fetched ${url} but it had little usable content — do not synthesize confidently from it.`;
    }

    const chunks = chunkMarkdown(markdown, url);
    const flagged = countInjections(chunks.map((c) => c.text));
    if (flagged > 0) {
      state.emit({
        type: "guardrail",
        event: "injection_flagged",
        reason: `Injection-like text in scraped content from ${url} (treated as data only).`,
        count: flagged,
      });
    }

    const added = await state.index.add(state.gateway, chunks);
    state.index.markFetched(url);
    const headings = extractHeadings(markdown).slice(0, 8);
    return `Fetched ${url}: indexed ${added} snippets. Headings: ${
      headings.length ? headings.join(", ") : "(none)"
    }.`;
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      return `Scraping unavailable (circuit open). Work with already-indexed content.`;
    }
    if (err instanceof ScrapeError) {
      return `Failed to fetch ${url} — ${err.message}.`;
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return `Failed to fetch ${url} — ${message}.`;
  }
}

export async function fetchPage(
  state: RunState,
  args: FetchPageArgs,
): Promise<ToolResult> {
  const urls = Array.isArray(args.url) ? args.url : [args.url];
  if (urls.length === 0) {
    return { observation: "No URLs provided.", displayable: false, isError: true };
  }

  state.emit({ type: "status", message: `Fetching ${urls.length} page(s)…` });

  const results = await Promise.all(urls.map((u) => fetchOne(state, u)));
  return {
    observation: results.join("\n"),
    displayable: false,
  };
}
