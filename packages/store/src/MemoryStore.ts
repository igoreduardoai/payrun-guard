// Offline store (Hack Fair fallback). Mirrors the SQL constraints of the Supabase schema.
import type { PayRun } from "../../planner/src/cashPlan.ts";
import type { ApprovalClaims } from "../../rails/src/approval.ts";
import type { PaymentRecord } from "../../rails/src/PaymentRail.ts";
import { checkRows, runRow, StoreConstraintError, type AuditEvent, type DataSource, type Store, type StoredAudit } from "./Store.ts";

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  runs = new Map<string, ReturnType<typeof runRow>>();
  checks = new Map<string, ReturnType<typeof checkRows>[number]>();
  approvals: (ApprovalClaims & { tokenSha256: string })[] = [];
  private payments = new Map<string, PaymentRecord>(); // by idempotency key
  private audit: StoredAudit[] = [];

  async saveRun(run: PayRun, source: DataSource) {
    if (!this.runs.has(run.runId)) this.runs.set(run.runId, runRow(run, source));
    for (const c of checkRows(run)) {
      if (c.decision === "pay" && !c.pass) throw new StoreConstraintError("pay_requires_pass");
      this.checks.set(`${c.run_id}:${c.bill_id}`, c);
    }
  }

  async getBillCheck(runId: string, billId: string) {
    const c = this.checks.get(`${runId}:${billId}`);
    return c ? { decision: c.decision, pass: c.pass, checkHash: c.check_hash, amountCents: c.amount_cents } : null;
  }

  async saveApproval(claims: ApprovalClaims, tokenSha256: string) {
    if (!this.checks.has(`${claims.runId}:${claims.billId}`)) throw new StoreConstraintError("approval references unknown bill check");
    if (this.approvals.some((a) => a.tokenSha256 === tokenSha256)) return; // unique token hash
    this.approvals.push({ ...claims, tokenSha256 });
  }

  async hasApproval(tokenSha256: string) { return this.approvals.some((a) => a.tokenSha256 === tokenSha256); }

  async insertPaymentIfAbsent(rec: PaymentRecord) {
    if (!this.checks.has(`${rec.runId}:${rec.billId}`)) throw new StoreConstraintError("payment references unknown bill check");
    if (rec.amountCents <= 0) throw new StoreConstraintError("amount_cents must be > 0");
    const existing = this.payments.get(rec.idempotencyKey) ?? [...this.payments.values()].find((p) => p.runId === rec.runId && p.billId === rec.billId);
    if (existing) return { record: existing, created: false };
    this.payments.set(rec.idempotencyKey, rec);
    return { record: rec, created: true };
  }

  async listPayments(runId?: string) { return [...this.payments.values()].filter((p) => !runId || p.runId === runId); }

  async appendAudit(e: AuditEvent) { this.audit.push({ ...e, id: this.audit.length + 1, createdAt: new Date().toISOString() }); }
  async listAudit(runId?: string) { return this.audit.filter((a) => !runId || a.runId === runId); }
}
