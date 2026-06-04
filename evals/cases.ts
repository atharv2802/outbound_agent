/**
 * Golden eval cases. Sender cases replay Mode 1; target cases replay Mode 2 with
 * an injected fixed SenderProfile (so fit/angles/email quality are tested in
 * isolation from Mode 1 variance). All scraping is served from cached fixtures.
 */

import type { Persona, SenderProfile } from "@/lib/types";

export interface SenderCase {
  id: string;
  mode: "sender";
  url: string;
  fixtureFiles: string[];
  expectedIcpDimensions: string[];
  mustMentionTerms: string[];
}

export interface TargetCase {
  id: string;
  mode: "target";
  senderUrl: string;
  targetUrl: string;
  persona: Persona;
  fixtureFiles: string[];
  fixedSenderProfile: SenderProfile;
  expectedFitDirection: "high" | "medium" | "low";
}

export type EvalCase = SenderCase | TargetCase;

const ARTISAN_PROFILE: SenderProfile = {
  domain: "artisan.co",
  companyName: "Artisan",
  valueProp:
    "Artisan provides AI sales employees that automate the entire outbound process — sourcing, research, personalized email, and meeting booking — so teams can scale pipeline without scaling headcount.",
  valuePropChunkIds: [],
  icp: {
    industries: { value: ["B2B SaaS", "Technology", "Fintech"], chunkIds: [] },
    companySizes: { value: ["10-500 employees", "Startup to mid-market"], chunkIds: [] },
    personas: { value: ["VP of Sales", "Head of Growth", "RevOps", "Founder"], chunkIds: [] },
    triggers: {
      value: ["Scaling outbound", "Hiring SDRs/AEs", "Expanding GTM team"],
      chunkIds: [],
    },
    pains: {
      value: [
        "Expensive and slow SDR hiring",
        "Fragmented prospecting stack",
        "Manual outbound busywork",
      ],
      chunkIds: [],
    },
    disqualifiers: { value: ["Non-sales-led", "No outbound motion"], chunkIds: [] },
  },
  confidence: "high",
  evidenceGaps: [],
  createdAt: Date.now(),
};

export const CASES: EvalCase[] = [
  {
    id: "sender-artisan",
    mode: "sender",
    url: "https://artisan.co",
    fixtureFiles: ["artisan.co.json"],
    expectedIcpDimensions: ["industries", "companySizes", "personas", "triggers", "pains"],
    mustMentionTerms: ["sales", "outbound"],
  },
  {
    id: "target-artisan-ramp",
    mode: "target",
    senderUrl: "https://artisan.co",
    targetUrl: "https://ramp.com",
    persona: { role: "VP of Sales", seniority: "Executive" },
    fixtureFiles: ["ramp.com.json"],
    fixedSenderProfile: ARTISAN_PROFILE,
    expectedFitDirection: "high",
  },
];
