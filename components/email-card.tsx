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

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) segments.push(email.body.slice(cursor, r.start));
    const text = email.body.slice(r.start, r.end);
    segments.push(
      <button
        key={`c-${i}`}
        onClick={() => onClaimActivate(r.claimId)}
        onMouseEnter={() => onClaimHover(r.claimId)}
        onMouseLeave={() => onClaimHover(null)}
        className={cn(
          "rounded px-0.5 underline decoration-dotted decoration-accent/60 underline-offset-2 transition-colors",
          highlightedClaimId === r.claimId
            ? "bg-accent/30 text-slate-900"
            : "bg-accent/10 hover:bg-accent/20",
        )}
      >
        {text}
      </button>,
    );
    cursor = r.end;
  });
  if (cursor < email.body.length) segments.push(email.body.slice(cursor));

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

      {/* Light "email client" surface on the dark bg */}
      <div className="m-3 rounded bg-[#F7F7F8] p-4 text-slate-800">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
          To: {email.persona.role} · {email.persona.seniority}
        </p>
        <p className="mb-3 font-semibold text-slate-900">{email.subject}</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{segments}</p>
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
