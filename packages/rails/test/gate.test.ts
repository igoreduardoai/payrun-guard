import { test } from "node:test";
import assert from "node:assert/strict";
import { planRun } from "../../planner/src/cashPlan.ts";
import { loadFixture, PRIMARY_CHECKING } from "../../testutil/fixtures.ts";
import { signApproval } from "../src/approval.ts";
import { GateRefusal, guardedPay } from "../src/guardedPay.ts";
import { SimulatedRail } from "../src/SimulatedRail.ts";

const SECRET = "test-secret-not-real-0123456789";
const snap = loadFixture();
const run = planRun(snap, { asOf: "2026-08-27", sourceAccountId: PRIMARY_CHECKING, cashFloorCents: 250_000 });
const bill = (n: string) => run.bills.find((b) => b.invoiceNumber === n)!;
const approve = (n: string, over: Partial<Parameters<typeof signApproval>[0]> = {}, secret = SECRET) => {
  const b = bill(n);
  return signApproval({ runId: run.runId, billId: b.billId, amountCents: b.amountCents!, currency: b.currency!, checkHash: b.checkHash,
    approver: "finance-lead", expiresAt: "2099-01-01T00:00:00Z", ...over }, secret);
};
const pay = (rail: SimulatedRail, n: string, token: string | undefined, amount = bill(n).amountCents!) =>
  guardedPay(rail, { run, billId: bill(n).billId, amountCents: amount, approvalToken: token, counterparties: snap.counterparties }, SECRET);
const refused = async (p: Promise<unknown>, reason: string) => {
  await assert.rejects(p, (e: unknown) => e instanceof GateRefusal && e.reason === reason);
};

test("agent cannot pay without a human approval token", async () => {
  await refused(pay(new SimulatedRail(), "BILL-2026-0017", undefined), "no_approval");
});

test("agent cannot pay a blocked bill even with a valid-looking approval", async () => {
  await refused(pay(new SimulatedRail(), "BILL-2026-0013", approve("BILL-2026-0013")), "preflight_failed");
});

test("forged token (wrong secret) is refused", async () => {
  await refused(pay(new SimulatedRail(), "BILL-2026-0017", approve("BILL-2026-0017", {}, "attacker-secret-0123456789")), "approval_invalid");
});

test("expired token is refused", async () => {
  await refused(pay(new SimulatedRail(), "BILL-2026-0017", approve("BILL-2026-0017", { expiresAt: "2020-01-01T00:00:00Z" })), "approval_invalid");
});

test("agent asking for a different amount is refused", async () => {
  await refused(pay(new SimulatedRail(), "BILL-2026-0017", approve("BILL-2026-0017"), 76_501), "amount_mismatch");
});

test("approval for one bill cannot be reused for another", async () => {
  const tokenFor16 = approve("BILL-2026-0016");
  await refused(pay(new SimulatedRail(), "BILL-2026-0017", tokenFor16), "approval_scope");
});

test("approval is stale if the checked bill changed (checkHash)", async () => {
  await refused(pay(new SimulatedRail(), "BILL-2026-0017", approve("BILL-2026-0017", { checkHash: "old" })), "approval_stale");
});

test("cash-floor-held bill is refused even with approval", async () => {
  const tight = planRun(snap, { asOf: "2026-08-27", sourceAccountId: PRIMARY_CHECKING, cashFloorCents: 350_000 });
  const b = tight.bills.find((x) => x.invoiceNumber === "BILL-2026-0017")!;
  const token = signApproval({ runId: tight.runId, billId: b.billId, amountCents: b.amountCents!, currency: "USD", checkHash: b.checkHash, approver: "x", expiresAt: "2099-01-01T00:00:00Z" }, SECRET);
  await assert.rejects(guardedPay(new SimulatedRail(), { run: tight, billId: b.billId, amountCents: b.amountCents!, approvalToken: token, counterparties: snap.counterparties }, SECRET),
    (e: unknown) => e instanceof GateRefusal && e.reason === "held_by_plan");
});

test("approved clean bill pays once: double click returns the same simulated payment", async () => {
  const rail = new SimulatedRail();
  const token = approve("BILL-2026-0017");
  const [a, b] = await Promise.all([pay(rail, "BILL-2026-0017", token), pay(rail, "BILL-2026-0017", token)]);
  const c = await pay(rail, "BILL-2026-0017", token);
  assert.equal(a.paymentId, b.paymentId);
  assert.equal(a.paymentId, c.paymentId);
  assert.equal((await rail.list()).length, 1);
  assert.equal(a.simulated, true);
  assert.equal(a.amountCents, 76_500);
  assert.ok(snap.counterparties.find((v) => v.id === a.counterpartyId)!.payment_methods.some((m) => m.id === a.paymentMethodId));
  assert.equal(a.sourceAccountId, PRIMARY_CHECKING);
});

test("simulated rail: same bill with a new key still pays once; conflicting amount throws", async () => {
  const rail = new SimulatedRail();
  const req = { idempotencyKey: "k1", runId: "r", billId: "b", counterpartyId: "c", paymentMethodId: "m", sourceAccountId: "s", amountCents: 100, currency: "USD" };
  const one = await rail.pay(req);
  const two = await rail.pay({ ...req, idempotencyKey: "k2" });
  assert.equal(one.paymentId, two.paymentId);
  await assert.rejects(rail.pay({ ...req, amountCents: 101 }), /idempotency conflict/);
  assert.equal((await rail.list()).length, 1);
});
