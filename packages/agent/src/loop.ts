// The agent loop: plan -> validate & verify -> act (tool call) -> verify result -> repeat -> report.
// Two independent safety layers:
//   1. Loop verification (this file): rejects unknown tools / bad arguments, and refuses `pay` unless this
//      session pre-flighted the bill, it passed, the amount equals the checked amount, and a human approved it.
//   2. The gate (packages/rails/guardedPay via PayRunService): HMAC approval token + check hash + amount,
//      enforced even if layer 1 is switched off (see test "gate holds even with loop verification off").
import type { PayRun } from "../../planner/src/cashPlan.ts";
import type { Finding } from "../../preflight/src/types.ts";
import type { PayRunService } from "../../store/src/PayRunService.ts";
import { verifyText } from "./explain.ts";
import type { Observation, Planner, ToolCall } from "./planners.ts";
import { TOOL_NAMES } from "./tools.ts";
import { Toolbox, type HumanApprover, type ToolResult } from "./toolbox.ts";

export interface TraceStep {
  turn: number;
  planner: string;
  tool: string;
  args: Record<string, unknown>;
  preVerify: "pass" | `blocked: ${string}`;
  result: ToolResult;
  postVerify?: "pass" | `fail: ${string}`;
}

export interface AgentReport {
  status: "finished" | "max_turns" | "planner_error";
  planner: string;
  turns: number;
  trace: TraceStep[];
  paid: { billId: string; invoiceNumber: string | null; amountCents: number; paymentId: string; simulated: boolean }[];
  held: { billId: string; invoiceNumber: string | null; reasons: string[] }[];
  deniedByHuman: string[];
  approvedUnpaid: string[];
  refusals: { billId: string; by: "loop" | "gate"; reason: string }[];
  summary: string;
  summarySource: "planner" | "deterministic (planner summary empty)" | "deterministic (planner summary failed verifyText)";
  summaryRejected?: string[];
  error?: string;
}

export interface LoopOptions { maxTurns?: number; verify?: boolean }

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function validate(call: ToolCall): string | null {
  if (!TOOL_NAMES.has(call.tool)) return `unknown_tool ${call.tool}`;
  const a = call.args ?? {};
  if ("__unparseable" in a) return "arguments_not_json";
  const ids = (x: unknown) => Array.isArray(x) && x.length > 0 && x.length <= 100 && x.every((s) => typeof s === "string" && s.length <= 100);
  if (call.tool === "preflight_payment" || call.tool === "request_approval") return ids(a.billIds) ? null : "billIds must be a non-empty string array";
  if (call.tool === "pay") {
    if (typeof a.billId !== "string" || a.billId.length > 100) return "billId must be a string";
    if (!Number.isInteger(a.amountCents) || (a.amountCents as number) <= 0) return "amountCents must be a positive integer";
  }
  return null;
}

export async function runAgent(run: PayRun, svc: PayRunService, planner: Planner, human: HumanApprover, opts: LoopOptions = {}): Promise<AgentReport> {
  const box = new Toolbox(run, svc, human);
  const verify = opts.verify ?? true;
  const trace: TraceStep[] = [];
  const refusals: AgentReport["refusals"] = [];
  const resolve = (id: unknown) => run.bills.find((b) => b.billId === id || b.invoiceNumber === id);
  let obs: Observation[] = [];
  let status: AgentReport["status"] = "max_turns";
  let plannerSummary = "";
  let error: string | undefined;
  let turn = 0;
  let nudges = 1;

  for (; turn < (opts.maxTurns ?? 12); turn++) {
    let out;
    try { out = await planner.next(obs); } catch (e) { status = "planner_error"; error = (e as Error).message; break; }
    if (out.kind === "finish") {
      // completion check: human-approved bills that were never paid -> tell the planner once and continue
      const paidNow = new Set((await svc.store.listPayments(run.runId)).map((p) => p.billId));
      const pending = [...box.approved].filter((b) => !paidNow.has(b));
      if (pending.length && planner.feedback && nudges-- > 0) {
        const lines = pending.map((b) => { const x = run.bills.find((y) => y.billId === b)!; return `${x.invoiceNumber ?? b} (billId ${b}, amountCents ${x.amountCents})`; });
        planner.feedback(`Completion check failed: these bills were approved by the human but not paid yet: ${lines.join("; ")}. Pay them with the pay tool, then summarize.`);
        trace.push({ turn, planner: planner.label, tool: "(completion_check)", args: { approvedUnpaid: pending }, preVerify: "pass", result: { ok: false, approvedUnpaid: pending } });
        obs = [];
        continue;
      }
      status = "finished"; plannerSummary = out.summary; turn++; break;
    }
    obs = [];
    for (const call of out.calls) {
      let pre: TraceStep["preVerify"] = "pass";
      const bad = validate(call);
      if (bad) pre = `blocked: ${bad}`;
      else if (verify && call.tool === "pay") {
        const b = resolve(call.args.billId);
        const pf = b && box.preflighted.get(b.billId);
        if (!b) pre = "blocked: bill not in this run";
        else if (!pf) pre = "blocked: pay before preflight_payment in this session";
        else if (!pf.pass || pf.decision !== "pay") pre = `blocked: bill is held (${b.holdReasons.join(", ")})`;
        else if (call.args.amountCents !== pf.amountCents) pre = `blocked: amount ${call.args.amountCents} != checked ${pf.amountCents}`;
        else if (!box.approved.has(b.billId)) pre = "blocked: no human approval for this bill";
      }
      let result: ToolResult;
      if (pre !== "pass") {
        result = { ok: false, refused: true, by: "loop", reason: pre.slice("blocked: ".length) };
        if (call.tool === "pay") refusals.push({ billId: String(call.args.billId), by: "loop", reason: result.reason as string });
      } else {
        result = await box.call(call.tool, call.args);
        if (call.tool === "pay" && result.refused) refusals.push({ billId: String(result.billId), by: "gate", reason: String(result.reason) });
      }
      const step: TraceStep = { turn, planner: planner.label, tool: call.tool, args: call.args, preVerify: pre, result };
      if (call.tool === "pay" && result.ok) {
        // post-verify: the ledger must now hold exactly this payment for this run + bill + amount
        const recs = (await svc.store.listPayments(run.runId)).filter((p) => p.billId === result.billId);
        step.postVerify = recs.length === 1 && recs[0]!.amountCents === result.amountCents && recs[0]!.paymentId === result.paymentId ? "pass" : `fail: ledger has ${recs.length} record(s)`;
      }
      trace.push(step);
      obs.push({ call, result });
    }
  }

  const payments = await svc.store.listPayments(run.runId);
  const paid = payments.map((p) => ({ billId: p.billId, invoiceNumber: run.bills.find((b) => b.billId === p.billId)?.invoiceNumber ?? null, amountCents: p.amountCents, paymentId: p.paymentId, simulated: p.simulated }));
  const paidIds = new Set(paid.map((p) => p.billId));
  const held = run.bills.filter((b) => !paidIds.has(b.billId)).map((b) => ({ billId: b.billId, invoiceNumber: b.invoiceNumber, reasons: b.decision === "hold" ? b.holdReasons : box.denied.has(b.billId) ? ["denied_by_human"] : ["not_paid"] }));

  const deterministic = `Paid (SIMULATED, no money moved): ${paid.length ? paid.map((p) => `${p.invoiceNumber ?? p.billId} ${usd(p.amountCents)}`).join(", ") : "none"}. ` +
    `Held: ${held.length ? held.map((h) => `${h.invoiceNumber ?? h.billId} (${h.reasons.join(", ")})`).join("; ") : "none"}.`;
  // An LLM summary may only use amounts / bill numbers that exist in the findings or the deterministic report.
  const source: Finding[] = [...run.bills.flatMap((b) => b.findings), ...run.runFindings,
    { rule: "report", severity: "warn", billId: null, message: `${deterministic} ${run.bills.map((b) => `${b.invoiceNumber ?? ""} ${b.amountCents !== null ? usd(b.amountCents) : ""}`).join(" ")} ${usd(run.cash.startCents)} ${usd(run.cash.endCents)} ${usd(run.cash.floorCents)} ${usd(run.cash.payCents)} ${usd(run.cash.committedOutflowsCents)}`, evidence: [] }];
  let summary = deterministic;
  let summarySource: AgentReport["summarySource"] = "deterministic (planner summary empty)";
  let summaryRejected: string[] | undefined;
  if (plannerSummary.trim()) {
    const v = verifyText(plannerSummary, source);
    if (v.ok) { summary = `${plannerSummary.trim()}\n\n[verified facts] ${deterministic}`; summarySource = "planner"; }
    else { summarySource = "deterministic (planner summary failed verifyText)"; summaryRejected = v.unknown; }
  }
  const approvedUnpaid = [...box.approved].filter((b) => !paidIds.has(b));
  return { approvedUnpaid, status, planner: planner.label, turns: turn, trace, paid, held, deniedByHuman: [...box.denied], refusals, summary, summarySource, summaryRejected, error };
}
