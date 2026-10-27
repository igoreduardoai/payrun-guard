# PayRun Guard

**The safety check every AI agent must pass before paying bills on Rho.**

Built for the AITX & MLOps World Community Hackathon (Austin Tech Week, Oct 26–30, 2026), Rho + Agents tracks.
**All code in this repository was written during the hackathon week (first commit Oct 26, 2026).** Engine dependencies are limited to `typescript`, `tsx` and `@types/node`; the web dashboard uses Next.js 16.4.0 and its usual UI libraries. Every resolved npm package was published at least two weeks before kickoff (Oct 12, 2026 or earlier). See "Dependency age" below.

## What it is, who it's for, what it does
PayRun Guard is for finance leads at small companies that bank on Rho and want an AI agent to help with the weekly vendor payment run. It reads bills, vendors, balances and scheduled payments from the Rho API, runs deterministic pre-flight checks on every bill, and plans a week of payments that never goes below a cash floor you set. An agent can only pay a bill that passed the checks **and** carries a human approval token for that exact bill, amount and check result.

## Honest status
- **Payments are SIMULATED.** Rho's public API is read-only by design. Rho offers hackathon participants early access to a payments SDK; until that is connected, the `SimulatedRail` records payment intents and moves no money. `RhoSdkRail` is a placeholder that refuses to run.
- **Data is Rho's public sandbox** (`https://rhoapi-sandbox.rho.co/api/v1`, a fictional company, any non-empty bearer token). A snapshot is in `fixtures/rho-sandbox-2026-10-26/`.
- **No LLM is in the money path.** Checks, amounts, and pay/hold decisions are deterministic code. The optional LLM planner only chooses which tool to call next and writes the closing summary; `verifyText()` rejects any summary containing a dollar amount or bill number that isn't in the findings or the verified report.
- **Agent loop: real, two planners.** `npm run agent` runs plan → tool call → verify → act, with a human approval step. The default planner is deterministic rules (no LLM, no network). With `LLM_PROVIDER=groq` (free tier, `openai/gpt-oss-20b`) or `openrouter` (`:free` model), an LLM drives the same tools. The public web demo does not call an LLM.

## What the checks catch on Rho's own sandbox data (week of 2026-08-27, Primary Checking, $2,500 floor)
`npm run run:plan` → 13 bills in the run: **3 pay ($896.50), 10 held**, plus 2 run-level warnings. Examples:
- BILL-2026-0013 ($75.00) is scheduled to Initech Consulting LLC, a vendor that is only "invited", with **no payment method and no W-9**.
- BILL-2026-0012 ($1,200.50) already has a scheduled domestic wire, so paying it again in this run **would pay twice**.
- BILL-2026-0015 / -0021 go to Vandelay Industries, vendor "incomplete", **no W-9**.
- BILL-2026-0020 ($1,580.00) has **no payee**; an untitled draft has no amount, due date or invoice number.
- BILL-2026-0006 / -0007: **last payment failed**; retry blocked until bank details are confirmed.
- Acme Supplies LLC has **two active monthly ACH schedules** ($4,500.00 + $750.00): flagged to confirm both are intended.
- Cash: $8,119.70 start − $4,500.00 already scheduled − $896.50 this run = $2,723.20, above the $2,500.00 floor.
These are flagged for human review. They are not claims that Rho's product is wrong.

## Checks (packages/preflight)
Block: bill incomplete, invalid amount, unrecognized status, no vendor / unknown vendor, vendor not active (invited / incomplete / archived), no payment method, no W-9 for US vendors, lines ≠ total, mixed currencies, same invoice number from the same vendor, last payment failed, already paid by a scheduled transaction, cash floor.
Warn: past due (exact days), W-9 requested but pending, scheduled without a payment date, same vendor + same amount within 30 days, vendor also paid by recurring schedules, two or more recurring schedules to one vendor, failed scheduled payment.
Each finding cites Rho object ids and field values as evidence.

## The gate (packages/rails/src/guardedPay.ts)
`guardedPay()` is the only way to move money. It refuses unless all of these hold:
1. The bill is in this run, passed pre-flight, and the planner decided "pay" (not held by the cash floor).
2. The requested amount equals the checked amount.
3. A human approval token (HMAC, signed only by the human-facing approval process; the agent never holds the secret) matches this run, bill, amount, currency and `checkHash`, and hasn't expired.
Payments are idempotent: the same key, or the same bill in the same run, returns the existing payment. A double click pays once.

## Agent loop (packages/agent) — Agents track
`npm run agent -- [--planner rules|llm] [--human ask|approve|deny] [--live]`

Each turn: the **planner** proposes tool calls → the **loop validates and verifies** them → the **toolbox acts** on the real engine → the loop **verifies the result** → the observation goes back to the planner. Tools: `get_run`, `preflight_payment`, `request_approval`, `pay` (`packages/agent/src/tools.ts`, OpenAI-style JSON Schema).
- **Planners** (`planners.ts`): `RulePlanner` (deterministic; default) and `LlmPlanner` (any OpenAI-compatible chat-completions endpoint with function calling; Groq free tier by default, OpenRouter `:free` as an option; retries 429 and unparseable tool calls; sees a compact view to fit free-tier token limits).
- **Human approval gate**: `request_approval` asks a `HumanApprover` (CLI prompt, or scripted approve/deny for demos). Signed approval tokens stay inside the toolbox; the planner (and the LLM) never sees a token or the secret. In this demo the approval service runs in the same process; in production it would be a separate service.
- **Loop verification** (`loop.ts`), before acting: unknown tools and malformed arguments are rejected; `pay` is refused unless this session pre-flighted the bill, it passed, the amount equals the checked amount, and a human approved it. After acting: the ledger must hold exactly that payment. On finish, a completion check tells the planner once about human-approved bills it has not paid.
- **The gate still decides** (`guardedPay` via `PayRunService`): with loop verification switched off, a scripted adversarial planner is still refused (`preflight_failed`, `no_approval`) and the refusals are audited.
- **Baseline** (`baseline.ts`): on the sandbox week, a naive agent with no gate would make 12 payments, 9 of them improper ($7,070.00). The guarded agent makes 3 payments ($896.50), 0 improper.
- Live check (Oct 27, 2026, Groq free tier, `openai/gpt-oss-20b`): the LLM read the run, pre-flighted all 13 bills, requested approval for the 3 passing bills, first tried to finish without paying, was told by the completion check, then paid the 3 approved bills; its summary passed `verifyText`. About 60 s, mostly free-tier rate-limit waits (8k tokens/min). The run is not deterministic; the safety outcome is enforced by code either way.

## Storage (Supabase, with offline fallback)
When `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are set and Supabase answers, the app persists to Supabase over HTTPS; otherwise (or with `STORE=memory`) it runs fully offline from fixtures (Hack Fair fallback):
- `payrun_runs`, `payrun_bill_checks` (pass/hold, reasons, findings, check hash), `payrun_approvals` (**SHA-256 of the token only**), `payrun_payments` (`idempotency_key` unique **and** one payment per bill per run), `payrun_audit_log` (append-only; refusals are logged too).
- Row-level security is on for every table. The public/anon key gets no grants; the server writes with the secret key; signed-in users can only read rows for their org.
- Schema: `supabase/migrations/`. Apply with `npm run db:apply` (Management API over HTTPS), the dashboard SQL editor, or `supabase db push`.
- Every payment call re-checks the persisted bill check; a run object that was altered after planning is refused.
- Live verification (`npm run db:verify`, 2026-10-26): 27/27 checks passed on the live project: tables exist; the publishable key is denied read and write (42501); a second payment for the same bill/run and a reused idempotency key are rejected (23505); zero amounts and `pay` without `pass` are rejected (23514); payments/approvals for unchecked bills are rejected (23503); UPDATE/DELETE on the audit log and payments are refused (P0001 append-only trigger); approvals hold only 64-hex SHA-256 hashes.
- Open item: `supabase/migrations/20261026230000_harden_privileges.sql` (proposed, not yet applied) removes extra privileges the service role inherits from Supabase defaults and blocks TRUNCATE on the audit log and payments. `supabase/verify/verify_schema.sql` is a read-only query set for the SQL editor (RLS flags, policies, triggers, grants).

## Quick start
```bash
npm install
npm test                 # unit tests (node:test)
npm run typecheck
npm run run:plan         # plan from fixtures; add -- --live to read the Rho sandbox
npm run agent            # agent loop, rule planner; add -- --planner llm with LLM_PROVIDER=groq + GROQ_API_KEY (free tier)
npm run fixtures         # refresh fixtures from the Rho sandbox
npm run web              # older minimal Node UI (apps/web) on http://localhost:3000
cd web && npm install && npm run dev   # main Next.js dashboard on http://localhost:3000
npm run db:apply         # apply SQL migrations (needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF)
npm run db:smoke         # live Supabase round trip (needs SUPABASE_URL + SUPABASE_SECRET_KEY)
npm run db:verify        # live schema/RLS/constraint checks (also needs SUPABASE_PUBLISHABLE_KEY)
```
Copy `.env.example` to `.env` for options. Never commit real tokens.

## Web dashboard (web/)

Next.js 16 App Router + Tailwind. The layout was first generated with v0.app this week, then every number was wired to the real engine. There is no mock data.

- `web/lib/server/engine.ts` (server-only) loads the Rho sandbox snapshot from `fixtures/`, runs `planRun`, and records the run through `PayRunService`.
- API routes: `GET /api/run`, `GET /api/audit`, `POST /api/approve` (human approves the safe bills, then simulated pay with signed tokens; a repeat returns the existing payments), and `POST /api/agent-pay {billId}` (an agent pays with no token and gets 403 plus the gate's reason: `preflight_failed`, `held_by_plan`, `no_approval`, ...).
- Every payment is **SIMULATED** (amber badge). No money moves.
- Store: in-memory (offline fixtures) unless `SUPABASE_URL` and a server-side secret key are set. `STORE=memory` forces offline. In memory mode the state is per server instance and resets on cold start.
- The Supabase secret key is only ever read server-side. Never prefix it with `NEXT_PUBLIC_`.

### Deploy to Vercel (public demo = offline fixtures)
1. Import `igoreduardoai/payrun-guard`, then set **Root Directory** to `web`. Keep "Include files outside the root directory" on, because the UI imports `../packages` and `../fixtures`.
2. Framework: Next.js (auto). Install: `npm install`. Build: `next build`. Node 20.x or later.
3. Env: `STORE=memory` (recommended) and optionally `APPROVAL_SECRET` (random string). Do **not** set Supabase keys on the public deployment.

## Dependency age (hackathon rule: public OSS packages at least 2 weeks old at kickoff, Oct 26)
All 145 packages resolved in `package-lock.json` and `web/package-lock.json` were checked against the npm registry publish dates (Oct 27, 2026). The only ones newer than Oct 12 were `next` 16.4.1 and its `@next/*` binaries (published Oct 14), so `next` is pinned to **16.4.0** (published Oct 6).
Tradeoff: 16.4.1 is a security release (critical RCE in `use cache` functions returning typed arrays, critical RCE in the Image Optimization API with SVG, high DoS with Server Actions). This app uses none of those paths: no `use cache`, `images.unoptimized: true`, no Server Actions. The public demo holds only Rho's fictional sandbox data, no secrets, and simulated payments. After judging, upgrade to the latest patched Next.js.

## Architecture
```
Rho API (sandbox, read-only) ──> packages/rho (client + pagination) ──> snapshot
snapshot ──> packages/preflight (deterministic rules, evidence) ──> packages/planner (week window, cash floor)
agent loop (rules | free LLM) ──(tools: get_run, preflight_payment, request_approval, pay; loop verify)──> packages/rails/guardedPay
human ──(approve in web/; signs token)──────────────────────────────> guardedPay ──> PaymentRail
PaymentRail = SimulatedRail (today) | RhoSdkRail (when Rho early-access SDK is connected)
```

## Prior art (credit where due)
Rho Bill Pay already runs duplicate checks, approval routing and flags missing vendor payment details; Ramp, BILL and Brex ship AP agents with duplicate/fraud detection and W-9 collection. PayRun Guard does not claim those products lack these checks. It shows a pattern on Rho's open API: an **agent-callable gate** that money movement must pass, plus a **cross-object weekly plan** (bills + scheduled payments + balance + cash floor).

## Known limitations / next steps
- Simulated rail only; connect Rho early-access SDK if access is granted.
- Hardening migration (privileges + TRUNCATE guard) proposed, not applied.
- The web dashboard does not run the agent loop yet (CLI only); MCP server planned.
- LLM planner runs are rate-limited on free tiers and can vary run to run; tests use a mocked endpoint (the live test is opt-in: `RUN_LIVE_LLM=1`).
- Expected inflows from open invoices are reported but not counted (conservative).
- W-9 rule skips non-US vendors (W-8 forms are not visible in the API).

## License
MIT. Author: Igor Eduardo.
