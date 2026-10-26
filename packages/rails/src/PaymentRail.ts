// A payment rail moves money. Today the only implementation is SIMULATED:
// the public Rho API is read-only, and Rho's early-access payments SDK is not wired in yet.
export interface PaymentRequest {
  idempotencyKey: string;
  runId: string;
  billId: string;
  counterpartyId: string;
  paymentMethodId: string;
  sourceAccountId: string;
  amountCents: number;
  currency: string;
}

export interface PaymentRecord extends PaymentRequest {
  paymentId: string;
  status: "submitted";
  simulated: boolean; // true = no real money moved
  rail: string;
  createdAt: string;
}

export interface PaymentRail {
  readonly name: string;
  readonly simulated: boolean;
  pay(req: PaymentRequest): Promise<PaymentRecord>;
  /** Optional: also report whether a new payment was created (false = idempotent replay). */
  payDetailed?(req: PaymentRequest): Promise<{ record: PaymentRecord; created: boolean }>;
  list(): Promise<PaymentRecord[]>;
}
