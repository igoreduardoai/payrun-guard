// Run the PayRun Guard agent loop on the Rho sandbox fixtures (or --live sandbox).
// Usage: tsx scripts/agent-run.ts [--planner rules|llm] [--human ask|approve|deny] [--live] [--json]
//   --planner llm uses LLM_PROVIDER (groq|openrouter) + key from env; falls back to rules if not configured.
//   --human ask (default when interactive) prompts you per bill; approve/deny are scripted humans for demos.
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { loadSnapshot, RhoClient } from "../packages/rho/src/client.ts";
import { planRun } from "../packages/planner/src/cashPlan.ts";
import { MemoryStore } from "../packages/store/src/MemoryStore.ts";
import { PayRunService } from "../packages/store/src/PayRunService.ts";
import { runAgent } from "../packages/agent/src/loop.ts";
import { plannerFromEnv, RulePlanner } from "../packages/agent/src/planners.ts";
import { ApproveAll, DenyAll, type ApprovalRequest, type HumanApprover } from "../packages/agent/src/toolbox.ts";
import { naiveAgentBaseline } from "../packages/agent/src/baseline.ts";
try { process.loadEnvFile(); } catch { /* no .env */ }

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

class AskHuman implements HumanApprover {
  readonly name = "cli-human";
  async review(reqs: ApprovalRequest[]) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const out: Record<string, boolean> = {};
    for (const r of reqs) out[r.billId] = /^y(es)?$/i.test((await rl.question(`Approve ${r.invoiceNumber ?? r.billId} ${usd(r.amountCents)} (SIMULATED)? [y/N] `)).trim());
    rl.close();
    return out;
  }
}

const snap = process.argv.includes("--live")
  ? await new RhoClient({ baseUrl: process.env.RHO_API_BASE, token: process.env.RHO_API_TOKEN ?? "sandbox" }).snapshot()
  : await loadSnapshot(process.env.FIXTURES_DIR ?? "fixtures/rho-sandbox-2026-10-26");
const run = planRun(snap, { asOf: arg("--as-of") ?? "2026-08-27", sourceAccountId: arg("--account") ?? "30000000-0000-4000-8000-000000000006",
  cashFloorCents: Number(arg("--floor-cents") ?? process.env.CASH_FLOOR_CENTS ?? 250000) });
const svc = new PayRunService(new MemoryStore(), randomBytes(32).toString("hex"), snap.counterparties);
await svc.recordRun(run, process.argv.includes("--live") ? "rho_sandbox" : "fixtures");

const wantLlm = (arg("--planner") ?? (process.env.LLM_PROVIDER ? "llm" : "rules")) === "llm";
const { planner, note } = wantLlm ? plannerFromEnv(process.env) : { planner: new RulePlanner(), note: "rule planner (--planner rules)" };
const humanMode = arg("--human") ?? (process.stdin.isTTY ? "ask" : "approve");
const human = humanMode === "ask" ? new AskHuman() : humanMode === "deny" ? new DenyAll() : new ApproveAll();

const report = await runAgent(run, svc, planner, human);
const base = naiveAgentBaseline(run);
if (process.argv.includes("--json")) { console.log(JSON.stringify({ note, report, baseline: base }, null, 2)); process.exit(0); }

console.log(`PayRun Guard agent · planner: ${note} · human: ${humanMode} · payments SIMULATED\n`);
for (const s of report.trace) {
  const r = s.result as Record<string, unknown>;
  const brief = s.tool === "pay" ? (r.ok ? `paid ${r.paymentId} ${usd(Number(r.amountCents))}` : `REFUSED by ${r.by ?? "gate"}: ${r.reason}`)
    : s.tool === "get_run" ? `${(r.bills as unknown[])?.length ?? 0} bills` : s.tool === "preflight_payment" ? `${(r.results as unknown[])?.length ?? 0} checked`
    : s.tool === "request_approval" ? JSON.stringify(r.decisions) : JSON.stringify(r).slice(0, 120);
  console.log(`turn ${s.turn}  ${s.tool}(${JSON.stringify(s.args).slice(0, 80)})  verify:${s.preVerify}${s.postVerify ? ` post:${s.postVerify}` : ""}  -> ${brief}`);
}
console.log(`\nStatus: ${report.status}${report.error ? ` (${report.error})` : ""} · turns ${report.turns}`);
if (report.approvedUnpaid.length) console.log(`WARNING: approved by the human but not paid: ${report.approvedUnpaid.join(", ")}`);
console.log(`Summary [${report.summarySource}]: ${report.summary}`);
if (report.summaryRejected) console.log(`Rejected planner summary (invented numbers): ${report.summaryRejected.join(", ")}`);
console.log(`\nBaseline without the gate: a naive agent would make ${base.naivePayments} payments, ${base.naiveImproper} of them improper (${usd(base.naiveImproperCents)}). With PayRun Guard: ${report.paid.length} paid, ${report.paid.filter((p) => run.bills.find((b) => b.billId === p.billId)?.decision !== "pay").length} improper.`);
