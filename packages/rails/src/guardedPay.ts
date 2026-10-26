// THE GATE. The only function the agent may call to move money.
// Hard rule: no payment without (1) a passing pre-flight result for this exact bill in this run
// and (2) a valid human approval token bound to the same run, bill, amount and check hash.
import type { PayRun } from "../../planner/src/cashPlan.ts";
import type { Counterparty } from "../../rho/src/types.ts";
import { verifyApproval } from "./approval.ts";
import type { PaymentRail, PaymentRecord } from "./PaymentRail.ts";

export class GateRefusal extends Error {
  constructor(public reason: string, message: string) { super(message); this.name = "GateRefusal"; }
}

export interface GuardedPayInput {
  run: PayRun;
  billId: string;
  amountCents: number;          // what the caller (agent) asks to pay; must equal the checked amount
  approvalToken: string | undefined;
  counterparties: Counterparty[];
}

export async function guardedPay(rail: PaymentRail, input: GuardedPayInput, approvalSecret: string, now = new Date()): Promise<PaymentRecord> {
  return (await guardedPayDetailed(rail, input, approvalSecret, now)).record;
}

export async function guardedPayDetailed(rail: PaymentRail, input: GuardedPayInput, approvalSecret: string, now = new Date()): Promise<{ record: PaymentRecord; created: boolean }> {
  const planned = input.run.bills.find((b) => b.billId === input.billId);
  if (!planned) throw new GateRefusal("not_in_run", `bill ${input.billId} is not part of run ${input.run.runId}`);
  if (!planned.pass) throw new GateRefusal("preflight_failed", `pre-flight failed: ${planned.holdReasons.join(", ")}`);
  if (planned.decision !== "pay") throw new GateRefusal("held_by_plan", `bill is held: ${planned.holdReasons.join(", ")}`);
  if (planned.amountCents === null || planned.currency === null) throw new GateRefusal("no_amount", "bill has no amount");
  if (input.amountCents !== planned.amountCents) throw new GateRefusal("amount_mismatch", `requested ${input.amountCents} != checked ${planned.amountCents}`);
  if (!input.approvalToken) throw new GateRefusal("no_approval", "human approval token required");

  let claims;
  try { claims = verifyApproval(input.approvalToken, approvalSecret, now); }
  catch (e) { throw new GateRefusal("approval_invalid", (e as Error).message); }
  if (claims.runId !== input.run.runId || claims.billId !== input.billId) throw new GateRefusal("approval_scope", "approval is for a different run or bill");
  if (claims.amountCents !== planned.amountCents || claims.currency !== planned.currency) throw new GateRefusal("approval_amount", "approval amount differs from checked amount");
  if (claims.checkHash !== planned.checkHash) throw new GateRefusal("approval_stale", "bill or check result changed after approval");

  const vendor = input.counterparties.find((c) => c.id === planned.vendorId);
  const method = vendor?.payment_methods.find((m) => m.is_default) ?? vendor?.payment_methods[0];
  if (!vendor || !method) throw new GateRefusal("no_payment_method", "vendor payment method missing");

  const req = {
    idempotencyKey: `${input.run.runId}:${input.billId}`,
    runId: input.run.runId, billId: input.billId, counterpartyId: vendor.id, paymentMethodId: method.id,
    sourceAccountId: input.run.sourceAccountId, amountCents: planned.amountCents, currency: planned.currency,
  };
  if (rail.payDetailed) return rail.payDetailed(req);
  return { record: await rail.pay(req), created: true };
}
