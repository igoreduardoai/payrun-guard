import { randomUUID } from "node:crypto";
import type { PaymentRail, PaymentRecord, PaymentRequest } from "./PaymentRail.ts";

/**
 * SIMULATED payment rail: records payment intents in memory (or a JSON file via the web app).
 * No money moves. Idempotent twice over:
 *  - same idempotencyKey -> same record returned
 *  - same billId in the same run -> same record returned (a double click with a fresh key still pays once)
 */
export class SimulatedRail implements PaymentRail {
  readonly name = "simulated";
  readonly simulated = true;
  private byKey = new Map<string, PaymentRecord>();
  private byBill = new Map<string, PaymentRecord>();

  constructor(seed: PaymentRecord[] = []) {
    for (const r of seed) { this.byKey.set(r.idempotencyKey, r); this.byBill.set(`${r.runId}:${r.billId}`, r); }
  }

  async pay(req: PaymentRequest): Promise<PaymentRecord> {
    const existing = this.byKey.get(req.idempotencyKey) ?? this.byBill.get(`${req.runId}:${req.billId}`);
    if (existing) {
      if (existing.amountCents !== req.amountCents || existing.billId !== req.billId) {
        throw new Error("idempotency conflict: same key/bill with a different amount or bill");
      }
      return existing;
    }
    const rec: PaymentRecord = { ...req, paymentId: `sim_${randomUUID()}`, status: "submitted", simulated: true, rail: this.name, createdAt: new Date().toISOString() };
    this.byKey.set(req.idempotencyKey, rec);
    this.byBill.set(`${req.runId}:${req.billId}`, rec);
    return rec;
  }

  async list(): Promise<PaymentRecord[]> { return [...this.byKey.values()]; }
}
