import { randomUUID } from "node:crypto";
import type { PaymentRail, PaymentRecord, PaymentRequest } from "./PaymentRail.ts";
import type { PaymentLedger } from "../../store/src/Store.ts";

/** Default in-process ledger (no constraints beyond idempotency). */
class InlineLedger implements PaymentLedger {
  private byKey = new Map<string, PaymentRecord>();
  async insertPaymentIfAbsent(rec: PaymentRecord) {
    const existing = this.byKey.get(rec.idempotencyKey) ?? [...this.byKey.values()].find((p) => p.runId === rec.runId && p.billId === rec.billId);
    if (existing) return { record: existing, created: false };
    this.byKey.set(rec.idempotencyKey, rec);
    return { record: rec, created: true };
  }
  async listPayments(runId?: string) { return [...this.byKey.values()].filter((p) => !runId || p.runId === runId); }
}

/**
 * SIMULATED payment rail: records payment intents in a ledger (memory or Supabase). No money moves.
 * Idempotent twice over: same idempotencyKey -> same record; same bill in the same run -> same record.
 */
export class SimulatedRail implements PaymentRail {
  readonly name = "simulated";
  readonly simulated = true;
  constructor(private ledger: PaymentLedger = new InlineLedger()) {}

  async payDetailed(req: PaymentRequest): Promise<{ record: PaymentRecord; created: boolean }> {
    const rec: PaymentRecord = { ...req, paymentId: `sim_${randomUUID()}`, status: "submitted", simulated: true, rail: this.name, createdAt: new Date().toISOString() };
    const out = await this.ledger.insertPaymentIfAbsent(rec);
    if (!out.created && (out.record.amountCents !== req.amountCents || out.record.billId !== req.billId)) {
      throw new Error("idempotency conflict: same key/bill with a different amount or bill");
    }
    return out;
  }

  async pay(req: PaymentRequest): Promise<PaymentRecord> { return (await this.payDetailed(req)).record; }
  async list(): Promise<PaymentRecord[]> { return this.ledger.listPayments(); }
}
