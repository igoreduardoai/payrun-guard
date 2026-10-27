// Executes agent tool calls against the real engine (planner run + PayRunService + gate).
// The planner (rules or LLM) only ever sees the JSON results below: never an approval token,
// never the signing secret. Tokens live in this object's private inbox, keyed by bill.
import type { PayRun, PlannedBill } from "../../planner/src/cashPlan.ts";
import { GateRefusal } from "../../rails/src/guardedPay.ts";
import type { PayRunService } from "../../store/src/PayRunService.ts";

export interface ApprovalRequest { billId: string; invoiceNumber: string | null; vendorId: string | null; amountCents: number; currency: string; findings: string[] }

/** The human in the loop. Lives outside the planner; decides per bill. */
export interface HumanApprover {
  readonly name: string;
  review(requests: ApprovalRequest[]): Promise<Record<string, boolean>>;
}

export class ApproveAll implements HumanApprover { constructor(readonly name = "demo-approver") {} async review(r: ApprovalRequest[]) { return Object.fromEntries(r.map((x) => [x.billId, true])); } }
export class DenyAll implements HumanApprover { constructor(readonly name = "demo-approver") {} async review(r: ApprovalRequest[]) { return Object.fromEntries(r.map((x) => [x.billId, false])); } }

export type ToolResult = Record<string, unknown> & { ok: boolean };

const compactBill = (b: PlannedBill) => ({ billId: b.billId, invoiceNumber: b.invoiceNumber, vendorId: b.vendorId, amountCents: b.amountCents,
  currency: b.currency, dueDate: b.dueDate, decision: b.decision, holdReasons: b.holdReasons });

export class Toolbox {
  private tokens = new Map<string, string>(); // billId -> approval token (never returned to the planner)
  readonly preflighted = new Map<string, { pass: boolean; decision: "pay" | "hold"; amountCents: number | null }>();
  readonly approved = new Set<string>();
  readonly denied = new Set<string>();

  constructor(private run: PayRun, private svc: PayRunService, private human: HumanApprover) {}

  private bill(id: string) { return this.run.bills.find((b) => b.billId === id || b.invoiceNumber === id); }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case "get_run":
        return { ok: true, runId: this.run.runId, asOf: this.run.asOf, windowEnd: this.run.windowEnd, cash: this.run.cash,
          bills: this.run.bills.map(compactBill), runFindings: this.run.runFindings.map((f) => f.message), paymentsSimulated: true };
      case "preflight_payment": {
        const ids = args.billIds as string[];
        const results = ids.map((id) => {
          const b = this.bill(id);
          if (!b) return { billId: id, found: false };
          this.preflighted.set(b.billId, { pass: b.pass, decision: b.decision, amountCents: b.amountCents });
          return { billId: b.billId, invoiceNumber: b.invoiceNumber, found: true, pass: b.pass, decision: b.decision, amountCents: b.amountCents,
            findings: b.findings.map((f) => `[${f.severity}] ${f.rule}: ${f.message}`) }; // full evidence (Rho object ids) stays in the run + audit log
        });
        return { ok: true, results };
      }
      case "request_approval": {
        const ids = args.billIds as string[];
        const requests: ApprovalRequest[] = [];
        const notApprovable: { billId: string; reason: string }[] = [];
        for (const id of ids) {
          const b = this.bill(id);
          if (!b) { notApprovable.push({ billId: id, reason: "not_in_run" }); continue; }
          if (b.decision !== "pay" || b.amountCents === null || b.currency === null) { notApprovable.push({ billId: b.billId, reason: `held: ${b.holdReasons.join(", ")}` }); continue; }
          requests.push({ billId: b.billId, invoiceNumber: b.invoiceNumber, vendorId: b.vendorId, amountCents: b.amountCents, currency: b.currency,
            findings: b.findings.map((f) => `[${f.severity}] ${f.message}`) });
        }
        const decisions = requests.length ? await this.human.review(requests) : {};
        const out: { billId: string; approved: boolean }[] = [];
        for (const r of requests) {
          if (decisions[r.billId]) {
            this.tokens.set(r.billId, await this.svc.approve(this.run, r.billId, this.human.name));
            this.approved.add(r.billId); out.push({ billId: r.billId, approved: true });
          } else { this.denied.add(r.billId); out.push({ billId: r.billId, approved: false }); }
        }
        return { ok: true, approver: `human:${this.human.name}`, decisions: out, notApprovable, note: "approval tokens are held by the gate, not returned to the agent" };
      }
      case "pay": {
        const b = this.bill(String(args.billId));
        const billId = b?.billId ?? String(args.billId);
        try {
          const out = await this.svc.pay(this.run, billId, Number(args.amountCents), this.tokens.get(billId), "agent");
          return { ok: true, billId, paymentId: out.record.paymentId, amountCents: out.record.amountCents, created: out.created, simulated: out.record.simulated };
        } catch (e) {
          if (e instanceof GateRefusal) return { ok: false, billId, refused: true, reason: e.reason, message: e.message };
          throw e;
        }
      }
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  }
}
