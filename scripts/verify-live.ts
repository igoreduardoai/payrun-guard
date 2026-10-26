// Live verification of the Supabase schema over HTTPS (Data API). Prints PASS/FAIL, never keys.
// Needs SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY). Run `npm run db:smoke` first.
try { process.loadEnvFile(); } catch { /* no .env */ }
const url = process.env.SUPABASE_URL!.replace(/\/$/, "") + "/rest/v1";
const secret = process.env.SUPABASE_SECRET_KEY!;
const pub = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
if (!url || !secret || !pub) { console.error("missing env"); process.exit(2); }
const TABLES = ["payrun_runs", "payrun_bill_checks", "payrun_approvals", "payrun_payments", "payrun_audit_log"];

async function call(key: string, method: string, path: string, body?: unknown, prefer?: string) {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json", Accept: "application/json" };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, body: j };
}
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`); };
const code = (r: { status: number; body: any }) => `HTTP ${r.status}${r.body?.code ? " " + r.body.code : ""}${r.body?.message ? ": " + String(r.body.message).slice(0, 90) : ""}`;

// 1. tables exist (secret key)
for (const t of TABLES) { const r = await call(secret, "GET", `/${t}?select=*&limit=1`); check(`table ${t} exists`, r.status === 200, code(r)); }

// 2. publishable key: no read, no write
for (const t of TABLES) {
  const r = await call(pub, "GET", `/${t}?select=*&limit=1`);
  const leaked = r.status === 200 && Array.isArray(r.body) && r.body.length > 0;
  check(`publishable key cannot read ${t}`, r.status >= 400 || (r.status === 200 && !leaked), code(r));
}
{
  const r = await call(pub, "POST", "/payrun_audit_log", { actor: "anon", event: "run_planned", detail: {} }, "return=minimal");
  check("publishable key cannot insert into payrun_audit_log", r.status >= 400, code(r));
}

// fixtures from the smoke run
const pay = await call(secret, "GET", "/payrun_payments?select=*&order=created_at.asc&limit=1");
const p = Array.isArray(pay.body) ? pay.body[0] : undefined;
if (!p) { check("smoke payment present (run db:smoke first)", false, code(pay)); process.exit(1); }
check("smoke payment present", true, `run ${p.run_id}`);

// 3. one payment per bill per run + unique idempotency key
{
  const dupBill = await call(secret, "POST", "/payrun_payments", { ...p, payment_id: `verify_${Date.now()}_a`, idempotency_key: `verify_${Date.now()}_k` }, "return=minimal");
  check("second payment for same (run, bill) with a new key is rejected", dupBill.status === 409 && dupBill.body?.code === "23505", code(dupBill));
  const dupKey = await call(secret, "POST", "/payrun_payments", { ...p, payment_id: `verify_${Date.now()}_b` }, "return=minimal");
  check("payment with a reused idempotency key is rejected", dupKey.status === 409 && dupKey.body?.code === "23505", code(dupKey));
  const zero = await call(secret, "POST", "/payrun_payments", { ...p, payment_id: `verify_${Date.now()}_c`, idempotency_key: `verify_${Date.now()}_z`, bill_id: "verify-none", amount_cents: 0 }, "return=minimal");
  check("payment with amount 0 is rejected", zero.status === 400 && zero.body?.code === "23514", code(zero));
  const orphan = await call(secret, "POST", "/payrun_payments", { ...p, payment_id: `verify_${Date.now()}_d`, idempotency_key: `verify_${Date.now()}_o`, bill_id: "verify-none" }, "return=minimal");
  check("payment for a bill that was never checked is rejected (FK)", orphan.status === 409 && orphan.body?.code === "23503", code(orphan));
  const orphanAppr = await call(secret, "POST", "/payrun_approvals", { run_id: p.run_id, bill_id: "verify-none", amount_cents: 1, currency: "USD", check_hash: "x", approver: "v", token_sha256: "0".repeat(64), expires_at: "2099-01-01T00:00:00Z" }, "return=minimal");
  check("approval for a bill that was never checked is rejected (FK)", orphanAppr.status === 409 && orphanAppr.body?.code === "23503", code(orphanAppr));
}

// 4. pay_requires_pass check constraint
{
  const r = await call(secret, "POST", "/payrun_bill_checks", { run_id: p.run_id, bill_id: `verify-${Date.now()}`, pass: false, decision: "pay", check_hash: "x" }, "return=minimal");
  check("bill check with decision=pay and pass=false is rejected", r.status === 400 && r.body?.code === "23514", code(r));
}

// 5. audit log + payments immutable (update/delete refused, even with the secret key)
const audit = await call(secret, "GET", `/payrun_audit_log?select=id,event&run_id=eq.${encodeURIComponent(p.run_id)}&order=id.asc&limit=1`);
const a = Array.isArray(audit.body) ? audit.body[0] : undefined;
if (a) {
  const up = await call(secret, "PATCH", `/payrun_audit_log?id=eq.${a.id}`, { event: "tampered" }, "return=representation");
  check("audit log UPDATE refused", up.status >= 400, code(up));
  const del = await call(secret, "DELETE", `/payrun_audit_log?id=eq.${a.id}`, undefined, "return=representation");
  check("audit log DELETE refused", del.status >= 400, code(del));
  const still = await call(secret, "GET", `/payrun_audit_log?select=event&id=eq.${a.id}`);
  check("audit row unchanged after attempts", Array.isArray(still.body) && still.body[0]?.event === a.event, `event=${still.body?.[0]?.event}`);
} else check("audit row present", false, code(audit));
{
  const up = await call(secret, "PATCH", `/payrun_payments?payment_id=eq.${encodeURIComponent(p.payment_id)}`, { amount_cents: 1 }, "return=representation");
  check("payment UPDATE refused", up.status >= 400, code(up));
  const del = await call(secret, "DELETE", `/payrun_payments?payment_id=eq.${encodeURIComponent(p.payment_id)}`, undefined, "return=representation");
  check("payment DELETE refused", del.status >= 400, code(del));
}

// 6. approvals: hash only
{
  const r = await call(secret, "GET", "/payrun_approvals?select=*");
  const rows: any[] = Array.isArray(r.body) ? r.body : [];
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const tokenish = cols.filter((c) => /token/.test(c) && c !== "token_sha256");
  check("approvals have rows", rows.length > 0, `${rows.length} rows`);
  check("approvals store token_sha256 only (no raw token column)", cols.includes("token_sha256") && tokenish.length === 0, `columns: ${cols.join(",")}`);
  check("every token_sha256 is 64 hex chars", rows.every((x) => /^[0-9a-f]{64}$/.test(x.token_sha256)), `${rows.length} checked`);
  check("no stored value looks like a signed token (base64url.base64url)", rows.every((x) => !Object.values(x).some((v) => typeof v === "string" && /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(v))), "scanned all columns");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
process.exit(failed.length ? 1 : 0);
