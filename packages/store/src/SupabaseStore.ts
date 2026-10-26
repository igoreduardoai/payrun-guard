// Supabase store over the Data API (PostgREST, HTTPS). Server-side only.
// Needs a SECRET key (sb_secret_... / service role): RLS denies the public/anon key by design.
import type { PayRun } from "../../planner/src/cashPlan.ts";
import type { ApprovalClaims } from "../../rails/src/approval.ts";
import type { PaymentRecord } from "../../rails/src/PaymentRail.ts";
import { checkRows, paymentFromRow, paymentRow, runRow, StoreConstraintError, type AuditEvent, type DataSource, type Store, type StoredAudit } from "./Store.ts";

export interface SupabaseStoreOptions { url: string; secretKey: string; fetchImpl?: typeof fetch }

export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private base: string;
  private key: string;
  private f: typeof fetch;

  constructor(o: SupabaseStoreOptions) {
    if (!o.url || !o.secretKey) throw new Error("SupabaseStore: url and secret key required");
    if (o.secretKey.startsWith("sb_publishable_")) throw new Error("SupabaseStore: a publishable key cannot write (RLS); use the server secret key");
    this.base = o.url.replace(/\/$/, "") + "/rest/v1";
    this.key = o.secretKey;
    this.f = o.fetchImpl ?? fetch;
  }

  private async req(method: string, path: string, body?: unknown, prefer?: string): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = { apikey: this.key, "Content-Type": "application/json", Accept: "application/json" };
    if (!this.key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${this.key}`; // legacy JWT service key
    if (prefer) headers.Prefer = prefer;
    const res = await this.f(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (res.status >= 400 && res.status !== 409) {
      throw new StoreConstraintError(`Supabase ${method} ${path.split("?")[0]} -> ${res.status} ${data?.code ?? ""} ${data?.message ?? ""}`.trim());
    }
    return { status: res.status, data };
  }

  async saveRun(run: PayRun, source: DataSource) {
    await this.req("POST", "/payrun_runs?on_conflict=id", runRow(run, source), "resolution=ignore-duplicates,return=minimal");
    await this.req("POST", "/payrun_bill_checks?on_conflict=run_id,bill_id", checkRows(run), "resolution=merge-duplicates,return=minimal");
  }

  async getBillCheck(runId: string, billId: string) {
    const { data } = await this.req("GET", `/payrun_bill_checks?run_id=eq.${encodeURIComponent(runId)}&bill_id=eq.${encodeURIComponent(billId)}&select=decision,pass,check_hash,amount_cents`);
    const r = Array.isArray(data) ? data[0] : undefined;
    return r ? { decision: r.decision, pass: r.pass, checkHash: r.check_hash, amountCents: r.amount_cents === null ? null : Number(r.amount_cents) } : null;
  }

  async saveApproval(c: ApprovalClaims, tokenSha256: string) {
    await this.req("POST", "/payrun_approvals?on_conflict=token_sha256", {
      run_id: c.runId, bill_id: c.billId, amount_cents: c.amountCents, currency: c.currency, check_hash: c.checkHash,
      approver: c.approver, token_sha256: tokenSha256, expires_at: c.expiresAt }, "resolution=ignore-duplicates,return=minimal");
  }

  async hasApproval(tokenSha256: string) {
    const { data } = await this.req("GET", `/payrun_approvals?token_sha256=eq.${tokenSha256}&select=id&limit=1`);
    return Array.isArray(data) && data.length > 0;
  }

  async insertPaymentIfAbsent(rec: PaymentRecord) {
    const ins = await this.req("POST", "/payrun_payments?on_conflict=idempotency_key", paymentRow(rec), "resolution=ignore-duplicates,return=representation");
    if (ins.status < 300 && Array.isArray(ins.data) && ins.data.length === 1) return { record: paymentFromRow(ins.data[0]), created: true };
    // conflict: same key (ignored) or same (run, bill) with another key (409) -> return the existing row
    const q = `/payrun_payments?or=(idempotency_key.eq.${encodeURIComponent(rec.idempotencyKey)},and(run_id.eq.${encodeURIComponent(rec.runId)},bill_id.eq.${encodeURIComponent(rec.billId)}))&limit=1`;
    const { data } = await this.req("GET", q);
    if (!Array.isArray(data) || data.length === 0) throw new StoreConstraintError("payment insert conflicted but no existing row found");
    return { record: paymentFromRow(data[0]), created: false };
  }

  async listPayments(runId?: string) {
    const { data } = await this.req("GET", `/payrun_payments?select=*${runId ? `&run_id=eq.${encodeURIComponent(runId)}` : ""}&order=created_at.asc`);
    return (data as any[]).map(paymentFromRow);
  }

  async appendAudit(e: AuditEvent) {
    await this.req("POST", "/payrun_audit_log", { run_id: e.runId, bill_id: e.billId, actor: e.actor, event: e.event, detail: e.detail }, "return=minimal");
  }

  async listAudit(runId?: string): Promise<StoredAudit[]> {
    const { data } = await this.req("GET", `/payrun_audit_log?select=*${runId ? `&run_id=eq.${encodeURIComponent(runId)}` : ""}&order=id.asc`);
    return (data as any[]).map((r) => ({ id: Number(r.id), runId: r.run_id, billId: r.bill_id, actor: r.actor, event: r.event, detail: r.detail, createdAt: r.created_at }));
  }
}
