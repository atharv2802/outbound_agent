"use client";

import { motion } from "framer-motion";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ClaimMap } from "@/lib/types";

export function ClaimMapPanel({
  claimMap,
  highlightedClaimId,
  onClaimHover,
  registerRef,
}: {
  claimMap: ClaimMap;
  highlightedClaimId?: string | null;
  onClaimHover: (claimId: string | null) => void;
  registerRef?: (claimId: string, el: HTMLDivElement | null) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Evidence Panel</CardTitle>
          <Badge tone={claimMap.verified === claimMap.total ? "good" : "warn"}>
            {claimMap.verified}/{claimMap.total} verified
          </Badge>
        </CardHeader>
        <CardBody className="space-y-5">
          {claimMap.groups.length === 0 && (
            <p className="text-sm text-ink-faint">No verified claims yet.</p>
          )}
          {claimMap.groups.map((group, gi) => (
            <div key={gi} className="space-y-2">
              <a
                href={group.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-[11px] text-accent hover:underline"
              >
                {group.sourceUrl}
              </a>
              {group.claims.map((claim) => (
                <div
                  key={claim.claimId}
                  ref={(el) => registerRef?.(claim.claimId, el)}
                  onMouseEnter={() => onClaimHover(claim.claimId)}
                  onMouseLeave={() => onClaimHover(null)}
                  className={cn(
                    "rounded-card border p-3 transition-colors",
                    highlightedClaimId === claim.claimId
                      ? "border-accent bg-accent/10"
                      : "border-line bg-bg-card",
                  )}
                >
                  <div className="mb-1.5 flex items-start gap-2">
                    <span className="mt-0.5 text-good">✓</span>
                    <p className="text-sm text-ink">{claim.text}</p>
                  </div>
                  <blockquote className="border-l-2 border-line-strong pl-3 text-[12px] italic text-ink-muted">
                    {truncate(claim.snippet, 220)}
                  </blockquote>
                </div>
              ))}
            </div>
          ))}

          {claimMap.stripped.length > 0 && (
            <div className="space-y-2 border-t border-line pt-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-warn">
                Stripped (unsupported) — {claimMap.stripped.length}
              </p>
              {claimMap.stripped.map((claim) => (
                <div
                  key={claim.claimId}
                  className="rounded-card border border-line bg-bg-card p-2 opacity-70"
                >
                  <p className="text-[12px] text-ink-muted line-through">{claim.text}</p>
                  {claim.reason && (
                    <p className="text-[10px] text-ink-faint">{claim.reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </motion.div>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
