/**
 * Markdown → passages. Heading/paragraph aware, ~target-token passages with a
 * small overlap so facts aren't severed. Boilerplate (nav/footer/cookie lines)
 * is dropped before indexing for pure token savings.
 */

import { nanoid } from "nanoid";
import { config } from "@/lib/config";
import { estimateTokens } from "@/lib/infra/tokens";
import type { Chunk } from "@/lib/types";

const BOILERPLATE_PATTERNS = [
  /cookie/i,
  /accept all/i,
  /privacy policy/i,
  /terms of service/i,
  /all rights reserved/i,
  /sign up|log ?in|subscribe/i,
  /^\s*(home|about|pricing|blog|contact|careers|product|menu)\s*$/i,
];

function isBoilerplate(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  // Markdown image / link-only nav lines.
  if (/^!\[/.test(trimmed)) return true;
  if (trimmed.length < 3) return true;
  if (trimmed.length < 40 && BOILERPLATE_PATTERNS.some((p) => p.test(trimmed))) {
    return true;
  }
  return false;
}

function cleanMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !isBoilerplate(line))
    .join("\n");
}

interface Block {
  heading: string;
  text: string;
}

function splitIntoBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let currentHeading = "Overview";
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push({ heading: currentHeading, text });
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim() || currentHeading;
    } else {
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

/** Split a long block into overlapping passages by paragraph boundaries. */
function packParagraphs(heading: string, text: string): { heading: string; text: string }[] {
  const { chunkTargetTokens, chunkOverlapRatio } = config.retrieval;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const passages: { heading: string; text: string }[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const overlapTokens = Math.round(chunkTargetTokens * chunkOverlapRatio);

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    if (currentTokens + paraTokens > chunkTargetTokens && current.length > 0) {
      passages.push({ heading, text: current.join("\n\n") });
      // Start next passage with a small overlap tail.
      const tail: string[] = [];
      let tailTokens = 0;
      for (let i = current.length - 1; i >= 0 && tailTokens < overlapTokens; i--) {
        tail.unshift(current[i]);
        tailTokens += estimateTokens(current[i]);
      }
      current = [...tail];
      currentTokens = tailTokens;
    }
    current.push(para);
    currentTokens += paraTokens;
  }
  if (current.length > 0) passages.push({ heading, text: current.join("\n\n") });
  return passages;
}

export function chunkMarkdown(markdown: string, sourceUrl: string): Chunk[] {
  const cleaned = cleanMarkdown(markdown);
  const blocks = splitIntoBlocks(cleaned);
  const chunks: Chunk[] = [];

  for (const block of blocks) {
    const passages = packParagraphs(block.heading, block.text);
    for (const passage of passages) {
      const tokenCount = estimateTokens(passage.text);
      if (tokenCount < config.retrieval.chunkMinTokens) continue;
      chunks.push({
        chunkId: nanoid(10),
        sourceUrl,
        heading: passage.heading,
        text: passage.text,
        tokenCount,
      });
    }
  }
  return chunks;
}

/** Section headings only — seeded into the system prompt, never the body. */
export function extractHeadings(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const h = m[2].trim();
      if (h && !headings.includes(h)) headings.push(h);
    }
  }
  return headings.slice(0, 25);
}

/** Real usable tokens after boilerplate strip — used for low-signal detection. */
export function usableTokenCount(markdown: string): number {
  return estimateTokens(cleanMarkdown(markdown));
}
