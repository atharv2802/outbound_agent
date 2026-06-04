# Setup & Usage Guide

This is everything you need to run the **Outbound Strategy Engine** locally. It's a Next.js app; the only thing it needs from you is an OpenAI API key.

---

## 1. Prerequisites

- **Node.js ≥ 18** (built and tested on Node v22). Check with `node -v`.
- **npm** (comes with Node). Check with `npm -v`.
- An **OpenAI API key** with access to `gpt-4o`, `gpt-4o-mini`, and `text-embedding-3-small`.
- Internet access at runtime (the agent scrapes pages via Jina Reader and calls OpenAI). Evals scrape from cached fixtures, but still call OpenAI.

---

## 2. Get an OpenAI API key

1. Go to <https://platform.openai.com/api-keys>.
2. Create a new secret key and copy it (starts with `sk-...`).
3. Make sure your account has some billing credit — a couple of runs cost only a few cents (see costs below), but a $0 balance will return 429/insufficient-quota errors.

---

## 3. Configure environment

From the project root (`/Users/atharv/outbound_agent`):

```bash
cp .env.example .env.local
```

Open `.env.local` and set your key:

```
OPENAI_API_KEY=sk-your-real-key-here
```

Optional tuning (defaults are fine; uncomment to override):

```
# TOKEN_BUDGET=60000        # per-run token budget before forced finish
# RUN_TIMEOUT_MS=180000     # hard wall-clock cap per run (ms)
```

> The app reads the key only from the environment. It never hardcodes or logs it. If the key is missing, API calls return a clear `503` with a helpful message instead of crashing.

---

## 4. Install & run

```bash
npm install
```

**Development** (hot reload):

```bash
npm run dev
```

Open <http://localhost:3000>.

**Production** (long-lived Node server — required, since state is in-memory):

```bash
npm run build
npm start
```

Other scripts: `npm run typecheck` (no-emit TS check), `npm run lint`.

---

## 5. Try it

On the homepage there are two tabs and one-click examples:

- **Mode 1 — Sender Analysis:** enter `artisan.co` (or click the example). The agent explores the site and produces a value proposition + ICP with evidence dots showing provenance.
- **Mode 2 — Target Outbound:** sender `artisan.co`, target `ramp.com`, recipient e.g. `VP of Sales` / `Executive`. You'll get a fit scorecard, two distinct-angle emails, and a verified claim map. Click a highlighted claim in an email to jump to its evidence (and vice versa).

The left pane streams the agent's live reasoning (thoughts, retrievals, guardrail events); the right pane fills in as results arrive. A run-stats bar shows tokens, cost, verified-claims ratio, and wall-clock when it finishes.

---

## 6. Run the evals

```bash
npm run eval
```

This replays golden cases (`evals/golden/artisan.co.json`, `ramp.com.json`) through the real agent runtime with **offline cached scraping**, then scores groundedness, ICP coverage, schema validity, angle distinctiveness, an LLM-judge email rubric, and token/latency budget. It prints a pass/fail table and writes a JSON report to `evals/results/`. It needs `OPENAI_API_KEY` set (reasoning + judge are real calls); it exits with a clear message if the key is missing.

---

## 7. Costs, limits & caveats

- **Cost:** a Mode 2 run is typically well under ~25k tokens (target budget is 50k). With the pinned models that's roughly **a few US cents per run**. The exact figure (using the price table in `lib/config.ts`) is shown in the run-stats bar.
- **Time cap:** a run is hard-capped at **180 seconds** wall-clock. If it approaches the cap or the token budget, the agent is forced to `finish` gracefully with partial-but-valid results.
- **Jina Reader:** scraping uses the free `https://r.jina.ai/{url}` endpoint. It can be rate-limited or occasionally slow/unavailable; the gateway retries, times out (15s), and trips a circuit breaker, after which the agent works with whatever it already indexed.
- **In-memory state (single process):** the cache, retrieval index, rate-limiter/circuit-breaker counters, and the `SenderProfile` store all live in memory. This is intentional ("local is fine") but means you must run a **single long-lived process** (`next start`, not edge/serverless) for cross-request reuse. Restarting clears everything.
- **Domain scoping / SSRF:** the agent may only fetch within the target's registrable domain, and private/loopback/internal hosts and non-standard ports are blocked. If you try an internal URL it's rejected before any fetch.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `503 OPENAI_API_KEY is not set` | Add the key to `.env.local` and restart the server. |
| `429` / "insufficient_quota" | Add billing credit to your OpenAI account; the rate limiter also throttles to 30 LLM calls/min. |
| Run ends with thin/empty results | The target site may be JS-heavy or blocked by Jina; try a different page or domain. The agent reports low confidence honestly rather than fabricating. |
| "scraping unavailable" in the trace | Jina's circuit breaker opened after repeated failures; wait ~30s and retry, or the agent will synthesize from what it indexed. |
| Emails have fewer claims than expected | Unsupported claims are stripped by the grounding gate and listed in the claim map's "stripped" section — this is the safety feature working. |
| `EMFILE: too many open files` in dev | OS file-watch limit; raise it (`ulimit -n 4096`) or just use `npm run build && npm start`. |
| Port 3000 in use | `PORT=3001 npm run dev`. |

---

## 9. Where things live

- App + API routes: `app/`
- Agent, gateway, retrieval, guardrails, infra, types: `lib/`
- UI components + the `useAgentStream` hook: `components/`, `lib/hooks/`
- Model names & all tunables: `lib/config.ts`
- Evals: `evals/`
