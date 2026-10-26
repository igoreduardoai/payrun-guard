// SupabaseStore against a fake PostgREST (no network). Checks request shape, idempotency path, and that secrets/tokens don't leak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRun } from "../../planner/src/cashPlan.ts";
import { loadFixture, PRIMARY_CHECKING } from "../../testutil/fixtures.ts";
import { PayRunService } from "../src/PayRunService.ts";
import { SupabaseStore } from "../src/SupabaseStore.ts";

const KEY = "sb_secret_FAKE_for_tests_only";
const snap = loadFixture();

function fakePostgrest() {
  const tables: Record<string, any[]> = { payrun_runs: [], payrun_bill_checks: [], payrun_approvals: [], payrun_payments: [], payrun_audit_log: [] };
  const calls: { method: string; path: string; headers: Record<string, string>; body?: string }[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const headers = init!.headers as Record<string, string>;
    calls.push({ method: init!.method!, path: u.pathname + u.search, headers, body: init!.body as string | undefined });
    if (headers.apikey !== KEY) return new Response(JSON.stringify({ message: "bad key" }), { status: 401 });
    const table = u.pathname.split("/").pop()!;
    const rows = tables[table]!;
    if (init!.method === "POST") {
      const body = JSON.parse(init!.body as string);
      const list = Array.isArray(body) ? body : [body];
      const conflict = u.searchParams.get("on_conflict")?.split(",");
      const out: any[] = [];
      for (const r of list) {
        const dup = conflict ? rows.find((x) => conflict.every((c) => x[c] === r[c])) : undefined;
        if (table === "payrun_payments" && !dup && rows.some((x) => x.run_id === r.run_id && x.bill_id === r.bill_id)) return new Response(JSON.stringify({ code: "23505" }), { status: 409 });
        if (dup) { if ((headers.Prefer ?? "").includes("merge-duplicates")) Object.assign(dup, r); continue; }
        const row = table === "payrun_audit_log" ? { id: rows.length + 1, created_at: "t", ...r } : r;
        rows.push(row); out.push(row);
      }
      return new Response((headers.Prefer ?? "").includes("return=representation") ? JSON.stringify(out) : "", { status: 201 });
    }
    // GET: support eq filters and the or=(idempotency_key.eq.X,and(run_id.eq.Y,bill_id.eq.Z)) used by the store
    let res = rows;
    for (const [k, v] of u.searchParams) {
      if (v.startsWith("eq.")) res = res.filter((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
      if (k === "or") {
        const m = /idempotency_key\.eq\.([^,]+),and\(run_id\.eq\.([^,]+),bill_id\.eq\.([^)]+)\)/.exec(v)!;
        res = res.filter((r) => r.idempotency_key === m[1] || (r.run_id === m[2] && r.bill_id === m[3]));
      }
    }
    return new Response(JSON.stringify(res), { status: 200 });
  }) as typeof fetch;
  return { f, tables, calls };
}

test("SupabaseStore refuses a publishable key", () => {
  assert.throws(() => new SupabaseStore({ url: "https://x.supabase.co", secretKey: "sb_publishable_x" }), /publishable/);
});

test("full flow through SupabaseStore: run, approval hash, one payment on double click, audit rows", async () => {
  const { f, tables, calls } = fakePostgrest();
  const store = new SupabaseStore({ url: "https://x.supabase.co", secretKey: KEY, fetchImpl: f });
  const svc = new PayRunService(store, "test-secret-not-real-0123456789", snap.counterparties);
  const run = planRun(snap, { asOf: "2026-08-27", sourceAccountId: PRIMARY_CHECKING, cashFloorCents: 250_000 });
  await svc.recordRun(run, "fixtures");
  assert.equal(tables.payrun_runs!.length, 1);
  assert.equal(tables.payrun_bill_checks!.length, 13);

  const b = run.bills.find((x) => x.invoiceNumber === "BILL-2026-0017")!;
  const token = await svc.approve(run, b.billId, "igor");
  const r1 = await svc.pay(run, b.billId, 76_500, token);
  const r2 = await svc.pay(run, b.billId, 76_500, token);
  assert.equal(r1.created, true);
  assert.equal(r2.created, false);
  assert.equal(r1.record.paymentId, r2.record.paymentId);
  assert.equal(tables.payrun_payments!.length, 1);
  assert.deepEqual(tables.payrun_audit_log!.map((a) => a.event), ["run_planned", "approval_signed", "payment_created", "payment_duplicate"]);

  // no raw token anywhere in what was sent; secret key only in the apikey header
  assert.ok(calls.every((c) => !(c.body ?? "").includes(token) && !c.path.includes(token)));
  assert.ok(calls.every((c) => !(c.body ?? "").includes(KEY)));
  assert.ok(calls.every((c) => c.headers.Authorization === undefined)); // sb_secret_ keys go only in apikey
});

test("same bill with a different idempotency key hits the 409 path and returns the existing payment", async () => {
  const { f, tables } = fakePostgrest();
  const store = new SupabaseStore({ url: "https://x.supabase.co", secretKey: KEY, fetchImpl: f });
  const run = planRun(snap, { asOf: "2026-08-27", sourceAccountId: PRIMARY_CHECKING, cashFloorCents: 250_000 });
  await store.saveRun(run, "fixtures");
  const b = run.bills.find((x) => x.decision === "pay")!;
  const base = { runId: run.runId, billId: b.billId, counterpartyId: "c", paymentMethodId: "m", sourceAccountId: "s", amountCents: b.amountCents!, currency: "USD",
    status: "submitted" as const, simulated: true, rail: "simulated", createdAt: "t" };
  const a = await store.insertPaymentIfAbsent({ ...base, idempotencyKey: "k1", paymentId: "p1" });
  const c = await store.insertPaymentIfAbsent({ ...base, idempotencyKey: "k2", paymentId: "p2" });
  assert.equal(a.created, true);
  assert.equal(c.created, false);
  assert.equal(c.record.paymentId, "p1");
  assert.equal(tables.payrun_payments!.length, 1);
});

test("HTTP errors surface as StoreConstraintError without leaking the key", async () => {
  const store = new SupabaseStore({ url: "https://x.supabase.co", secretKey: KEY, fetchImpl: (async () => new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 403 })) as typeof fetch });
  await assert.rejects(store.listAudit(), (e: Error) => e.name === "StoreConstraintError" && /403 42501 permission denied/.test(e.message) && !e.message.includes(KEY));
});
