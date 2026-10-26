// Minimal approval UI (skeleton). Local only. Payments are SIMULATED (no money moves).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { loadSnapshot } from "../../packages/rho/src/client.ts";
import { planRun } from "../../packages/planner/src/cashPlan.ts";
import { signApproval } from "../../packages/rails/src/approval.ts";
import { GateRefusal, guardedPay } from "../../packages/rails/src/guardedPay.ts";
import { SimulatedRail } from "../../packages/rails/src/SimulatedRail.ts";

const PORT = Number(process.env.PORT ?? 3000);
// The approval secret lives only in this human-facing process. If unset, a random one is generated per run (never printed).
const SECRET = process.env.APPROVAL_SECRET && process.env.APPROVAL_SECRET.length >= 16 ? process.env.APPROVAL_SECRET : randomBytes(32).toString("hex");
const snap = await loadSnapshot(process.env.FIXTURES_DIR ?? "fixtures/rho-sandbox-2026-10-26");
const run = planRun(snap, {
  asOf: process.env.AS_OF ?? "2026-08-27",
  sourceAccountId: process.env.SOURCE_ACCOUNT_ID ?? "30000000-0000-4000-8000-000000000006",
  cashFloorCents: Number(process.env.CASH_FLOOR_CENTS ?? 250000),
});
const rail = new SimulatedRail();
const log: string[] = [];
const vendor = new Map(snap.counterparties.map((c) => [c.id, c.legal_name]));
const usd = (c: number | null) => (c === null ? "-" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

async function page(): Promise<string> {
  const paid = new Set((await rail.list()).map((p) => p.billId));
  const rows = run.bills.map((b) => `<tr class="${b.decision}">
    <td>${b.decision === "pay" ? (paid.has(b.billId) ? "PAID (simulated)" : "PAY") : "HOLD"}</td>
    <td>${esc(b.invoiceNumber ?? b.billId)}</td><td>${esc(b.vendorId ? vendor.get(b.vendorId) ?? "?" : "(no vendor)")}</td>
    <td class="n">${usd(b.amountCents)}</td><td>${b.dueDate ?? "-"}</td>
    <td>${b.findings.map((f) => `<div class="${f.severity}">[${f.severity}] ${esc(f.message)}</div>`).join("")}</td>
    <td>${b.decision === "hold" ? `<form method="post" action="/agent-try"><input type="hidden" name="bill" value="${b.billId}"><button>Agent tries to pay</button></form>` : ""}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>PayRun Guard</title>
<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;vertical-align:top}
.pay td:first-child{color:#0a7a2f;font-weight:600}.hold td:first-child{color:#b00020;font-weight:600}.block{color:#b00020}.warn{color:#8a6d00}.n{text-align:right}
.banner{background:#fff4e5;border:1px solid #f0b400;padding:8px;margin:8px 0}</style>
<h1>PayRun Guard</h1>
<div class="banner">SIMULATED payments: Rho's public API is read-only; no money moves. Data: Rho public sandbox (fictional company).</div>
<p>Run <code>${run.runId}</code>, week ${run.asOf} to ${run.windowEnd}. Cash: start ${usd(run.cash.startCents)} - scheduled ${usd(run.cash.committedOutflowsCents)} - this run ${usd(run.cash.payCents)} = <b>${usd(run.cash.endCents)}</b> (floor ${usd(run.cash.floorCents)}).</p>
<form method="post" action="/approve"><button>Approve all ${run.bills.filter((b) => b.decision === "pay").length} safe bills (${usd(run.cash.payCents)})</button></form>
<table><tr><th>Decision</th><th>Bill</th><th>Vendor</th><th>Amount</th><th>Due</th><th>Pre-flight findings</th><th></th></tr>${rows}</table>
<h3>Run-level</h3>${run.runFindings.map((f) => `<div class="${f.severity}">[${f.severity}] ${esc(f.message)}</div>`).join("")}
<h3>Audit log</h3><pre>${esc(log.join("\n")) || "(empty)"}</pre>`;
}

const readBody = (req: import("node:http").IncomingMessage) => new Promise<URLSearchParams>((res) => {
  let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => res(new URLSearchParams(d)));
});

createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/approve") {
      // Human click: sign an approval per safe bill, then pay through the gate (idempotent: a second click pays nothing new).
      for (const b of run.bills.filter((x) => x.decision === "pay")) {
        const token = signApproval({ runId: run.runId, billId: b.billId, amountCents: b.amountCents!, currency: b.currency!, checkHash: b.checkHash,
          approver: "local-human", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }, SECRET);
        const before = new Set((await rail.list()).map((x) => x.paymentId));
        const p = await guardedPay(rail, { run, billId: b.billId, amountCents: b.amountCents!, approvalToken: token, counterparties: snap.counterparties }, SECRET);
        log.push(before.has(p.paymentId)
          ? `${new Date().toISOString()} ALREADY PAID, no new payment: ${b.invoiceNumber} (payment ${p.paymentId})`
          : `${new Date().toISOString()} APPROVED+PAID (simulated) ${b.invoiceNumber} ${usd(b.amountCents)} payment ${p.paymentId}`);
      }
      log.push(`${new Date().toISOString()} ledger now has ${(await rail.list()).length} simulated payments`);
    } else if (req.method === "POST" && req.url === "/agent-try") {
      // Agent path: no human token. The gate must refuse.
      const billId = (await readBody(req)).get("bill") ?? "";
      const b = run.bills.find((x) => x.billId === billId);
      try {
        await guardedPay(rail, { run, billId, amountCents: b?.amountCents ?? 0, approvalToken: undefined, counterparties: snap.counterparties }, SECRET);
        log.push(`${new Date().toISOString()} UNEXPECTED: agent payment went through`);
      } catch (e) {
        log.push(`${new Date().toISOString()} AGENT BLOCKED on ${b?.invoiceNumber ?? billId}: ${e instanceof GateRefusal ? `${e.reason}: ${e.message}` : String(e)}`);
      }
    }
    if (req.method === "POST") { res.writeHead(303, { Location: "/" }); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(await page());
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(PORT, () => console.log(`PayRun Guard UI on http://localhost:${PORT} (simulated payments)`));
