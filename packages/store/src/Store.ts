import type { PayRun } from "../../planner/src/cashPlan.ts";
import type { ApprovalClaims } from "../../rails/src/approval.ts";
import type { PaymentRecord } from "../../rails/src/PaymentRail.ts";

export type DataSource = "rho_sandbox" | "fixtures" | "rho_production";

export interface AuditEvent {
  runId: string | null;
  billId: string | null;
  actor: string; // 'agent' | 'human:<name>' | 'system'
  event: "run_planned" | "approval_signed" | "payment_created" | "payment_duplicate" | "gate_refused";
  detail: Record<string, unknown>;
}

export interface StoredAudit extends AuditEvent { id: number; createdAt: string }

export interface PaymentLedger {
  /** Insert unless a payment with the same idempotency key or same (run, bill) exists; then return the existing one. */
  insertPaymentIfAbsent(rec: PaymentRecord): Promise<{ record: PaymentRecord; created: boolean }>;
  listPayments(runId?: string): Promise<PaymentRecord[]>;
}

export interface Store extends PaymentLedger {
  readonly kind: "memory" | "supabase";
  saveRun(run: PayRun, source: DataSource): Promise<void>;          // run + one bill_checks row per bill (idempotent)
  saveApproval(claims: ApprovalClaims, tokenSha256: string): Promise<void>;
  hasApproval(tokenSha256: string): Promise<boolean>;
  appendAudit(e: AuditEvent): Promise<void>;
  listAudit(runId?: string): Promise<StoredAudit[]>;
  getBillCheck(runId: string, billId: string): Promise<{ decision: "pay" | "hold"; pass: boolean; checkHash: string; amountCents: number | null } | null>;
}

export class StoreConstraintError extends Error { constructor(m: string) { super(m); this.name = "StoreConstraintError"; } }

export function runRow(run: PayRun, source: DataSource) {
  return { id: run.runId, as_of: run.asOf, window_end: run.windowEnd, source_account_id: run.sourceAccountId,
    snapshot_hash: run.preflight.snapshotHash, cash: run.cash, run_findings: run.runFindings, data_source: source };
}

export function checkRows(run: PayRun) {
  return run.bills.map((b) => ({ run_id: run.runId, bill_id: b.billId, invoice_number: b.invoiceNumber, vendor_id: b.vendorId,
    amount_cents: b.amountCents, currency: b.currency, pass: b.pass, decision: b.decision, hold_reasons: b.holdReasons,
    findings: b.findings, check_hash: b.checkHash, due_date: b.dueDate }));
}

export function paymentRow(p: PaymentRecord) {
  return { payment_id: p.paymentId, idempotency_key: p.idempotencyKey, run_id: p.runId, bill_id: p.billId, counterparty_id: p.counterpartyId,
    payment_method_id: p.paymentMethodId, source_account_id: p.sourceAccountId, amount_cents: p.amountCents, currency: p.currency,
    status: p.status, simulated: p.simulated, rail: p.rail, created_at: p.createdAt };
}

export function paymentFromRow(r: Record<string, any>): PaymentRecord {
  return { paymentId: r.payment_id, idempotencyKey: r.idempotency_key, runId: r.run_id, billId: r.bill_id, counterpartyId: r.counterparty_id,
    paymentMethodId: r.payment_method_id, sourceAccountId: r.source_account_id, amountCents: Number(r.amount_cents), currency: r.currency,
    status: r.status, simulated: r.simulated, rail: r.rail, createdAt: r.created_at };
}
