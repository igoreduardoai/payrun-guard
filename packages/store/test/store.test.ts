import { test } from "node:test";
import assert from "node:assert/strict";
import { planRun } from "../../planner/src/cashPlan.ts";
import { signApproval } from "../../rails/src/approval.ts";
import { GateRefusal } from "../../rails/src/guardedPay.ts";
import { loadFixture, PRIMARY_CHECKING } from "../../testutil/fixtures.ts";
import { MemoryStore } from "../src/MemoryStore.ts";
import { PayRunService } from "../src/PayRunService.ts";
import { StoreConstraintError } from "../src/Store.ts";
import { storeFromEnv } from "../src/index.ts";

const SECRET = "test-secret-not-real-0123456789";
const snap = loadFixture();
const mkRun = () => planRun(snap, { asOf: "2026-08-27", sourceAccountId: PRIMARY_CHECKING, cashFloorCents: 250_000 });
const id = (run: ReturnType<typeof mkRun>, n: string) => run.bills.find((b) => b.invoiceNumber === n)!;
async function setup() {
  const store = new MemoryStore();
  const svc = new PayRunService(store, SECRET, snap.counterparties);
  const run = mkRun();
  await svc.recordRun(run, "fixtures");
  return { store, svc, run };
}
const reason = (r: string) => (e: unknown) => e instanceof GateRefusal && e.reason === r;

test("recordRun persists 1 run + 13 bill checks + run_planned audit; saving twice is idempotent", async () => {
  const { store, svc, run } = await setup();
  await svc.store.saveRun(run, "fixtures");
  assert.equal(store.runs.size, 1);
  assert.equal(store.checks.size, 13);
  assert.equal([...store.checks.values()].filter((c) => c.decision === "pay").length, 3);
  const audit = await store.listAudit(run.runId);
  assert.deepEqual(audit.map((a) => a.event), ["run_planned"]);
  assert.equal((audit[0]!.detail as any).pay, 3);
});

test("approval stores only the token hash, never the raw token", async () => {
  const { store, svc, run } = await setup();
  const token = await svc.approve(run, id(run, "BILL-2026-0017").billId, "igor");
  assert.equal(store.approvals.length, 1);
  assert.equal(store.approvals[0]!.tokenSha256.length, 64);
  assert.ok(!JSON.stringify(store.approvals).includes(token));
  assert.ok(!JSON.stringify(await store.listAudit()).includes(token));
});

test("held bill cannot be approved", async () => {
  const { svc, run } = await setup();
  await assert.rejects(svc.approve(run, id(run, "BILL-2026-0013").billId, "igor"), reason("not_approvable"));
});

test("agent pay without approval is refused and the refusal is audited", async () => {
  const { store, svc, run } = await setup();
  const b = id(run, "BILL-2026-0017");
  await assert.rejects(svc.pay(run, b.billId, b.amountCents!, undefined), reason("no_approval"));
  const last = (await store.listAudit()).at(-1)!;
  assert.equal(last.event, "gate_refused");
  assert.equal((last.detail as any).reason, "no_approval");
  assert.equal((await store.listPayments()).length, 0);
});

test("double click: 3 pay calls -> 1 payment row, audit 1 created + 2 duplicates", async () => {
  const { store, svc, run } = await setup();
  const b = id(run, "BILL-2026-0017");
  const token = await svc.approve(run, b.billId, "igor");
  const results = await Promise.all([svc.pay(run, b.billId, 76_500, token), svc.pay(run, b.billId, 76_500, token)]);
  results.push(await svc.pay(run, b.billId, 76_500, token));
  assert.equal(new Set(results.map((r) => r.record.paymentId)).size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal((await store.listPayments(run.runId)).length, 1);
  const ev = (await store.listAudit()).map((a) => a.event);
  assert.equal(ev.filter((e) => e === "payment_created").length, 1);
  assert.equal(ev.filter((e) => e === "payment_duplicate").length, 2);
  assert.equal(results[0]!.record.simulated, true);
});

test("a correctly signed token that this system never issued (no stored hash) is refused", async () => {
  const { svc, run } = await setup();
  const b = id(run, "BILL-2026-0017");
  const forgedButSigned = signApproval({ runId: run.runId, billId: b.billId, amountCents: 76_500, currency: "USD", checkHash: b.checkHash, approver: "x", expiresAt: "2099-01-01T00:00:00Z" }, SECRET);
  await assert.rejects(svc.pay(run, b.billId, 76_500, forgedButSigned), reason("approval_unknown"));
});

test("a tampered run object (held bill flipped to pay) is refused against the persisted check", async () => {
  const { svc, run } = await setup();
  const tampered = structuredClone(run);
  const b = tampered.bills.find((x) => x.invoiceNumber === "BILL-2026-0013")!;
  b.decision = "pay"; b.pass = true; b.holdReasons = [];
  await assert.rejects(svc.pay(tampered, b.billId, 7_500, "x.y"), reason("run_tampered"));
});

test("memory store mirrors SQL constraints", async () => {
  const s = new MemoryStore();
  const run = mkRun();
  const bad = structuredClone(run);
  bad.bills[0]!.decision = "pay"; bad.bills[0]!.pass = false;
  await assert.rejects(s.saveRun(bad, "fixtures"), StoreConstraintError);
  await assert.rejects(s.insertPaymentIfAbsent({ idempotencyKey: "k", runId: "nope", billId: "b", counterpartyId: "c", paymentMethodId: "m", sourceAccountId: "s",
    amountCents: 1, currency: "USD", paymentId: "p", status: "submitted", simulated: true, rail: "simulated", createdAt: "" }), StoreConstraintError);
});

test("storeFromEnv: offline by default; publishable key never used for writes", () => {
  assert.equal(storeFromEnv({}).store.kind, "memory");
  const r = storeFromEnv({ STORE: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_publishable_abc" });
  assert.equal(r.store.kind, "memory");
  assert.match(r.note, /missing/);
  assert.equal(storeFromEnv({ STORE: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" }).store.kind, "supabase");
});
