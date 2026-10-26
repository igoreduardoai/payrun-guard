// Print this week's payment run. Usage: tsx scripts/run-plan.ts [--as-of YYYY-MM-DD] [--account <id>] [--floor-cents N] [--live]
import { loadSnapshot, RhoClient } from "../packages/rho/src/client.ts";
import { planRun } from "../packages/planner/src/cashPlan.ts";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const live = process.argv.includes("--live");
const snap = live
  ? await new RhoClient({ baseUrl: process.env.RHO_API_BASE, token: process.env.RHO_API_TOKEN ?? "sandbox" }).snapshot()
  : await loadSnapshot(process.env.FIXTURES_DIR ?? "fixtures/rho-sandbox-2026-10-26");

// Defaults for the demo: Rho sandbox "Primary Checking" funds vendor ACH; week of 2026-08-27 in the sandbox timeline.
const run = planRun(snap, {
  asOf: arg("--as-of") ?? "2026-08-27",
  sourceAccountId: arg("--account") ?? "30000000-0000-4000-8000-000000000006",
  cashFloorCents: Number(arg("--floor-cents") ?? process.env.CASH_FLOOR_CENTS ?? 250000),
});
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const vendorName = new Map(snap.counterparties.map((c) => [c.id, c.legal_name]));

console.log(`PayRun Guard: ${run.runId}  window ${run.asOf}..${run.windowEnd}  (${live ? "LIVE Rho sandbox" : "fixtures"})`);
console.log(`Cash: start ${usd(run.cash.startCents)} - scheduled ${usd(run.cash.committedOutflowsCents)} - pay ${usd(run.cash.payCents)} = end ${usd(run.cash.endCents)} (floor ${usd(run.cash.floorCents)}; open invoices due, not counted: ${usd(run.cash.expectedInflowsCents)})`);
for (const b of run.bills) {
  const v = b.vendorId ? vendorName.get(b.vendorId) ?? "?" : "(no vendor)";
  console.log(`\n${b.decision === "pay" ? "PAY " : "HOLD"} ${b.invoiceNumber ?? b.billId}  ${b.amountCents === null ? "(no amount)" : usd(b.amountCents)}  due ${b.dueDate ?? "-"}  ${v}`);
  for (const f of b.findings) console.log(`     [${f.severity}] ${f.rule}: ${f.message}`);
}
if (run.runFindings.length) console.log("\nRun-level:");
for (const f of run.runFindings) console.log(`  [${f.severity}] ${f.rule}: ${f.message}`);
const pay = run.bills.filter((b) => b.decision === "pay").length;
console.log(`\nSummary: ${run.bills.length} bills in run, ${pay} pay, ${run.bills.length - pay} hold, ${run.runFindings.length} run-level findings.`);
