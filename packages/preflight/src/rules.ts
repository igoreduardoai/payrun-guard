// Deterministic pre-flight rules. No LLM here: every finding cites Rho object ids + field values.
import type { Bill, Counterparty } from "../../rho/src/types.ts";
import type { BillRule, Finding, RuleContext } from "./types.ts";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (b: Bill) => b.invoice_number ?? `bill ${b.id}`;
const W9_OK = new Set(["complete", "complete_externally"]);
const RECURRING = (f: string) => f !== "one_time";

function vendorOf(bill: Bill, ctx: RuleContext) {
  const id = bill.counterparty?.id;
  return id ? ctx.counterpartyById.get(id) : undefined;
}

function isUsVendor(c: Counterparty): boolean | null {
  const cc = c.registration_country_code ?? c.address?.country_code;
  if (!cc) return null; // unknown
  return cc === "US";
}

export const billComplete: BillRule = (bill) => {
  const missing: string[] = [];
  if (!bill.amount) missing.push("amount");
  if (!bill.due_date) missing.push("due_date");
  if (!bill.invoice_number) missing.push("invoice_number");
  if (missing.length === 0) return [];
  return [{
    rule: "bill_incomplete", severity: "block", billId: bill.id,
    message: `${label(bill)} is missing ${missing.join(", ")}.`,
    evidence: missing.map((f) => ({ object: "bill", id: bill.id, field: f, value: null })),
  }];
};

export const amountValid: BillRule = (bill) => {
  if (!bill.amount) return [];
  if (!Number.isInteger(bill.amount.amount) || bill.amount.amount <= 0) {
    return [{ rule: "amount_invalid", severity: "block", billId: bill.id,
      message: `${label(bill)} has a non-positive or non-integer amount.`,
      evidence: [{ object: "bill", id: bill.id, field: "amount.amount", value: bill.amount.amount }] }];
  }
  return [];
};

export const knownStatus: BillRule = (bill) => {
  if (bill.status !== "other") return [];
  return [{ rule: "status_unrecognized", severity: "block", billId: bill.id,
    message: `${label(bill)} is in a state the API reports as 'other'; confirm it in Rho before paying.`,
    evidence: [{ object: "bill", id: bill.id, field: "status", value: bill.status }] }];
};

export const vendorPresent: BillRule = (bill, ctx) => {
  if (!bill.counterparty?.id) {
    return [{ rule: "vendor_missing", severity: "block", billId: bill.id,
      message: `${label(bill)} has no vendor (payee) attached.`,
      evidence: [{ object: "bill", id: bill.id, field: "counterparty", value: null }] }];
  }
  if (!vendorOf(bill, ctx)) {
    return [{ rule: "vendor_unknown", severity: "block", billId: bill.id,
      message: `${label(bill)} points to a vendor id not found in AP counterparties.`,
      evidence: [{ object: "bill", id: bill.id, field: "counterparty.id", value: bill.counterparty.id }] }];
  }
  return [];
};

export const vendorActive: BillRule = (bill, ctx) => {
  const v = vendorOf(bill, ctx);
  if (!v || v.status === "active") return [];
  return [{ rule: "vendor_not_active", severity: "block", billId: bill.id,
    message: `${label(bill)}: vendor ${v.legal_name} is '${v.status}', not active.`,
    evidence: [{ object: "counterparty", id: v.id, field: "status", value: v.status }] }];
};

export const paymentMethodPresent: BillRule = (bill, ctx) => {
  const v = vendorOf(bill, ctx);
  if (!v || v.payment_methods.length > 0) return [];
  return [{ rule: "payment_method_missing", severity: "block", billId: bill.id,
    message: `${label(bill)}: vendor ${v.legal_name} has no payment method on file.`,
    evidence: [{ object: "counterparty", id: v.id, field: "payment_methods", value: [] }] }];
};

export const w9Present: BillRule = (bill, ctx) => {
  const v = vendorOf(bill, ctx);
  if (!v) return [];
  const us = isUsVendor(v);
  if (us === false) return []; // non-US vendors use W-8 forms; W-9 rule does not apply
  if (v.w9_status && W9_OK.has(v.w9_status)) return [];
  const pending = v.w9_status === "sent_pending";
  return [{ rule: pending ? "w9_pending" : "w9_missing", severity: pending ? "warn" : "block", billId: bill.id,
    message: pending
      ? `${label(bill)}: W-9 for ${v.legal_name} was requested but not received yet.`
      : `${label(bill)}: no W-9 on file for ${v.legal_name}${us === null ? " (country not recorded)" : ""}.`,
    evidence: [{ object: "counterparty", id: v.id, field: "w9_status", value: v.w9_status ?? null }] }];
};

export const linesMatchTotal: BillRule = (bill) => {
  const lines = bill.lines ?? [];
  if (!bill.amount || lines.length === 0) return [];
  const out: Finding[] = [];
  const badCcy = lines.filter((l) => l.amount.currency !== bill.amount!.currency);
  if (badCcy.length) out.push({ rule: "line_currency_mismatch", severity: "block", billId: bill.id,
    message: `${label(bill)} mixes currencies across lines.`,
    evidence: badCcy.map((l) => ({ object: "bill" as const, id: bill.id, field: `lines[${l.index}].amount.currency`, value: l.amount.currency })) });
  const sum = lines.reduce((s, l) => s + l.amount.amount, 0);
  if (sum !== bill.amount.amount) out.push({ rule: "line_sum_mismatch", severity: "block", billId: bill.id,
    message: `${label(bill)}: lines add up to ${usd(sum)} but the bill total is ${usd(bill.amount.amount)} (difference ${usd(bill.amount.amount - sum)}).`,
    evidence: [{ object: "bill", id: bill.id, field: "amount.amount", value: bill.amount.amount },
               { object: "bill", id: bill.id, field: "sum(lines.amount)", value: sum }] });
  return out;
};

export const dueDate: BillRule = (bill, ctx) => {
  if (!bill.due_date || bill.due_date >= ctx.asOf) return [];
  const days = Math.round((Date.parse(ctx.asOf) - Date.parse(bill.due_date)) / 86_400_000);
  return [{ rule: "past_due", severity: "warn", billId: bill.id,
    message: `${label(bill)} was due ${bill.due_date} (${days} day${days === 1 ? "" : "s"} late).`,
    evidence: [{ object: "bill", id: bill.id, field: "due_date", value: bill.due_date }] }];
};

export const failedPaymentRetry: BillRule = (bill) => {
  if (bill.status !== "failed_payment") return [];
  return [{ rule: "previous_payment_failed", severity: "block", billId: bill.id,
    message: `${label(bill)}: the last payment failed; confirm the vendor's bank details before retrying.`,
    evidence: [{ object: "bill", id: bill.id, field: "status", value: bill.status }] }];
};

export const scheduledWithoutDate: BillRule = (bill) => {
  if (bill.status !== "scheduled" || bill.payment_date) return [];
  return [{ rule: "scheduled_without_date", severity: "warn", billId: bill.id,
    message: `${label(bill)} is marked scheduled but has no payment date.`,
    evidence: [{ object: "bill", id: bill.id, field: "payment_date", value: null }] }];
};

/** A scheduled transaction already pays this bill: paying it again in this run would pay twice. */
export const alreadyScheduled: BillRule = (bill, ctx) => {
  const t = ctx.snapshot.scheduled_transactions.find((x) => x.bill?.id === bill.id && !x.schedule.failed);
  if (!t) return [];
  return [{ rule: "already_scheduled", severity: "block", billId: bill.id,
    message: `${label(bill)} is already set to be paid by a scheduled ${t.payment_type} of ${usd(t.amount.amount)} (release ${t.schedule.next_release_date ?? "date not set"}); paying it again would pay twice.`,
    evidence: [{ object: "scheduled_transaction", id: t.id, field: "bill.id", value: bill.id },
               { object: "scheduled_transaction", id: t.id, field: "source_account.id", value: t.source_account.id }] }];
};

/** Duplicate: same vendor + same normalized invoice number (block), or same vendor + same amount within 30 days (warn). */
export const duplicateBill: BillRule = (bill, ctx) => {
  if (!bill.counterparty?.id || !bill.amount) return [];
  const norm = (s?: string) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const out: Finding[] = [];
  for (const other of ctx.snapshot.bills) {
    if (other.id === bill.id || other.status === "archived" || other.counterparty?.id !== bill.counterparty.id) continue;
    if (bill.invoice_number && norm(other.invoice_number) === norm(bill.invoice_number)) {
      out.push({ rule: "duplicate_invoice_number", severity: "block", billId: bill.id,
        message: `${label(bill)} has the same invoice number as another bill from the same vendor (${other.id}, status ${other.status}).`,
        evidence: [{ object: "bill", id: bill.id, field: "invoice_number", value: bill.invoice_number },
                   { object: "bill", id: other.id, field: "invoice_number", value: other.invoice_number }] });
      continue;
    }
    if (other.amount?.amount === bill.amount.amount && bill.invoice_date && other.invoice_date) {
      const gap = Math.abs(Date.parse(bill.invoice_date) - Date.parse(other.invoice_date)) / 86_400_000;
      if (gap <= 30) out.push({ rule: "possible_duplicate_amount", severity: "warn", billId: bill.id,
        message: `${label(bill)} has the same vendor and amount (${usd(bill.amount.amount)}) as ${label(other)} within ${Math.round(gap)} days.`,
        evidence: [{ object: "bill", id: other.id, field: "amount.amount", value: other.amount?.amount }] });
    }
  }
  return out;
};

/** Vendor also paid by an active recurring schedule: risk of paying twice. */
export const recurringOverlapForBill: BillRule = (bill, ctx) => {
  if (!bill.counterparty?.id) return [];
  const rec = ctx.snapshot.scheduled_transactions.filter((t) =>
    t.counterparty.id === bill.counterparty!.id && RECURRING(t.schedule.frequency) && !t.schedule.failed && t.bill === null);
  if (rec.length === 0) return [];
  return [{ rule: "vendor_has_recurring_payment", severity: "warn", billId: bill.id,
    message: `${label(bill)}: this vendor is also paid by ${rec.length} recurring payment${rec.length > 1 ? "s" : ""} (${rec.map((t) => `${usd(t.amount.amount)} ${t.schedule.frequency}`).join(", ")}); check this bill is not already covered.`,
    evidence: rec.map((t) => ({ object: "scheduled_transaction" as const, id: t.id, field: "amount.amount", value: t.amount.amount })) }];
};

export const BILL_RULES: BillRule[] = [
  billComplete, amountValid, knownStatus, vendorPresent, vendorActive, paymentMethodPresent, w9Present,
  linesMatchTotal, dueDate, failedPaymentRetry, scheduledWithoutDate, alreadyScheduled, duplicateBill, recurringOverlapForBill,
];

/** Run-level: two or more active recurring schedules to the same vendor (e.g. two monthly ACH to one payee). */
export function recurringDuplicates(ctx: RuleContext): Finding[] {
  const byVendor = new Map<string, typeof ctx.snapshot.scheduled_transactions>();
  for (const t of ctx.snapshot.scheduled_transactions) {
    if (!RECURRING(t.schedule.frequency) || t.schedule.failed) continue;
    const list = byVendor.get(t.counterparty.id) ?? [];
    list.push(t);
    byVendor.set(t.counterparty.id, list);
  }
  const out: Finding[] = [];
  for (const [, list] of byVendor) {
    if (list.length < 2) continue;
    out.push({ rule: "recurring_overlap", severity: "warn", billId: null,
      message: `${list[0]!.counterparty.name} has ${list.length} active recurring payments (${list.map((t) => `${usd(t.amount.amount)} ${t.schedule.frequency} ${t.payment_type}`).join(" + ")}). Confirm both are intended.`,
      evidence: list.map((t) => ({ object: "scheduled_transaction" as const, id: t.id, field: "amount.amount", value: t.amount.amount })) });
  }
  for (const t of ctx.snapshot.scheduled_transactions) {
    if (t.schedule.failed) out.push({ rule: "scheduled_payment_failed", severity: "warn", billId: null,
      message: `Scheduled ${t.schedule.frequency} ${t.payment_type} of ${usd(t.amount.amount)} to ${t.counterparty.name} is marked failed (next release: ${t.schedule.next_release_date ?? "none"}).`,
      evidence: [{ object: "scheduled_transaction", id: t.id, field: "schedule.failed", value: true }] });
  }
  return out;
}
