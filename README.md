# PayRun Guard

**The safety check every AI agent must pass before paying bills on Rho.**

Built for the AITX & MLOps World Community Hackathon (Austin Tech Week, Oct 26–30, 2026), Rho + Agents tracks.
**All code in this repository was written during the hackathon week (first commit Oct 26, 2026).** Open-source dependencies are limited to `typescript`, `tsx` and `@types/node` (all published more than two weeks before the event).

## What it is, who it's for, what it does
PayRun Guard is for finance leads at small companies that bank on Rho and want an AI agent to help with the weekly vendor payment run. It reads bills, vendors, balances and scheduled payments from the Rho API, runs deterministic pre-flight checks on every bill, and plans a week of payments that never goes below a cash floor you set. An agent can only pay a bill that passed the checks **and** carries a human approval token for that exact bill, amount and check result.

## Honest status
- **Payments are SIMULATED.** Rho's public API is read-only by design. Rho offers hackathon participants early access to a payments SDK; until that is connected, the `SimulatedRail` records payment intents and moves no money. `RhoSdkRail` is a placeholder that refuses to run.
- **Data is Rho's public sandbox** (`https://rhoapi-sandbox.rho.co/api/v1`, a fictional company, any non-empty bearer token). A snapshot is in `fixtures/rho-sandbox-2026-10-26/`.
- **No LLM is in the money path.** Checks, amounts, and pay/hold decisions are deterministic code. An LLM may only rephrase explanations; `verifyText()` rejects any text containing a dollar amount or bill number that isn't in the underlying finding. (LLM integration not wired yet.)

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

## Storage (Supabase, with offline fallback)
`STORE=memory` (default) keeps everything in process, so the Hack Fair demo works offline from fixtures. `STORE=supabase` persists to Supabase over HTTPS:
- `payrun_runs`, `payrun_bill_checks` (pass/hold, reasons, findings, check hash), `payrun_approvals` (**SHA-256 of the token only**), `payrun_payments` (`idempotency_key` unique **and** one payment per bill per run), `payrun_audit_log` (append-only; refusals are logged too).
- Row-level security is on for every table. The public/anon key gets no grants; the server writes with the secret key; signed-in users can only read rows for their org.
- Schema: `supabase/migrations/`. Apply with `npm run db:apply` (Management API over HTTPS), the dashboard SQL editor, or `supabase db push`.
- Every payment call re-checks the persisted bill check; a run object that was altered after planning is refused.

## Quick start
```bash
npm install
npm test                 # unit tests (node:test)
npm run typecheck
npm run run:plan         # plan from fixtures; add -- --live to read the Rho sandbox
npm run fixtures         # refresh fixtures from the Rho sandbox
npm run web              # approval UI skeleton on http://localhost:3000 (simulated payments)
npm run db:apply         # apply SQL migrations (needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF)
npm run db:smoke         # live Supabase check (needs STORE=supabase + SUPABASE_SECRET_KEY)
```
Copy `.env.example` to `.env` for options. Never commit real tokens.

## Architecture
```
Rho API (sandbox, read-only) ──> packages/rho (client + pagination) ──> snapshot
snapshot ──> packages/preflight (deterministic rules, evidence) ──> packages/planner (week window, cash floor)
agent ──(tools: get_run, preflight_payment, request_approval, pay)──> packages/rails/guardedPay
human ──(approve in apps/web; signs token)──────────────────────────> guardedPay ──> PaymentRail
PaymentRail = SimulatedRail (today) | RhoSdkRail (when Rho early-access SDK is connected)
```

## Prior art (credit where due)
Rho Bill Pay already runs duplicate checks, approval routing and flags missing vendor payment details; Ramp, BILL and Brex ship AP agents with duplicate/fraud detection and W-9 collection. PayRun Guard does not claim those products lack these checks. It shows a pattern on Rho's open API: an **agent-callable gate** that money movement must pass, plus a **cross-object weekly plan** (bills + scheduled payments + balance + cash floor).

## Known limitations / next steps
- Simulated rail only; connect Rho early-access SDK if access is granted.
- Supabase persistence is implemented and unit-tested against a fake Data API; live run pending migration + server key.
- LLM explainer and agent loop not wired yet; MCP server planned.
- Expected inflows from open invoices are reported but not counted (conservative).
- W-9 rule skips non-US vendors (W-8 forms are not visible in the API).

## License
MIT. Author: Igor Eduardo.
