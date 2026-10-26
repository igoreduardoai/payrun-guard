import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, checkBill, preflight } from "../src/run.ts";
import { ACME, billByNumber, loadFixture } from "../../testutil/fixtures.ts";
import type { Bill, RhoSnapshot } from "../../rho/src/types.ts";

const snap = loadFixture();
const AS_OF = "2026-08-27";
const ctx = buildContext(snap, AS_OF);
const rules = (b: Bill, c = ctx) => checkBill(b, c).findings.map((f) => `${f.severity}:${f.rule}`).sort();
const clone = (): RhoSnapshot => JSON.parse(JSON.stringify(snap));

test("fixture shape: 24 bills, 7 vendors, 5 scheduled payments", () => {
  assert.equal(snap.bills.length, 24);
  assert.equal(snap.counterparties.length, 7);
  assert.equal(snap.scheduled_transactions.length, 5);
});

test("BILL-2026-0013: scheduled to a vendor with no payment method and no W-9 is blocked", () => {
  const c = checkBill(billByNumber(snap, "BILL-2026-0013"), ctx);
  assert.equal(c.pass, false);
  assert.deepEqual(rules(billByNumber(snap, "BILL-2026-0013")),
    ["block:payment_method_missing", "block:vendor_not_active", "block:w9_missing", "warn:past_due"]);
  const pm = c.findings.find((f) => f.rule === "payment_method_missing")!;
  assert.deepEqual(pm.evidence[0], { object: "counterparty", id: "90000000-0000-4000-8000-000000000005", field: "payment_methods", value: [] });
});

test("BILL-2026-0015: vendor 'incomplete' without W-9 is blocked", () => {
  assert.deepEqual(rules(billByNumber(snap, "BILL-2026-0015")), ["block:vendor_not_active", "block:w9_missing", "warn:past_due"]);
});

test("BILL-2026-0020: bill without a vendor is blocked", () => {
  assert.ok(rules(billByNumber(snap, "BILL-2026-0020")).includes("block:vendor_missing"));
});

test("empty draft bill is blocked as incomplete", () => {
  const draft = snap.bills.find((b) => !b.invoice_number)!;
  assert.ok(rules(draft).includes("block:bill_incomplete"));
});

test("status 'other' is blocked until confirmed", () => {
  assert.ok(rules(billByNumber(snap, "BILL-2026-0022")).includes("block:status_unrecognized"));
});

test("BILL-2026-0012 already has a scheduled wire: paying again is blocked (double pay)", () => {
  assert.ok(rules(billByNumber(snap, "BILL-2026-0012")).includes("block:already_scheduled"));
});

test("failed payment cannot be retried before bank details are confirmed", () => {
  assert.ok(rules(billByNumber(snap, "BILL-2026-0006")).includes("block:previous_payment_failed"));
});

test("non-US vendor (Globex, DE) gets no W-9 finding; scheduled bill without date warns", () => {
  const r = rules(billByNumber(snap, "BILL-2026-0014"));
  assert.ok(!r.some((x) => x.includes("w9")));
  assert.ok(r.includes("warn:scheduled_without_date"));
});

test("W-9 requested but pending is a warning, not a block", () => {
  const c = checkBill(billByNumber(snap, "BILL-2026-0018"), ctx);
  assert.equal(c.pass, true);
  assert.ok(c.findings.some((f) => f.rule === "w9_pending" && f.severity === "warn"));
});

test("clean bill passes with zero blocking findings", () => {
  const c = checkBill(billByNumber(snap, "BILL-2026-0017"), ctx);
  assert.equal(c.pass, true);
  assert.equal(c.findings.filter((f) => f.severity === "block").length, 0);
});

test("Acme Supplies: two active monthly ACH schedules are flagged at run level", () => {
  const pf = preflight(snap, AS_OF, []);
  const f = pf.runFindings.find((x) => x.rule === "recurring_overlap");
  assert.ok(f);
  assert.match(f.message, /Acme Supplies LLC has 2 active recurring payments \(\$4,500\.00 monthly ach \+ \$750\.00 monthly ach\)/);
  assert.deepEqual(f.evidence.map((e) => e.value), [450000, 75000]);
  assert.ok(pf.runFindings.some((x) => x.rule === "scheduled_payment_failed"));
});

test("bill to a vendor that also has recurring payments warns", () => {
  assert.ok(rules(billByNumber(snap, "BILL-2026-0016")).includes("warn:vendor_has_recurring_payment"));
});

test("edge: lines that don't add up to the total are blocked with exact difference", () => {
  const s = clone();
  const b = billByNumber(s, "BILL-2026-0014");
  b.lines![2]!.amount.amount = 19_999; // total 215000, lines now 214999
  const f = checkBill(b, buildContext(s, AS_OF)).findings.find((x) => x.rule === "line_sum_mismatch")!;
  assert.equal(f.severity, "block");
  assert.match(f.message, /lines add up to \$2,149\.99 but the bill total is \$2,150\.00 \(difference \$0\.01\)/);
});

test("edge: a line in another currency is blocked", () => {
  const s = clone();
  const b = billByNumber(s, "BILL-2026-0014");
  b.lines![0]!.amount.currency = "EUR";
  assert.ok(rules(b, buildContext(s, AS_OF)).includes("block:line_currency_mismatch"));
});

test("edge: same vendor + same invoice number (formatting differs) is a blocked duplicate", () => {
  const s = clone();
  const orig = billByNumber(s, "BILL-2026-0017");
  const dup: Bill = { ...JSON.parse(JSON.stringify(orig)), id: "dup-1", invoice_number: "bill 2026 0017", status: "awaiting_approval" };
  s.bills.push(dup);
  assert.ok(rules(dup, buildContext(s, AS_OF)).includes("block:duplicate_invoice_number"));
});

test("edge: same vendor + same amount within 30 days warns; 31+ days does not", () => {
  const s = clone();
  const base: Bill = { id: "a", status: "awaiting_approval", invoice_number: "X-1", invoice_date: "2026-08-01", due_date: "2026-08-30",
    amount: { amount: 12_345, currency: "USD" }, counterparty: { id: ACME }, lines: [], created_at: "2026-08-01T00:00:00Z" };
  const near: Bill = { ...base, id: "b", invoice_number: "X-2", invoice_date: "2026-08-20" };
  const far: Bill = { ...base, id: "c", invoice_number: "X-3", invoice_date: "2026-09-01" };
  s.bills.push(base, near);
  assert.ok(rules(near, buildContext(s, AS_OF)).includes("warn:possible_duplicate_amount"));
  const s2 = clone(); s2.bills.push(base, far);
  assert.ok(!rules(far, buildContext(s2, AS_OF)).includes("warn:possible_duplicate_amount"));
});

test("edge: zero amount is blocked; archived vendor is blocked; unknown vendor id is blocked", () => {
  const s = clone();
  const zero: Bill = { id: "z", status: "awaiting_approval", invoice_number: "Z-1", due_date: "2026-08-30", amount: { amount: 0, currency: "USD" },
    counterparty: { id: ACME }, created_at: "2026-08-01T00:00:00Z" };
  const archived: Bill = { ...zero, id: "ar", invoice_number: "Z-2", amount: { amount: 500, currency: "USD" }, counterparty: { id: "90000000-0000-4000-8000-000000000007" } };
  const ghost: Bill = { ...zero, id: "gh", invoice_number: "Z-3", amount: { amount: 500, currency: "USD" }, counterparty: { id: "nope" } };
  const c = buildContext(s, AS_OF);
  assert.ok(rules(zero, c).includes("block:amount_invalid"));
  assert.ok(rules(archived, c).includes("block:vendor_not_active"));
  assert.ok(rules(ghost, c).includes("block:vendor_unknown"));
});

test("edge: past-due day count is exact; due today is not past due", () => {
  const f = checkBill(billByNumber(snap, "BILL-2026-0020"), ctx).findings.find((x) => x.rule === "past_due")!;
  assert.match(f.message, /\(1 day late\)/);
  assert.ok(!rules(billByNumber(snap, "BILL-2026-0020"), buildContext(snap, "2026-08-26")).includes("warn:past_due"));
});

test("checkHash changes when the bill changes", () => {
  const s = clone();
  const a = checkBill(billByNumber(s, "BILL-2026-0017"), buildContext(s, AS_OF)).checkHash;
  billByNumber(s, "BILL-2026-0017").amount!.amount += 1;
  billByNumber(s, "BILL-2026-0017").lines![0]!.amount.amount += 1;
  const b = checkBill(billByNumber(s, "BILL-2026-0017"), buildContext(s, AS_OF)).checkHash;
  assert.notEqual(a, b);
});
