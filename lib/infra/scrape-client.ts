/**
 * Jina Reader scrape client. Turns a URL into clean markdown via
 * https://r.jina.ai/{url}. No API key required for basic usage.
 *
 * This is the raw transport only — retries, timeouts, rate limiting, and the
 * circuit breaker all live in the gateway. The scrape client just performs the
 * fetch and normalizes failures into a typed error the gateway understands.
 */

import { config } from "@/lib/config";

export class ScrapeError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}

export interface ScrapeResult {
  url: string;
  markdown: string;
}

/**
 * Offline fixture injection for the eval harness. When set, scrapeUrl serves
 * cached markdown instead of hitting Jina; an unknown URL yields a 404 so the
 * agent's "page not found" adaptation path is exercised deterministically.
 */
let fixtures: Map<string, string> | null = null;

function normalizeKey(url: string): string {
  return url.replace(/\/$/, "").toLowerCase();
}

export function setScrapeFixtures(map: Record<string, string>): void {
  fixtures = new Map(Object.entries(map).map(([k, v]) => [normalizeKey(k), v]));
}

export function clearScrapeFixtures(): void {
  fixtures = null;
}

export async function scrapeUrl(
  url: string,
  signal?: AbortSignal,
): Promise<ScrapeResult> {
  if (fixtures) {
    const hit = fixtures.get(normalizeKey(url));
    if (hit) return { url, markdown: hit };
    throw new ScrapeError(`Failed to fetch ${url} — 404 not found (no fixture).`, 404);
  }

  const target = `${config.scrape.jinaBase}${url}`;
  let res: Response;
  try {
    res = await fetch(target, {
      signal,
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
        "User-Agent": "outbound-strategy-engine/1.0",
      },
    });
  } catch (err) {
    const e = err as { name?: string; code?: string; message?: string };
    if (e.name === "AbortError") {
      throw new ScrapeError("Scrape timed out", undefined, "ETIMEDOUT");
    }
    throw new ScrapeError(
      `Network error scraping ${url}: ${e.message ?? "unknown"}`,
      undefined,
      e.code ?? "ECONNRESET",
    );
  }

  if (!res.ok) {
    throw new ScrapeError(
      `Failed to fetch ${url} — ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  const markdown = await res.text();
  return { url, markdown };
}
