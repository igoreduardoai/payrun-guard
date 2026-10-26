# Progress
## Mon 26/10 (night 1)
Done: scaffold, MIT, Rho sandbox client + pagination, fixtures (24 bills, 7 vendors, 14 accounts, 5 scheduled, 12 invoices), 22 pre-flight finding types, weekly cash planner with floor, approval tokens (HMAC), guardedPay gate, SimulatedRail (idempotent), template explainer + verifyText, CLI run:plan, approval UI skeleton, tests.
## Mon 26/10 (night 1, part 2)
Done: Supabase schema migration (5 tables, RLS on, anon no access, token hashes, append-only audit/payments, unique idempotency), Store interface with MemoryStore (offline) + SupabaseStore (Data API), PayRunService (persist run/checks/approvals/payments/audit, refusals audited, persisted-check cross-check), UI wired to the service, migration/smoke scripts.
Live (17:0x CT): migration applied by hand in SQL editor; db:smoke OK (created=true, replay created=false, 1 payment, 4 audit rows); db:verify 27/27. App now defaults to Supabase when configured, offline fallback kept.
Pending: apply 20261026230000_harden_privileges.sql after review; run supabase/verify/verify_schema.sql in SQL editor to confirm RLS flags/policies.
## Mon 26/10 (night 1, part 3)
Done: v0-generated dashboard moved into web/ and wired to the real engine (13 bills, 3 safe $896.50, 10 held with Rho record ids, 2 run-level warnings, cash $2,723.20 vs $2,500 floor). API routes call PayRunService: approve (idempotent replays), agent-pay refused with real gate reasons, live audit log. Simulated badge kept. next 16.4.1 (patched for GHSA-2464-fhr4-w9xw / GHSA-p3m5-59mp-jv5r / GHSA-673q-mjm6-r5xr).
## Next (Tue/Wed)
- Agent loop with a free-tier LLM via tool calls (get_run, preflight_payment, request_approval, pay), scripted fallback
- MCP server exposing the gate
- RhoSdkRail if early access arrives
- UI polish: cash line chart, evidence drawer, vendor email draft
- Thu: README final, Loom, submission (Igor's OK)
