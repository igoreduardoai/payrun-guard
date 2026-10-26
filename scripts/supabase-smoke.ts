// Live check against Supabase (after migrations are applied): STORE=supabase SUPABASE_URL=... SUPABASE_SECRET_KEY=... APPROVAL_SECRET=...
import { loadSnapshot } from "../packages/rho/src/client.ts";
import { planRun } from "../packages/planner/src/cashPlan.ts";
import { storeFromEnv } from "../packages/store/src/index.ts";
import { PayRunService } from "../packages/store/src/PayRunService.ts";
try { process.loadEnvFile(); } catch { /* no .env */ }

const { store, note } = storeFromEnv();
if (store.kind !== "supabase") { console.error(`not using supabase: ${note}`); process.exit(1); }
const secret = process.env.APPROVAL_SECRET ?? "";
const snap = await loadSnapshot("fixtures/rho-sandbox-2026-10-26");
const run = planRun(snap, { asOf: "2026-08-27", sourceAccountId: "30000000-0000-4000-8000-000000000006", cashFloorCents: 250_000 });
const svc = new PayRunService(store, secret, snap.counterparties);
await svc.recordRun(run, "fixtures");
const b = run.bills.find((x) => x.decision === "pay")!;
const token = await svc.approve(run, b.billId, "smoke-test");
const a = await svc.pay(run, b.billId, b.amountCents!, token);
const c = await svc.pay(run, b.billId, b.amountCents!, token);
console.log(`run ${run.runId}: payment ${a.record.paymentId} created=${a.created}, replay created=${c.created}, payments in run=${(await store.listPayments(run.runId)).length}, audit rows=${(await store.listAudit(run.runId)).length}`);
