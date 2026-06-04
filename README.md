# Outbound Strategy Engine

An agentic web app that turns a company's public footprint into grounded outbound sales strategy. A ReAct agent researches the web in real time, retrieves **snippets (not whole pages)**, and writes emails where **every claim is bound to verified evidence**.

## Demo

### Mode 1 — Sender Analysis

Analyze a company site to infer value proposition and ICP, with per-dimension provenance.

https://github.com/user-attachments/assets/ae74077e-1293-4474-ab5c-43034294e9fa


### Mode 2 — Target Outbound

Research a target against the sender's ICP, score fit, draft two distinct-angle emails, and assemble a verified claim map.

https://github.com/user-attachments/assets/438488e5-beb3-42a3-8127-5508e1d8e2ff


## Quick start

```bash
npm install
cp .env.example .env.local   # add your OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

| Command | Purpose |
|---|---|
| `npm run build && npm start` | Production server (required for in-memory state reuse) |
| `npm run eval` | Offline eval suite against golden fixtures |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

Full setup, example inputs, costs, and troubleshooting: [`instruction.md`](./instruction.md).

## Two modes

| Mode | Input | Output |
|---|---|---|
| **1 — Sender Analysis** | Company domain (e.g. `artisan.co`) | `SenderProfile`: value proposition + ICP with evidence-backed dimensions, persisted by domain |
| **2 — Target Outbound** | Sender + target domains, recipient role (e.g. `artisan.co → ramp.com`) | Fit scorecard, two distinct-type email angles, verified claim map with bidirectional evidence links |

Mode 2 reuses a cached `SenderProfile` or runs Mode 1 inline first — it is always self-sufficient.

## Architecture

```
Frontend (App Router, SSE consumer, progressive UI)
        │  SSE stream
API layer (Zod-validated routes → spawn agent → stream events)
        │
Orchestration Gateway   ← every external call flows through here
  retry · rate-limiter · circuit-breaker · timeout · token-ledger · trace
        │
Agent Runtime (ReAct loop, structured tool-calls, deterministic homepage bootstrap)
  tools: fetch_page · retrieve · analyze_page · synthesize_icp ·
         evaluate_fit · select_angles · draft_email · finish
  auto gate (not agent-callable): verify_claims inside draft_email
        │
Retrieval Layer (chunker · in-memory hybrid index: embeddings + BM25 · snippet store)
        │
Infrastructure (Jina scrape client · OpenAI client · TTL cache)

Cross-cutting: Guardrails (input/SSRF · injection screen · output schema/policy · grounding)
               Eval harness (offline replay against golden fixtures)
```

## Design decisions

- **Retrieval, not context-stuffing.** Reasoning and writing steps only see top-k retrieved snippets (each with `chunkId` + `sourceUrl`), never raw pages. Grounding, token savings, and mechanical claim verification all follow from this.
- **ReAct over a fixed pipeline.** The LLM decides what to research; the retrieval layer decides which snippets answer. Adapts to 404s and thin pages.
- **Structured tool-calls.** Each tool has a Zod-derived schema; the model returns a typed call. `thought` is required on every call so the trace shows reasoning.
- **One gateway for every external call.** LLM, embeddings, and scrapes share retry, timeout, rate-limit, circuit breaker, ledger, and trace.
- **Grounding is a gate.** `verify_claims` runs automatically inside `draft_email` (the agent cannot skip it). Unsupported claims are stripped before display.
- **Token efficiency, measured.** Model routing (`gpt-4o-mini` for orchestration/verify, `gpt-4o` for synthesis/drafting), context compression, embedding cache, and boilerplate stripping. The run-stats bar surfaces tokens, cost, and verified-claims ratio per run.
- **Jina Reader for scraping.** `https://r.jina.ai/{url}` → clean markdown, no extra infra.

## Token usage & limits

A full Mode 2 run targets ~25k tokens (60k hard budget). Every run streams a `meta` event with turns, LLM/scrape/embed counts, tokens, cost estimate, verified-claims ratio, and wall-clock — rendered in the run-stats bar. Hard ceilings: **180s** wall-clock and the token budget both force a graceful `finish` with partial-but-valid results.

## Evals

```bash
npm run eval
```

Replays golden cases (cached pages under `evals/golden/`) through the real agent runtime — deterministic offline scraping, real LLM reasoning + judge. Metrics: groundedness, ICP coverage, schema validity, angle distinctiveness, LLM-judge email rubric, and token/latency budget. Reports land in `evals/results/`.

<img width="684" height="414" alt="Screenshot 2026-06-04 at 7 06 06 AM" src="https://github.com/user-attachments/assets/63db1804-fc0c-49cf-87c6-5e16b5874336" />

## Project layout

| Path | Contents |
|---|---|
| `app/` | Next.js app and API routes |
| `components/`, `lib/hooks/` | UI and `useAgentStream` SSE hook |
| `lib/` | Agent runtime, gateway, retrieval, guardrails, infra, types |
| `lib/config.ts` | Model names and tunables |
| `evals/` | Golden fixtures and eval harness |
| `docs/demos/` | Demo screen recordings (`mode1.mp4`, Mode 2 pending) |

## Caveats

State (cache, retrieval index, rate-limiter/circuit-breaker counters, `SenderProfile` store) is **in-memory and single-process**. Run with `next start` (not edge/serverless) for cross-request reuse; restarting clears everything.

## Roadmap

- Redis-backed cache/index + persistent vector store (pgvector / Qdrant)
- Prompt A/B testing + larger eval set with trend tracking
- LinkedIn / news enrichment as additional grounded sources
- Multi-tenant rate limiting and per-tenant budgets
- Observability dashboard over trace spans
