// Minimal approval UI (skeleton). Local only. Payments are SIMULATED (no money moves).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { loadSnapshot } from "../../packages/rho/src/client.ts";
import { planRun } from "../../packages/planner/src/cashPlan.ts";
import { GateRefusal } from "../../packages/rails/src/guardedPay.ts";
import { storeFromEnvWithFallback } from "../../packages/store/src/index.ts";
import { PayRunService } from "../../packages/store/src/PayRunService.ts";

try { process.loadEnvFile(); } catch { /* no .env: offline defaults */ }
const PORT = Number(process.env.PORT ?? 3000);
// The approval secret lives only in this human-facing process. If unset, a random one is generated per run (never printed).
const SECRET = process.env.APPROVAL_SECRET && process.env.APPROVAL_SECRET.length >= 16 ? process.env.APPROVAL_SECRET : randomBytes(32).toString("hex");
const snap = await loadSnapshot(process.env.FIXTURES_DIR ?? "fixtures/rho-sandbox-2026-10-26");
const run = planRun(snap, {
  asOf: process.env.AS_OF ?? "2026-08-27",
  sourceAccountId: process.env.SOURCE_ACCOUNT_ID ?? "30000000-0000-4000-8000-000000000006",
  cashFloorCents: Number(process.env.CASH_FLOOR_CENTS ?? 250000),
});
const { store, note } = await storeFromEnvWithFallback();
const svc = new PayRunService(store, SECRET, snap.counterparties);
await svc.recordRun(run, "fixtures");
const rail = svc.rail;
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
<h3>Audit log (${store.kind})</h3><pre>${esc((await store.listAudit(run.runId)).map((a) => `${a.createdAt} ${a.actor} ${a.event} ${a.billId ? run.bills.find((x) => x.billId === a.billId)?.invoiceNumber ?? a.billId : ""} ${JSON.stringify(a.detail)}`).join("\n")) || "(empty)"}</pre>`;
}

const readBody = (req: import("node:http").IncomingMessage) => new Promise<URLSearchParams>((res) => {
  let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => res(new URLSearchParams(d)));
});

createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/approve") {
      // Human click: approve each safe bill (token hash stored), then pay through the gate. A second click creates no new payment.
      for (const b of run.bills.filter((x) => x.decision === "pay")) {
        const token = await svc.approve(run, b.billId, "local-human");
        await svc.pay(run, b.billId, b.amountCents!, token, "human:local-human");
      }
    } else if (req.method === "POST" && req.url === "/agent-try") {
      // Agent path: no human token. The gate must refuse (refusal is written to the audit log).
      const billId = (await readBody(req)).get("bill") ?? "";
      const b = run.bills.find((x) => x.billId === billId);
      await svc.pay(run, billId, b?.amountCents ?? 0, undefined, "agent").catch((e) => { if (!(e instanceof GateRefusal)) throw e; });
    }
    if (req.method === "POST") { res.writeHead(303, { Location: "/" }); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(await page());
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(PORT, () => console.log(`PayRun Guard UI on http://localhost:${PORT} (simulated payments; store: ${note})`));
