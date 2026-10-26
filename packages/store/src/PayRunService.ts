// Wires planner + gate + rail + store. Every step is persisted and audited.
import { createHash } from "node:crypto";
import type { PayRun } from "../../planner/src/cashPlan.ts";
import type { Counterparty } from "../../rho/src/types.ts";
import { signApproval } from "../../rails/src/approval.ts";
import { GateRefusal, guardedPayDetailed } from "../../rails/src/guardedPay.ts";
import { SimulatedRail } from "../../rails/src/SimulatedRail.ts";
import type { PaymentRecord } from "../../rails/src/PaymentRail.ts";
import type { DataSource, Store } from "./Store.ts";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class PayRunService {
  readonly rail: SimulatedRail;
  constructor(readonly store: Store, private approvalSecret: string, private counterparties: Counterparty[]) {
    this.rail = new SimulatedRail(store);
  }

  async recordRun(run: PayRun, source: DataSource) {
    await this.store.saveRun(run, source);
    await this.store.appendAudit({ runId: run.runId, billId: null, actor: "system", event: "run_planned",
      detail: { bills: run.bills.length, pay: run.bills.filter((b) => b.decision === "pay").length, cash: run.cash, source } });
  }

  /** Human action. Returns the raw token to the caller (UI session); only its hash is stored. */
  async approve(run: PayRun, billId: string, approver: string, ttlMs = 10 * 60_000): Promise<string> {
    const b = run.bills.find((x) => x.billId === billId);
    if (!b || b.decision !== "pay" || b.amountCents === null || b.currency === null) throw new GateRefusal("not_approvable", `bill ${billId} is not approvable`);
    const claims = { runId: run.runId, billId, amountCents: b.amountCents, currency: b.currency, checkHash: b.checkHash, approver, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
    const token = signApproval(claims, this.approvalSecret);
    await this.store.saveApproval(claims, sha256(token));
    await this.store.appendAudit({ runId: run.runId, billId, actor: `human:${approver}`, event: "approval_signed", detail: { amountCents: b.amountCents, expiresAt: claims.expiresAt } });
    return token;
  }

  /** Agent (or UI) action. Refusals are audited too. */
  async pay(run: PayRun, billId: string, amountCents: number, approvalToken: string | undefined, actor = "agent"): Promise<{ record: PaymentRecord; created: boolean }> {
    try {
      // The persisted check must agree with the run object the caller passed (a tampered run is refused).
      const stored = await this.store.getBillCheck(run.runId, billId);
      const planned = run.bills.find((x) => x.billId === billId);
      if (!stored) throw new GateRefusal("not_persisted", "bill check not found in store");
      if (planned && (stored.checkHash !== planned.checkHash || stored.decision !== planned.decision || stored.amountCents !== planned.amountCents)) {
        throw new GateRefusal("run_tampered", "run differs from the persisted check");
      }
      if (approvalToken && !(await this.approvalKnown(approvalToken))) throw new GateRefusal("approval_unknown", "approval token was not issued by this system");
      const out = await guardedPayDetailed(this.rail, { run, billId, amountCents, approvalToken, counterparties: this.counterparties }, this.approvalSecret);
      await this.store.appendAudit({ runId: run.runId, billId, actor, event: out.created ? "payment_created" : "payment_duplicate",
        detail: { paymentId: out.record.paymentId, amountCents: out.record.amountCents, simulated: out.record.simulated } });
      return out;
    } catch (e) {
      if (e instanceof GateRefusal) {
        await this.store.appendAudit({ runId: run.runId, billId, actor, event: "gate_refused", detail: { reason: e.reason, message: e.message } });
      }
      throw e;
    }
  }

  private approvalKnown(token: string): Promise<boolean> {
    // HMAC is verified in guardedPay; additionally the token's hash must have been recorded when a human approved.
    return this.store.hasApproval(sha256(token));
  }
}
