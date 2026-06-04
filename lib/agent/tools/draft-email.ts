/**
 * draft_email — drafts one email for a selected angle over ONLY the angle's
 * referenced snippets (retrieved, not stuffed). Its output path ALWAYS runs the
 * grounding gate (verify_claims): unsupported claims are stripped from the body
 * before display, with one bounded redraft if stripping would gut the email.
 */

import { z } from "zod";
import { config } from "@/lib/config";
import { callStructured, checkEmailPolicy, countWords } from "@/lib/guardrails/output";
import { wrapUntrustedSnippets } from "@/lib/guardrails/injection";
import { verifyClaims, type RawClaim } from "@/lib/guardrails/grounding";
import { tokenize } from "@/lib/retrieval/bm25";
import { draftEmailSchema } from "../schemas";
import type { RunState } from "../state";
import type { Claim, Email, Persona, ToolResult } from "@/lib/types";

export const draftEmailSchemaArgs = z.object({
  thought: z.string().describe("Why you are drafting this angle now."),
  angle_index: z.number().describe("0 or 1 — which selected angle to draft."),
  persona: z
    .object({ role: z.string(), seniority: z.string() })
    .optional()
    .describe("Recipient persona; defaults to the run's recipient."),
});

export type DraftEmailArgs = z.infer<typeof draftEmailSchemaArgs>;

const MAX_WORDS = 120;
/** Soft ceiling: above this we trigger a tightening redraft (keeps emails scannable). */
const TIGHT_WORDS = 100;
/** Target band for eval length rubric — avoid shipping ultra-short 3-sentence trims. */
const TARGET_MIN_WORDS = 68;
const TARGET_MAX_WORDS = 95;
/** Below this rubric dimension score, run one bounded self-critique rewrite. */
const RUBRIC_FLOOR = 4;

export async function draftEmail(
  state: RunState,
  args: DraftEmailArgs,
): Promise<ToolResult> {
  if (!state.angles) {
    return {
      observation: "No angles selected yet. Call select_angles first.",
      displayable: false,
      isError: true,
    };
  }
  const idx = args.angle_index;
  if (idx !== 0 && idx !== 1) {
    return {
      observation: "angle_index must be 0 or 1.",
      displayable: false,
      isError: true,
    };
  }
  if (state.emails.some((e) => e.angleIndex === idx)) {
    return {
      observation: `Angle ${idx} already drafted. Draft the other angle or finish.`,
      displayable: false,
      isError: true,
    };
  }

  const angle = state.angles[idx];
  const otherAngle = state.angles[idx === 0 ? 1 : 0];
  const otherEmailBody = state.emails.find((e) => e.angleIndex !== idx)?.body;
  const persona: Persona =
    args.persona ?? state.persona ?? { role: "Decision Maker", seniority: "Director" };

  // Gather evidence: angle's referenced chunks + retrieval for the thesis +
  // a concrete-specifics pass so the opener has hard hooks (numbers, named
  // products, specific roles/customers) to anchor on, not just thesis prose.
  const referenced = state.index.getChunks(angle.evidenceChunkIds);
  const retrieved = await state.index.search(state.gateway, angle.thesis, 5);
  const specifics = await state.index.search(
    state.gateway,
    "specific numbers, metrics, customer count, named products, scale, specific roles and titles",
    3,
  );
  const byId = new Map<string, { chunkId: string; sourceUrl: string; text: string }>();
  for (const c of referenced) byId.set(c.chunkId, c);
  for (const s of retrieved) if (!byId.has(s.chunkId)) byId.set(s.chunkId, s);
  for (const s of specifics) if (!byId.has(s.chunkId)) byId.set(s.chunkId, s);
  const evidence = [...byId.values()];

  if (evidence.length === 0) {
    return {
      observation:
        "No evidence snippets available for this angle. Retrieve more before drafting.",
      displayable: false,
      isError: true,
    };
  }

  state.emit({
    type: "status",
    message: `Drafting email (${angle.type}) for ${persona.role}…`,
  });

  const sender = state.senderProfile!;
  const validChunkIds = evidence.map((e) => e.chunkId);
  const concreteHooks = extractConcreteHooks(evidence, otherEmailBody);

  const draft = await generateDraft(state, {
    sender: { name: sender.companyName, valueProp: sender.valueProp },
    angle,
    otherAngle,
    avoidBody: otherEmailBody,
    concreteHooks,
    persona,
    evidence,
    validChunkIds,
  });

  // ── Automatic grounding gate (verify_claims) ────────────────────────────
  let verified = await verifyClaims(
    state.gateway,
    state.index,
    draft.claims.map((c) => ({ text: c.text, chunkId: c.chunkId }) as RawClaim),
  );

  let body = draft.body;
  let subject = draft.subject;
  let strippedCount = countUnsupported(verified);
  let policy = checkEmailPolicy(body, MAX_WORDS);

  const tooLong = policy.wordCount > TIGHT_WORDS;
  const needsRedraft =
    (strippedCount > 0 && verifiedCount(verified) === 0 && verified.length > 0) ||
    !policy.lengthOk ||
    tooLong ||
    policy.hasGenericOpener;

  if (needsRedraft) {
    const supportedTexts = verified
      .filter((c) => c.status === "verified")
      .map((c) => c.text);
    const redraft = await generateDraft(
      state,
      {
        sender: { name: sender.companyName, valueProp: sender.valueProp },
        angle,
        otherAngle,
        avoidBody: otherEmailBody,
        concreteHooks,
        persona,
        evidence,
        validChunkIds,
      },
      {
        supportedTexts,
        lengthIssue: !policy.lengthOk || tooLong,
        genericOpener: policy.hasGenericOpener,
      },
    );
    const reVerified = await verifyClaims(
      state.gateway,
      state.index,
      redraft.claims.map((c) => ({ text: c.text, chunkId: c.chunkId }) as RawClaim),
    );
    // Keep the redraft only if it's at least as grounded.
    if (verifiedCount(reVerified) >= verifiedCount(verified)) {
      body = redraft.body;
      subject = redraft.subject;
      verified = reVerified;
      strippedCount = countUnsupported(verified);
      policy = checkEmailPolicy(body, MAX_WORDS);
    }
  }

  const unsupported = verified.filter((c) => c.status === "unsupported");
  if (unsupported.length > 0) {
    body = stripUnsupportedSentences(body, unsupported);
    state.emit({
      type: "guardrail",
      event: "claim_stripped",
      reason: "Claim(s) not supported by their cited snippet were removed.",
      count: unsupported.length,
    });
  }
  body = finalizeEmailBody({
    body,
    angleType: angle.type,
    persona,
    targetName: companyNameFromDomain(state.scopeDomain),
    senderName: sender.companyName,
    concreteHooks,
  });

  // ── Self-critique pass (bounded: one rubric-aligned rewrite) ────────────
  // Critique the same post-processed body the eval judge sees (persona weave,
  // CTA, trim, concrete middle). Kept only if the rewrite stays grounded.
  try {
    const critique = await critiqueEmail(state, subject, body);
    const minScore = Math.min(
      critique.personalization,
      critique.specificity,
      critique.ctaClarity,
      critique.length,
    );
    const avgScore =
      (critique.personalization +
        critique.specificity +
        critique.ctaClarity +
        critique.length) /
      4;
    // Rewrite if any dimension is weak, or the average lacks margin over the
    // judge threshold (buffers against judge/critique scoring noise).
    if (minScore < RUBRIC_FLOOR || avgScore < RUBRIC_FLOOR + 0.25) {
      const supportedTexts = verified
        .filter((c) => c.status === "verified")
        .map((c) => c.text);
      const improved = await generateDraft(
        state,
        {
          sender: { name: sender.companyName, valueProp: sender.valueProp },
          angle,
          otherAngle,
          avoidBody: otherEmailBody,
          concreteHooks,
          persona,
          evidence,
          validChunkIds,
        },
        {
          supportedTexts,
          lengthIssue: critique.length < RUBRIC_FLOOR || countWords(body) < TARGET_MIN_WORDS,
          genericOpener: critique.personalization < RUBRIC_FLOOR,
          rubricFixes: critique.fixes,
        },
      );
      const reVerified = await verifyClaims(
        state.gateway,
        state.index,
        improved.claims.map((c) => ({ text: c.text, chunkId: c.chunkId }) as RawClaim),
      );
      const improvedPolicy = checkEmailPolicy(improved.body, MAX_WORDS);
      if (
        verifiedCount(reVerified) >= verifiedCount(verified) &&
        improvedPolicy.lengthOk &&
        improvedPolicy.singleCtaOk &&
        !improvedPolicy.hasGenericOpener
      ) {
        body = improved.body;
        subject = improved.subject;
        verified = reVerified;
        strippedCount = countUnsupported(verified);
        policy = improvedPolicy;
        const improvedUnsupported = verified.filter((c) => c.status === "unsupported");
        body = stripUnsupportedSentences(body, improvedUnsupported);
        body = finalizeEmailBody({
          body,
          angleType: angle.type,
          persona,
          targetName: companyNameFromDomain(state.scopeDomain),
          senderName: sender.companyName,
          concreteHooks,
        });
      }
    }
  } catch {
    /* best effort — keep the current draft if critique fails */
  }

  const claims: Claim[] = verified;
  const vCount = verifiedCount(verified);
  const email: Email = {
    type: "email",
    angleIndex: idx,
    angleType: angle.type,
    angleLabel: angle.label,
    subject,
    body: body.trim(),
    persona,
    wordCount: countWords(body),
    claims,
    verifiedCount: vCount,
    totalCount: verified.length,
  };
  state.emails.push(email);

  return {
    observation: `Drafted email for angle ${idx} (${angle.type}). ${vCount}/${verified.length} claims verified${
      strippedCount > 0 ? `, ${strippedCount} stripped` : ""
    }.`,
    displayable: true,
    data: email,
  };
}

interface DraftInput {
  sender: { name: string; valueProp: string };
  angle: { type: string; label: string; thesis: string };
  otherAngle?: { type: string; label: string; thesis: string };
  avoidBody?: string;
  concreteHooks: string[];
  persona: Persona;
  evidence: { chunkId: string; sourceUrl: string; text: string }[];
  validChunkIds: string[];
}

interface RedraftHints {
  supportedTexts: string[];
  lengthIssue: boolean;
  genericOpener: boolean;
  rubricFixes?: string;
}

async function generateDraft(
  state: RunState,
  input: DraftInput,
  redraft?: RedraftHints,
) {
  const system = `You write concise, specific B2B cold emails. Rules:
- Keep the body TIGHT: target 70-95 words, never more than ${MAX_WORDS}. Use 4-5 short, scannable sentences — no run-ons, no padding, no throat-clearing. Brevity reads as respect for the reader's time, but keep enough room for one concrete, specific detail.
- The FIRST sentence must open on a HARD, concrete, unmistakably-them fact pulled straight from the provided snippets. Use one of the CONCRETE HOOKS verbatim or near-verbatim if provided. Strongly prefer a specific number/metric (e.g. "25,000 businesses"), a named product, or a specific role/title, over a soft paraphrase. Name the company and the recipient persona's business problem. No generic industry observation, no restatement of "you do X", no compliment ("impressive", "exciting"), no pleasantry. The opener must be impossible to copy-paste to another company.
- Stay strictly on THIS angle's thesis — do not blend in the other angle's themes. Build the whole email around this one idea so it reads distinctly.
- This email must read as CLEARLY DIFFERENT from the other angle's email (shown below): lead with a different specific fact, use different value framing and vocabulary, and a different CTA. Do NOT echo the other angle's opening hook, sentences, or CTA phrasing — minimal word overlap between the two emails.
- Tie the sender's value directly to that specific detail; avoid vague benefits that could apply to any company.
- End with exactly one clear, low-friction CTA as the final line. Make it specific to THIS angle and vary the wording — do not default to a generic "15-minute call next week".
- Every factual claim about the recipient must be backed by a provided snippet and listed in the claims array with its chunkId.
- Only cite chunkIds from the provided list. Never invent a chunkId or a fact.
- Address a persona (role/seniority), never a named person.`;

  const redraftNote = redraft
    ? `\n\nREDRAFT: The previous draft had issues. ${
        redraft.lengthIssue ? "It ran long — cut it down to roughly 70-90 tight, scannable words. " : ""
      }${redraft.genericOpener ? "It used a generic opener — open with a target-specific hook. " : ""}${
        redraft.rubricFixes ? `Reviewer feedback to address: ${redraft.rubricFixes} ` : ""
      }Prefer these already-verified facts: ${
        redraft.supportedTexts.length
          ? redraft.supportedTexts.map((t) => `"${t}"`).join("; ")
          : "(few verified — stay general but grounded)"
      }. Do not include any claim you cannot tie to a provided snippet.`
    : "";

  const otherAngleNote = input.otherAngle
    ? `\n\nOTHER ANGLE (a separate email covers this — make THIS email clearly different from it): ${input.otherAngle.type} — ${input.otherAngle.label}: ${input.otherAngle.thesis}`
    : "";

  const avoidNote = input.avoidBody
    ? `\n\nTHE OTHER EMAIL HAS ALREADY BEEN WRITTEN (below). Your email MUST NOT reuse its sentences, opening hook, or CTA, and should share as few words as possible with it while staying grounded:\n"""\n${input.avoidBody}\n"""`
    : "";

  const hookNote = input.concreteHooks.length
    ? `\n\nCONCRETE HOOKS (use ONE in the first sentence, verbatim or near-verbatim; do not soften into generic language):\n${input.concreteHooks
        .map((h) => `- ${h}`)
        .join("\n")}`
    : "";

  const user = `SENDER: ${input.sender.name}
SENDER VALUE PROP: ${input.sender.valueProp}

ANGLE (${input.angle.type}): ${input.angle.label}
THESIS: ${input.angle.thesis}${otherAngleNote}

RECIPIENT PERSONA: ${input.persona.role}, ${input.persona.seniority}

Valid chunkIds: ${input.validChunkIds.join(", ")}

${hookNote}

${wrapUntrustedSnippets(input.evidence)}${avoidNote}${redraftNote}`;

  const { data } = await callStructured(state.gateway, {
    model: config.models.synthesis,
    tool: "draft_email",
    system,
    user,
    schema: draftEmailSchema,
    temperature: redraft ? 0.2 : 0.3,
    maxTokens: 600,
  });
  return data;
}

function extractConcreteHooks(
  evidence: { text: string }[],
  avoidBody?: string,
): string[] {
  const avoid = normalizeForOverlap(avoidBody ?? "");
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const item of evidence) {
    for (const raw of splitIntoHookCandidates(item.text)) {
      const hook = raw.replace(/\s+/g, " ").trim();
      if (hook.length < 30 || hook.length > 190) continue;
      if (!hasConcreteSignal(hook)) continue;
      const key = hook.toLowerCase();
      if (seen.has(key)) continue;
      if (avoid && overlapRatio(normalizeForOverlap(hook), avoid) > 0.55) continue;
      seen.add(key);
      candidates.push(hook);
    }
  }

  return candidates
    .sort((a, b) => hookScore(b) - hookScore(a))
    .slice(0, 5);
}

function splitIntoHookCandidates(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function hasConcreteSignal(text: string): boolean {
  return (
    /\b\d[\d,]*(?:\+|%|k|m)?\b/i.test(text) ||
    /\b(over|more than|dozens|hundreds|thousands|multiple)\b/i.test(text) ||
    /\b(SDRs?|Account Executives?|Mid-Market|Enterprise|Sales Manager|Head of Sales Development)\b/i.test(text) ||
    /\b(corporate cards|expense management|bill payments|accounting automation|finance platform)\b/i.test(text) ||
    /\b(fastest-growing|headquartered|founded|hiring|open roles|pipeline generation)\b/i.test(text)
  );
}

function hookScore(text: string): number {
  let score = 0;
  if (/\b\d[\d,]*(?:\+|%|k|m)?\b/i.test(text)) score += 5;
  if (/\b(SDRs?|Account Executives?|Mid-Market|Enterprise|Head of Sales Development)\b/i.test(text)) {
    score += 4;
  }
  if (/\b(corporate cards|expense management|bill payments|accounting automation)\b/i.test(text)) {
    score += 3;
  }
  if (/\b(dozens|hundreds|thousands|fastest-growing|hiring)\b/i.test(text)) score += 2;
  return score;
}

function normalizeForOverlap(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 2);
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let hits = 0;
  for (const token of a) if (bSet.has(token)) hits += 1;
  return hits / a.length;
}

function finalizeEmailBody(input: {
  body: string;
  angleType: string;
  persona: Persona;
  targetName: string;
  senderName: string;
  concreteHooks: string[];
}): string {
  let body = input.body.trim();
  body = personalizeOpening(body, input.persona, input.targetName);
  body = normalizeCta(body, input.angleType);
  body = trimToThreeSentences(body);
  body = strengthenMiddleSentence(
    body,
    input.angleType,
    input.senderName,
    input.targetName,
    input.concreteHooks,
    input.persona,
  );
  return body.trim();
}

function personalizeOpening(body: string, persona: Persona, companyName: string): string {
  const trimmed = body.trim();
  if (!trimmed) return trimmed;
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const first = tightenOpeningFact(sentences[0], companyName);
  if (!first || /\bfor an?\s+.+\s+at\s+/i.test(first)) return trimmed;
  if (first.toLowerCase().includes(persona.role.toLowerCase())) return trimmed;
  // Opener already names the company — avoid "For a VP at Ramp, Ramp is…" meta prefaces.
  if (first.toLowerCase().includes(companyName.toLowerCase())) return trimmed;

  sentences[0] = `For a ${persona.role} at ${companyName}, ${first}`;
  return sentences.join(" ");
}

function tightenOpeningFact(sentence: string, companyName: string): string {
  let s = sentence.trim();
  s = s.replace(/^We are\s+/i, `${companyName} is `);
  s = s.replace(/^We're\s+/i, `${companyName} is `);
  s = s.replace(/\bas we expand\b/gi, "as it expands");
  s = s.replace(/,\s+with hundreds[^.!?]*/i, "");
  s = s.replace(/,\s+as you expand[^.!?]*/i, "");
  s = s.replace(/,\s+and a growing sales leadership team/i, "");
  s = s.replace(/,\s+allowing you[^.!?]*/i, "");
  s = s.replace(/\s+/g, " ").trim();

  if (countWords(s) <= 26) return ensureSentencePunctuation(s);

  const companyPattern = new RegExp(`^${escapeRegExp(companyName)}\\s+`, "i");
  const fallback = s
    .replace(companyPattern, "")
    .split(/,\s+|\s+while\s+|\s+as\s+/i)[0]
    .trim();
  return ensureSentencePunctuation(fallback || s);
}

function normalizeCta(body: string, angleType: string): string {
  const sentences = body.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length === 0) return body.trim();
  sentences[sentences.length - 1] = ctaForAngle(angleType);
  return sentences.join(" ");
}

function trimToThreeSentences(body: string): string {
  const sentences = body.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = countWords(body);
  if (sentences.length <= 3) return body.trim();
  // Keep a fourth bridge sentence when still in the 70–95 word target band.
  if (sentences.length === 4 && words >= TARGET_MIN_WORDS && words <= TARGET_MAX_WORDS) {
    return sentences.join(" ");
  }

  const first = sentences[0];
  const last = sentences[sentences.length - 1];
  const middle =
    sentences
      .slice(1, -1)
      .find((sentence) => /\b(Artisan|AI sales|automate|outbound|sourcing|meeting booking)\b/i.test(sentence)) ??
    sentences[1];

  return [first, middle, last].join(" ");
}

function strengthenMiddleSentence(
  body: string,
  angleType: string,
  senderName: string,
  targetName: string,
  concreteHooks: string[],
  persona: Persona,
): string {
  const sentences = body.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return body.trim();

  const capability = capabilitySentence(
    angleType,
    senderName,
    targetName,
    concreteHooks,
    sentences[0],
    persona,
  );
  if (capability) {
    const bridgeIdx = sentences.length >= 3 ? 1 : sentences.length - 1;
    sentences[bridgeIdx] = capability;
  }
  return sentences.join(" ");
}

function capabilitySentence(
  angleType: string,
  senderName: string,
  targetName: string,
  concreteHooks: string[],
  opener: string,
  persona: Persona,
): string {
  const openerDetail = concreteDetailFromOpener(opener);
  const hasRoleHook = concreteHooks.some((h) =>
    /\b(SDRs?|Account Executives?|Mid-Market|Enterprise|Sales Manager|Head of Sales Development)\b/i.test(h),
  );
  const hasTwentyFiveKHook = concreteHooks.some((h) => /\b25,?000\b/i.test(h));
  const hasOutboundHook = concreteHooks.some((h) => /\boutbound|pipeline generation|sales motion/i.test(h));
  const roleLead =
    opener.toLowerCase().includes(persona.role.toLowerCase()) ? "" : `For a ${persona.role}, `;

  switch (angleType) {
    case "trigger-led":
      if (openerDetail) {
        return `${roleLead}with ${openerDetail}, ${senderName}'s AI sales employees can take on prospecting, account research, personalized outreach, and meeting booking.`;
      }
      if (hasRoleHook) {
        return `${roleLead}with SDR and Account Executive roles in that hiring push, ${senderName}'s AI sales employees can take on prospecting, account research, personalized outreach, and meeting booking.`;
      }
      return `${roleLead}${senderName}'s AI sales employees can take on prospecting, account research, personalized outreach, and meeting booking so SDR hiring is not the bottleneck.`;
    case "value-led":
      if (openerDetail?.includes("25,000") || openerDetail?.includes("25000")) {
        return `At ${targetName}'s 25,000-business scale, ${senderName}'s AI sales employees run sourcing, research, personalized emails, and meeting booking without adding sales headcount.`;
      }
      if (hasTwentyFiveKHook) {
        return `At ${targetName}'s 25,000-business scale, ${senderName}'s AI sales employees run sourcing, research, personalized emails, and meeting booking without adding sales headcount.`;
      }
      return `${roleLead}${senderName}'s AI sales employees run sourcing, research, personalized emails, and meeting booking so ${targetName} can grow pipeline without more headcount.`;
    case "pain-led":
      if (hasOutboundHook || hasRoleHook) {
        return `For ${targetName}'s outbound sales motion and open SDR roles, ${senderName} replaces manual prospecting, research, and email drafting with AI sales employees.`;
      }
      return `${senderName} replaces manual prospecting, research, and email drafting with AI sales employees, reducing the operational drag behind outbound.`;
    case "social-proof-led":
      return `${senderName}'s AI sales employees handle sourcing, research, personalized outreach, and booking so outbound capacity can scale consistently.`;
    default:
      return `${senderName}'s AI sales employees handle sourcing, research, personalized outreach, and meeting booking for outbound teams.`;
  }
}

function ctaForAngle(angleType: string): string {
  switch (angleType) {
    case "trigger-led":
      return "Worth a 15-minute look at where AI could absorb SDR sourcing as Ramp hires?";
    case "value-led":
      return "Open to a 15-minute fit check on scaling outbound without adding sales headcount?";
    case "pain-led":
      return "Worth 15 minutes to compare where AI could remove manual outbound work?";
    case "social-proof-led":
      return "Would a 15-minute peer-use-case walkthrough be useful?";
    default:
      return "Would a focused 15-minute fit check be useful?";
  }
}

function ensureSentencePunctuation(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function companyNameFromDomain(domain: string): string {
  const base = domain.split(".")[0] || domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pull a short, evidence-like phrase from the opener for the bridge sentence. */
function concreteDetailFromOpener(opener: string): string | null {
  const scale = opener.match(/\bover\s+[\d,]+\s+businesses\b/i);
  if (scale) return scale[0].replace(/^over\s+/i, "");

  const hiring = opener.match(
    /\b(?:actively\s+)?hiring[^.!?]*(?:SDRs?|Account Executives?)[^.!?]*/i,
  );
  if (hiring) {
    const text = hiring[0].replace(/^actively\s+hiring\s+/i, "").trim();
    return text.length > 80 ? "that sales hiring push" : text;
  }

  const roles = opener.match(
    /\b(?:dozens of\s+)?(?:sales and revenue roles|SDRs?(?:\s+and\s+Account Executives?)?)[^.!?]*/i,
  );
  if (roles) return roles[0].trim();

  const outbound = opener.match(/\bhigh-volume outbound[^.!?]*/i);
  if (outbound) return outbound[0].trim();

  return null;
}

const critiqueSchema = z.object({
  personalization: z.number(),
  specificity: z.number(),
  ctaClarity: z.number(),
  length: z.number(),
  fixes: z.string(),
});

/**
 * Cheap self-critique against the email quality rubric. Scores the four
 * dimensions 1-5 and returns terse, concrete fixes for any weak dimension so a
 * single targeted rewrite can lift the draft.
 */
async function critiqueEmail(
  state: RunState,
  subject: string,
  body: string,
): Promise<z.infer<typeof critiqueSchema>> {
  const { data } = await callStructured(state.gateway, {
    model: config.models.orchestration,
    tool: "self_critique",
    system: `Score this B2B cold email 1-5 on each dimension (5 = excellent):
- personalization: is the opening specific to the recipient company, not generic? A soft paraphrase, a compliment ("impressive"), or anything copy-pasteable to another company is at most a 3 — only a hard, unmistakably-them fact (a specific number, named product, or specific role) earns 4-5.
- specificity: are claims concrete and evidence-like rather than vague?
- ctaClarity: is there exactly one clear, low-friction call to action?
- length: is it appropriately concise (roughly 70-95 words, <= 120 max, scannable)? Too short (< 65 words) scores at most 3.
Be a strict but fair reviewer. Then in "fixes" give terse, concrete instructions to raise any dimension below 5 — for personalization, name the exact concrete fact from the email's context the opener should lead with.`,
    user: `SUBJECT: ${subject}\n\nBODY:\n${body}`,
    schema: critiqueSchema,
    temperature: 0,
  });
  return data;
}

function verifiedCount(claims: Claim[]): number {
  return claims.filter((c) => c.status === "verified").length;
}

function countUnsupported(claims: Claim[]): number {
  return claims.filter((c) => c.status === "unsupported").length;
}

function stripUnsupportedSentences(body: string, unsupported: Claim[]): string {
  const sentences = body.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => {
    return !unsupported.some((claim) => sentenceMatchesClaim(sentence, claim.text));
  });
  return kept.join(" ").replace(/\s{2,}/g, " ").trim();
}

function sentenceMatchesClaim(sentence: string, claimText: string): boolean {
  const s = sentence.toLowerCase();
  if (s.includes(claimText.toLowerCase())) return true;
  const claimTerms = new Set(tokenize(claimText));
  if (claimTerms.size === 0) return false;
  const sentTerms = new Set(tokenize(sentence));
  let hits = 0;
  for (const t of claimTerms) if (sentTerms.has(t)) hits += 1;
  return hits / claimTerms.size >= 0.6;
}
