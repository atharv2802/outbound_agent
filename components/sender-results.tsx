"use client";

import { motion } from "framer-motion";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Confidence, GroundedField, SenderProfile } from "@/lib/types";

const CONFIDENCE_TONE: Record<Confidence, string> = {
  high: "bg-good",
  medium: "bg-warn",
  low: "bg-bad",
};

function EvidenceDot({ chunkIds }: { chunkIds: string[] }) {
  if (chunkIds.length === 0) return null;
  return (
    <span
      title={`${chunkIds.length} supporting snippet(s): ${chunkIds.join(", ")}`}
      className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full bg-good/15 text-[8px] font-medium text-good"
    >
      {chunkIds.length}
    </span>
  );
}

function TagGroup({
  title,
  field,
  tone = "neutral",
}: {
  title: string;
  field: GroundedField<string[]>;
  tone?: "neutral" | "accent" | "warn" | "bad";
}) {
  if (!field.value || field.value.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {title}
        <EvidenceDot chunkIds={field.chunkIds} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {field.value.map((v, i) => (
          <Badge key={i} tone={tone}>
            {v}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function SenderResults({ profile }: { profile: SenderProfile }) {
  const { icp } = profile;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Value Proposition · {profile.companyName}</CardTitle>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span
              className={cn("h-2 w-2 rounded-full", CONFIDENCE_TONE[profile.confidence])}
            />
            {profile.confidence} confidence
          </span>
        </CardHeader>
        <CardBody>
          <p className="text-[15px] leading-relaxed text-ink">{profile.valueProp}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ideal Customer Profile</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <TagGroup title="Industries" field={icp.industries} tone="accent" />
          <TagGroup title="Company sizes" field={icp.companySizes} />
          <TagGroup title="Personas" field={icp.personas} tone="accent" />
          <TagGroup title="Triggers" field={icp.triggers} tone="warn" />
          <TagGroup title="Pains" field={icp.pains} tone="warn" />
          <TagGroup title="Disqualifiers" field={icp.disqualifiers} tone="bad" />
        </CardBody>
      </Card>

      {profile.evidenceGaps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Evidence gaps</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
              {profile.evidenceGaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </motion.div>
  );
}
