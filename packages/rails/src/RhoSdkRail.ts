import type { PaymentRail, PaymentRecord, PaymentRequest } from "./PaymentRail.ts";

/** Placeholder until Rho's early-access payments SDK is available to this project. Always throws. */
export class RhoSdkRail implements PaymentRail {
  readonly name = "rho_sdk";
  readonly simulated = false;
  async pay(_req: PaymentRequest): Promise<PaymentRecord> {
    throw new Error("RhoSdkRail not available: Rho early-access SDK not connected yet (use PAYMENT_RAIL=simulated)");
  }
  async list(): Promise<PaymentRecord[]> { return []; }
}
