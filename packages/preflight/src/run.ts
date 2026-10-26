import { createHash } from "node:crypto";
import type { Bill, RhoSnapshot } from "../../rho/src/types.ts";
import { BILL_RULES, recurringDuplicates } from "./rules.ts";
import type { Finding, RuleContext } from "./types.ts";

export interface BillCheck {
  billId: string;
  invoiceNumber: string | null;
  vendorId: string | null;
  amountCents: number | null;
  currency: string | null;
  pass: boolean;          // true = no blocking finding
  findings: Finding[];
  checkHash: string;      // binds an approval to exactly this bill state + result
}

export interface PreflightResult {
  asOf: string;
  snapshotHash: string;
  bills: BillCheck[];
  runFindings: Finding[];
}

export function hashJson(x: unknown): string {
  return createHash("sha256").update(JSON.stringify(x)).digest("hex");
}

export function buildContext(snapshot: RhoSnapshot, asOf: string): RuleContext {
  return { snapshot, asOf, counterpartyById: new Map(snapshot.counterparties.map((c) => [c.id, c])) };
}

export function checkBill(bill: Bill, ctx: RuleContext): BillCheck {
  const findings = BILL_RULES.flatMap((r) => r(bill, ctx));
  const pass = !findings.some((f) => f.severity === "block");
  const vendor = bill.counterparty?.id ? ctx.counterpartyById.get(bill.counterparty.id) : undefined;
  return {
    billId: bill.id,
    invoiceNumber: bill.invoice_number ?? null,
    vendorId: bill.counterparty?.id ?? null,
    amountCents: bill.amount?.amount ?? null,
    currency: bill.amount?.currency ?? null,
    pass,
    findings,
    checkHash: hashJson({ bill, vendor: vendor ?? null, pass, rules: findings.map((f) => f.rule) }),
  };
}

export function preflight(snapshot: RhoSnapshot, asOf: string, bills: Bill[] = snapshot.bills): PreflightResult {
  const ctx = buildContext(snapshot, asOf);
  return {
    asOf,
    snapshotHash: hashJson({ bills: snapshot.bills, counterparties: snapshot.counterparties, scheduled: snapshot.scheduled_transactions }),
    bills: bills.map((b) => checkBill(b, ctx)),
    runFindings: recurringDuplicates(ctx),
  };
}
