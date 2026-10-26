import { test } from "node:test";
import assert from "node:assert/strict";
import { planRun } from "../src/cashPlan.ts";
import { loadFixture, PRIMARY_CHECKING } from "../../testutil/fixtures.ts";

const snap = loadFixture();
const base = { asOf: "2026-08-27", sourceAccountId: PRIMARY_CHECKING, cashFloorCents: 250_000 };

test("demo week 2026-08-27: 13 bills in run, 3 pay, exact cash math", () => {
  const run = planRun(snap, base);
  assert.equal(run.bills.length, 13);
  const pay = run.bills.filter((b) => b.decision === "pay").map((b) => b.invoiceNumber);
  assert.deepEqual(pay, ["BILL-2026-0016", "BILL-2026-0017", "BILL-2026-0018"]);
  assert.equal(run.cash.startCents, 811_970);
  assert.equal(run.cash.committedOutflowsCents, 450_000); // Acme $4,500 monthly ACH releases 2026-09-01
  assert.equal(run.cash.payCents, 3_200 + 76_500 + 9_950);
  assert.equal(run.cash.endCents, 811_970 - 450_000 - 89_650);
  assert.ok(run.cash.endCents >= run.cash.floorCents);
});

test("cash floor: raising the floor holds bills and never plans below it", () => {
  const run = planRun(snap, { ...base, cashFloorCents: 350_000 }); // available = 8119.70 - 4500 - 3500 = 119.70
  const pay = run.bills.filter((b) => b.decision === "pay");
  // $119.70 available: $32.00 fits, then $99.50 > $87.70 left, $765.00 too
  assert.deepEqual(pay.map((b) => b.invoiceNumber), ["BILL-2026-0016"]);
  for (const n of ["BILL-2026-0017", "BILL-2026-0018"]) {
    assert.deepEqual(run.bills.find((b) => b.invoiceNumber === n)!.holdReasons, ["cash_floor"]);
  }
  assert.ok(run.cash.endCents >= 350_000);
});

test("scheduled payments alone below the floor raise a run-level block", () => {
  const run = planRun(snap, { ...base, cashFloorCents: 400_000 });
  assert.ok(run.runFindings.some((f) => f.rule === "floor_breached_by_schedule"));
  assert.equal(run.bills.filter((b) => b.decision === "pay").length, 0);
});

test("window: bills due after the window end are not in the run", () => {
  const run = planRun(snap, { ...base, asOf: "2026-08-10" }); // window to 2026-08-16
  assert.ok(!run.bills.some((b) => b.invoiceNumber === "BILL-2026-0017")); // due 08-18
  assert.equal(run.cash.committedOutflowsCents, 0);
});

test("a scheduled payment tied to a bill in the run is not counted twice", () => {
  // Treasury Checking funds the Northwind wire for BILL-2026-0012 (release 2026-08-01)
  const run = planRun(snap, { ...base, asOf: "2026-08-01", sourceAccountId: "30000000-0000-4000-8000-000000000004" });
  assert.equal(run.cash.committedOutflowsCents, 0);
  assert.ok(run.bills.find((b) => b.invoiceNumber === "BILL-2026-0012")!.holdReasons.includes("already_scheduled"));
});

test("unknown source account throws", () => {
  assert.throws(() => planRun(snap, { ...base, sourceAccountId: "nope" }), /not found/);
});
