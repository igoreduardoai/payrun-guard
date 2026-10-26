// Static checks on the SQL migration (the schema itself is applied with the Supabase CLI / SQL editor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = "supabase/migrations";
const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n").toLowerCase();
const TABLES = ["payrun_runs", "payrun_bill_checks", "payrun_approvals", "payrun_payments", "payrun_audit_log"];

test("every table is created with row-level security enabled", () => {
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`create table public\\.${t} \\(`));
    assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`));
  }
});

test("anon gets nothing; no policy targets anon", () => {
  assert.ok(!/grant [^;]* to [^;]*\banon\b/.test(sql));
  assert.ok(!/create policy [^;]* to anon/.test(sql));
  assert.match(sql, /revoke all on [^;]* from anon, authenticated/);
});

test("idempotency and one-payment-per-bill are enforced by unique constraints", () => {
  assert.match(sql, /idempotency_key\s+text not null unique/);
  assert.match(sql, /unique \(run_id, bill_id\)/);
  assert.match(sql, /constraint pay_requires_pass check \(decision = 'hold' or pass\)/);
});

test("approval tokens stored as hash; audit log and payments are append-only", () => {
  assert.match(sql, /token_sha256 text not null unique/);
  assert.ok(!/\btoken\s+text/.test(sql));
  assert.match(sql, /before update or delete on public\.payrun_audit_log/);
  assert.match(sql, /before update or delete on public\.payrun_payments/);
});
