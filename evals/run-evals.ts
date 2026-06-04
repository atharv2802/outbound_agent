/**
 * Offline eval harness. Replays each golden case through the REAL agent runtime
 * against cached fixtures (no live scraping), scores deterministic metrics + an
 * LLM-judge email rubric, prints a table, writes JSON, and exits non-zero if any
 * regression threshold fails.
 *
 * Requires OPENAI_API_KEY (LLM reasoning + judge are real calls). Scraping is
 * fully offline via fixtures.
 *
 * Run with: npm run eval
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { setScrapeFixtures, clearScrapeFixtures } from "@/lib/infra/scrape-client";
import { runSenderAnalysis, runTargetAnalysis } from "@/lib/agent/runtime";
import { saveSenderProfile } from "@/lib/agent/store";
import { Gateway } from "@/lib/gateway";
import { TokenLedger } from "@/lib/gateway/token-ledger";
import { Tracer } from "@/lib/gateway/trace";
import { judgeEmail } from "./llm-judge";
import * as metrics from "./metrics";
import { CASES } from "./cases";
import { config } from "@/lib/config";

import type { StreamEvent } from "@/lib/types";
import type { CollectedRun, MetricResult } from "./metrics";
import type { EvalCase } from "./cases";

const HERE = __dirname;
const ROOT = join(HERE, "..");
const RUBRIC_THRESHOLD = 4.0;

function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

function loadFixtures(files: string[]): Record<string, string> {
  const pages: Record<string, string> = {};
  for (const file of files) {
    const json = JSON.parse(readFileSync(join(HERE, "golden", file), "utf8"));
    Object.assign(pages, json.pages ?? {});
  }
  return pages;
}

function collect(events: StreamEvent[]): CollectedRun {
  const run: CollectedRun = { emails: [] };
  for (const e of events) {
    if (e.type === "result") {
      const d = e.data;
      if (d.type === "sender_analysis") run.senderProfile = d.profile;
      else if (d.type === "fit_evaluation") run.fitEvaluation = d.evaluation;
      else if (d.type === "angles") run.angles = d.angles;
      else if (d.type === "email") {
        run.emails = run.emails.filter((x) => x.angleIndex !== d.angleIndex);
        run.emails.push(d);
      } else if (d.type === "claim_map") run.claimMap = d;
    } else if (e.type === "meta") run.stats = e.stats;
    else if (e.type === "error") run.error = e.message;
  }
  run.emails.sort((a, b) => a.angleIndex - b.angleIndex);
  return run;
}

async function runCase(c: EvalCase): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  const emit = (e: StreamEvent) => events.push(e);

  if (c.mode === "sender") {
    setScrapeFixtures(loadFixtures(c.fixtureFiles));
    await runSenderAnalysis({ url: c.url, emit });
  } else {
    saveSenderProfile(c.fixedSenderProfile);
    setScrapeFixtures(loadFixtures(c.fixtureFiles));
    await runTargetAnalysis({
      targetUrl: c.targetUrl,
      senderUrl: c.senderUrl,
      persona: c.persona,
      emit,
    });
  }
  clearScrapeFixtures();
  return events;
}

function fmt(m: MetricResult): string {
  const mark = m.pass ? "PASS" : "FAIL";
  return `    [${mark}] ${m.name.padEnd(22)} ${String(m.value).padEnd(28)} ${m.detail ?? ""}`;
}

async function main() {
  loadEnv(join(ROOT, ".env.local"));

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "\n  OPENAI_API_KEY is not set. Add it to .env.local to run evals.\n",
    );
    process.exit(1);
  }

  console.log(`\n  Outbound Strategy Engine — Eval Harness`);
  console.log(`  Token budget ${config.run.tokenBudget}, cap ${config.run.wallClockMs / 1000}s\n`);

  const judgeGateway = new Gateway({ ledger: new TokenLedger(1_000_000), tracer: new Tracer() });
  const report: Record<string, unknown>[] = [];
  let allPass = true;

  for (const c of CASES) {
    console.log(`  ▸ ${c.id} (${c.mode})`);
    const started = Date.now();
    let run: CollectedRun;
    try {
      run = collect(await runCase(c));
    } catch (err) {
      console.log(`    [FAIL] run threw: ${err instanceof Error ? err.message : err}\n`);
      allPass = false;
      report.push({ id: c.id, error: String(err) });
      continue;
    }

    const results: MetricResult[] = [
      metrics.schemaValidity(run),
      metrics.budgetCompliance(run),
    ];

    if (c.mode === "sender") {
      results.push(metrics.icpCoverage(run, c.expectedIcpDimensions));
    } else {
      results.push(metrics.groundedness(run));
      results.push(metrics.angleDistinctiveness(run));

      // LLM-judge rubric per email.
      let rubricSum = 0;
      for (const email of run.emails) {
        const score = await judgeEmail(judgeGateway, email);
        rubricSum += score.avg;
        results.push({
          name: `Rubric (angle ${email.angleIndex})`,
          value: `${score.avg}/5`,
          pass: score.avg >= RUBRIC_THRESHOLD,
          detail: `p${score.personalization} s${score.specificity} c${score.ctaClarity} l${score.length}`,
        });
      }
      const avgRubric = run.emails.length ? rubricSum / run.emails.length : 0;
      results.push({
        name: "Avg rubric",
        value: `${avgRubric.toFixed(2)}/5`,
        pass: avgRubric >= RUBRIC_THRESHOLD,
        detail: `threshold ${RUBRIC_THRESHOLD}`,
      });

      // Expected fit direction.
      const score = run.fitEvaluation?.overallScore ?? 0;
      const dir = score >= 7 ? "high" : score >= 4 ? "medium" : "low";
      results.push({
        name: "Fit direction",
        value: `${score}/10 (${dir})`,
        pass: dir === c.expectedFitDirection,
        detail: `expected ${c.expectedFitDirection}`,
      });
    }

    for (const r of results) console.log(fmt(r));
    const casePass = results.every((r) => r.pass);
    allPass = allPass && casePass;
    console.log(`    → ${casePass ? "PASS" : "FAIL"} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    report.push({
      id: c.id,
      pass: casePass,
      results,
      stats: run.stats,
      emails: run.emails.map((e) => ({
        angleIndex: e.angleIndex,
        angleType: e.angleType,
        subject: e.subject,
        body: e.body,
        wordCount: e.wordCount,
      })),
    });
  }

  const outDir = join(HERE, "results");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `eval-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify({ allPass, report }, null, 2));

  console.log(`  ${allPass ? "ALL CASES PASSED" : "SOME CASES FAILED"}`);
  console.log(`  Report written to ${outFile}\n`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
