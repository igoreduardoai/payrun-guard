import type { Bill, Counterparty, RhoSnapshot } from "../../rho/src/types.ts";

export type Severity = "block" | "warn";

export interface Evidence {
  object: "bill" | "counterparty" | "scheduled_transaction" | "account" | "run";
  id: string;
  field: string;
  value: unknown;
}

export interface Finding {
  rule: string;
  severity: Severity;
  billId: string | null; // null = run-level finding
  message: string;       // deterministic text; an LLM may rephrase it later, never change numbers
  evidence: Evidence[];
}

export interface RuleContext {
  snapshot: RhoSnapshot;
  asOf: string; // YYYY-MM-DD
  counterpartyById: Map<string, Counterparty>;
}

export type BillRule = (bill: Bill, ctx: RuleContext) => Finding[];
