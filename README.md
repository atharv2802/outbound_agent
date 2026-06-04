# Outbound Strategy Engine

> An agentic web app that turns a company's public footprint into grounded outbound sales strategy. A ReAct agent researches the web in real time, retrieves **snippets (not whole pages)**, and writes emails where **every claim is bound to verified evidence**.

## Quick start

```bash
npm install
cp .env.example .env.local        # then add your OPENAI_API_KEY
npm run dev                        # http://localhost:3000
```

Production:

```bash
npm run build && npm start
```

Evals:

```bash
npm run eval
```

See [`instruction.md`](./instruction.md) for the full, friendly setup guide (getting a key, example inputs, costs, caveats, troubleshooting).

## Two modes

1. **Sender Analysis** — point it at a company site (`artisan.co`). The agent explores, retrieves evidence, and infers a value proposition + ICP with per-dimension provenance. The result is a `SenderProfile`, persisted by domain.
2. **Target Outbound** — `artisan.co → ramp.com`. The agent researches the target against the sender's ICP, scores fit per dimension, selects two **distinct-type** angles, drafts two emails, and assembles a **verified claim map**. Mode 2 reuses a cached `SenderProfile` or runs Mode 1 inline first — it's always self-sufficient.

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

- **Retrieval, not context-stuffing (load-bearing).** Reasoning/writing LLM steps only ever see top-k retrieved snippets (each carrying `chunkId` + `sourceUrl`), never a raw page. This one decision delivers snippet grounding, the biggest token saving, and a claim map that can be *mechanically verified* rather than decorated.
- **ReAct over a fixed pipeline.** The LLM decides what to research (URLs + retrieval queries); the retrieval layer decides which snippets answer it. Adapts to 404s and thin pages.
- **Structured tool-calls, not hand-parsed JSON.** Each tool has a Zod-derived schema; the model returns a typed call. Removes the "bad agent JSON" failure class. `thought` is required on every call so the trace shows reasoning.
- **One gateway for every external call.** LLM, embeddings, and scrapes share retry/timeout/rate-limit/circuit/ledger/trace. Embedding tokens are ledgered too, so indexing cost is never invisible.
- **Grounding is a gate, not a suggestion.** `verify_claims` runs automatically inside `draft_email`'s output path (the agent can't skip it). Unsupported claims are stripped before display and listed transparently.
- **Token efficiency, measured.** Retrieval + model routing (`gpt-4o-mini` for orchestration/verify, `gpt-4o` for synthesis/drafting) + context compression (old turns collapse to one line) + embedding cache + boilerplate stripping. The run-stats bar makes the savings legible.
- **Jina Reader for scraping.** `https://r.jina.ai/{url}` → clean markdown, zero infra, no key.

## Token usage & run stats

Model routing and retrieval keep a full Mode 2 run well under the 50k-token budget (target ~25k). Every run streams a `meta` event with turns, LLM calls, scrapes, embed calls, tokens (and a cost estimate from `lib/config.ts` pricing), verified-claims ratio, and wall-clock — rendered in the run-stats bar. Hard ceilings: **180s** wall-clock and the token budget both force a graceful `finish` with partial-but-valid results.

## Evals

`npm run eval` replays golden cases (cached pages under `evals/golden/`) through the **real** agent runtime — deterministic, offline scraping; real LLM reasoning + judge. Metrics: groundedness (no ungrounded claim shipped), ICP coverage, schema validity, angle distinctiveness, LLM-judge email rubric (personalization/specificity/CTA/length), and token/latency budget. Regression thresholds gate the suite (groundedness honest-100%, schema valid, avg rubric ≥ 4.0, within budget).

## Honesty caveat

State (cache, retrieval index, rate-limiter/circuit-breaker counters, `SenderProfile` store) is **in-memory and assumes a single long-lived process** — exactly the "local is fine" model in the brief. Run with `next start` (not edge). Horizontal scaling would move these to shared infra (see below).

## What I'd add next

- Redis-backed cache/index + a persistent vector store (pgvector / Qdrant).
- Prompt A/B testing + a larger eval set with trend tracking.
- LinkedIn / news enrichment as additional grounded sources.
- Multi-tenant rate limiting and per-tenant budgets.
- An observability dashboard over the trace spans.
