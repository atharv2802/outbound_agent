"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AngleType, Email } from "@/lib/types";

const ANGLE_TONE: Record<AngleType, "accent" | "warn" | "good" | "neutral"> = {
  "pain-led": "warn",
  "trigger-led": "accent",
  "value-led": "good",
  "social-proof-led": "neutral",
};

interface Range {
  start: number;
  end: number;
  claimId: string;
}

function computeRanges(body: string, claims: Email["claims"]): Range[] {
  const lower = body.toLowerCase();
  const ranges: Range[] = [];
  for (const claim of claims) {
    if (claim.status !== "verified") continue;
    const idx = lower.indexOf(claim.text.toLowerCase());
    if (idx === -1) continue;
    ranges.push({ start: idx, end: idx + claim.text.length, claimId: claim.claimId });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  let lastEnd = -1;
  for (const r of ranges) {
    if (r.start >= lastEnd) {
      merged.push(r);
      lastEnd = r.end;
    }
  }
  return merged;
}

function splitParagraphs(body: string): string[] {
  if (/\n\n/.test(body)) {
    return body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  }
  const sentences = body.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return [body.trim()];
  if (sentences.length === 2) return sentences;
  return [sentences[0], sentences.slice(1, -1).join(" "), sentences[sentences.length - 1]];
}

function buildClaimSegments(
  text: string,
  ranges: Range[],
  highlightedClaimId: string | null | undefined,
  onClaimActivate: (claimId: string) => void,
  onClaimHover: (claimId: string | null) => void,
): React.ReactNode[] {
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) segments.push(text.slice(cursor, r.start));
    const claimText = text.slice(r.start, r.end);
    segments.push(
      <button
        key={`c-${i}`}
        type="button"
        onClick={() => onClaimActivate(r.claimId)}
        onMouseEnter={() => onClaimHover(r.claimId)}
        onMouseLeave={() => onClaimHover(null)}
        className={cn(
          "rounded px-0.5 underline decoration-dotted decoration-accent/60 underline-offset-[3px] transition-colors",
          highlightedClaimId === r.claimId
            ? "bg-accent/30 text-slate-900"
            : "bg-accent/10 hover:bg-accent/20",
        )}
      >
        {claimText}
      </button>,
    );
    cursor = r.end;
  });
  if (cursor < text.length) segments.push(text.slice(cursor));
  return segments;
}

function EmailBody({
  body,
  ranges,
  highlightedClaimId,
  onClaimActivate,
  onClaimHover,
}: {
  body: string;
  ranges: Range[];
  highlightedClaimId?: string | null;
  onClaimActivate: (claimId: string) => void;
  onClaimHover: (claimId: string | null) => void;
}) {
  const paragraphs = splitParagraphs(body);
  let searchFrom = 0;

  return (
    <div className="space-y-4">
      {paragraphs.map((para, i) => {
        const start = body.indexOf(para, searchFrom);
        const offset = start >= 0 ? start : searchFrom;
        searchFrom = offset + para.length;
        while (body[searchFrom] === "\n") searchFrom += 1;

        const paraRanges = ranges
          .filter((r) => r.start >= offset && r.start < offset + para.length)
          .map((r) => ({ ...r, start: r.start - offset, end: r.end - offset }));

        const isCta = i === paragraphs.length - 1 && paragraphs.length > 1;

        return (
          <p
            key={i}
            className={cn(
              "text-[15px] leading-[1.8] text-slate-700",
              isCta && "text-slate-800",
            )}
          >
            {buildClaimSegments(para, paraRanges, highlightedClaimId, onClaimActivate, onClaimHover)}
          </p>
        );
      })}
    </div>
  );
}

export function EmailCard({
  email,
  highlightedClaimId,
  onClaimActivate,
  onClaimHover,
}: {
  email: Email;
  highlightedClaimId?: string | null;
  onClaimActivate: (claimId: string) => void;
  onClaimHover: (claimId: string | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  const ranges = computeRanges(email.body, email.claims);

  const copy = () => {
    navigator.clipboard?.writeText(`Subject: ${email.subject}\n\n${email.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-card border border-line bg-bg-raised"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Badge tone={ANGLE_TONE[email.angleType]}>{email.angleType}</Badge>
          <span className="text-xs text-ink-muted">{email.angleLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={email.verifiedCount === email.totalCount ? "good" : "warn"}>
            {email.verifiedCount}/{email.totalCount} verified
          </Badge>
          <button
            onClick={copy}
            className="rounded px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-bg-hover hover:text-ink"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="m-4 overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200/80">
        <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            To · {email.persona.role} · {email.persona.seniority}
          </p>
        </div>
        <div className="px-5 py-5">
          <p className="mb-5 border-b border-slate-100 pb-4 text-[17px] font-semibold leading-snug tracking-tight text-slate-900">
            {email.subject}
          </p>
          <EmailBody
            body={email.body}
            ranges={ranges}
            highlightedClaimId={highlightedClaimId}
            onClaimActivate={onClaimActivate}
            onClaimHover={onClaimHover}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 pb-3 text-[11px] text-ink-faint">
        <span className={email.wordCount <= 120 ? "text-good" : "text-warn"}>
          {email.wordCount} words
        </span>
        <span>· single CTA</span>
      </div>
    </motion.div>
  );
}
