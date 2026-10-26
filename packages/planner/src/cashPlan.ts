// Weekly payment-run planner with a cash floor. Pure + deterministic.
import type { Bill, RhoSnapshot } from "../../rho/src/types.ts";
import { preflight, type BillCheck, type PreflightResult } from "../../preflight/src/run.ts";
import type { Finding } from "../../preflight/src/types.ts";

/** Bill statuses that still need money to go out. */
export const PAYABLE = new Set(["draft", "awaiting_approval", "ready_for_payment", "missing_payment_details", "failed_payment", "scheduled", "other"]);

export interface PlanOptions {
  asOf: string;            // YYYY-MM-DD, start of the run window
  windowDays?: number;     // default 7
  sourceAccountId: string; // Rho account that funds the run
  cashFloorCents: number;  // never plan below this balance
}

export interface PlannedBill extends BillCheck { dueDate: string | null; decision: "pay" | "hold"; holdReasons: string[] }

export interface PayRun {
  runId: string;
  asOf: string;
  windowEnd: string;
  sourceAccountId: string;
  cash: {
    startCents: number;
    committedOutflowsCents: number; // scheduled transactions releasing in the window from this account
    payCents: number;
    endCents: number;
    floorCents: number;
    expectedInflowsCents: number;   // open customer invoices due in window: reported, NOT counted (conservative)
  };
  bills: PlannedBill[];
  runFindings: Finding[];
  preflight: PreflightResult;
}

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

export function planRun(snapshot: RhoSnapshot, opts: PlanOptions): PayRun {
  const windowEnd = addDays(opts.asOf, (opts.windowDays ?? 7) - 1);
  const account = snapshot.accounts.find((a) => a.id === opts.sourceAccountId);
  if (!account) throw new Error(`source account ${opts.sourceAccountId} not found`);

  // In the run: payable bills due on/before the window end (past due included); undated bills are included so they surface as holds.
  const inRun: Bill[] = snapshot.bills.filter((b) => PAYABLE.has(b.status) && (!b.due_date || b.due_date <= windowEnd));
  const pf = preflight(snapshot, opts.asOf, inRun);

  const committed = snapshot.scheduled_transactions.filter((t) =>
    t.source_account.id === opts.sourceAccountId && !t.schedule.failed && t.schedule.next_release_date !== null &&
    t.schedule.next_release_date >= opts.asOf && t.schedule.next_release_date <= windowEnd);
  // a scheduled transaction tied to a bill in this run is that bill's payment: don't count it twice
  const runBillIds = new Set(inRun.map((b) => b.id));
  const committedCents = committed.filter((t) => !(t.bill && runBillIds.has(t.bill.id))).reduce((s, t) => s + t.amount.amount, 0);

  const inflows = snapshot.invoices.filter((i) => (i.status === "unpaid" || i.status === "overdue") && typeof i.due_date === "string" && i.due_date <= windowEnd);
  const inflowCents = inflows.reduce((s, i) => s + ((i.total as { amount: number } | undefined)?.amount ?? 0), 0);

  const start = account.balance.amount;
  let available = start - committedCents - opts.cashFloorCents;
  const runFindings: Finding[] = [...pf.runFindings];
  const byId = new Map(inRun.map((b) => [b.id, b]));

  // pay order: oldest due date first, then smaller amounts (more bills cleared under the floor)
  const ordered = [...pf.bills].sort((a, b) =>
    (byId.get(a.billId)?.due_date ?? "9999").localeCompare(byId.get(b.billId)?.due_date ?? "9999") || (a.amountCents ?? 0) - (b.amountCents ?? 0));

  let payCents = 0;
  const bills: PlannedBill[] = ordered.map((c) => {
    const findings = [...c.findings];
    const holdReasons = c.findings.filter((f) => f.severity === "block").map((f) => f.rule);
    let decision: "pay" | "hold" = c.pass && c.currency === account.balance.currency ? "pay" : "hold";
    if (c.pass && c.currency !== account.balance.currency) holdReasons.push("currency_differs_from_source_account");
    if (decision === "pay" && (c.amountCents ?? 0) > available) {
      decision = "hold";
      holdReasons.push("cash_floor");
      findings.push({ rule: "cash_floor", severity: "block", billId: c.billId,
        message: `Paying this bill would take ${account.account_name} below the cash floor of $${(opts.cashFloorCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} this week.`,
        evidence: [{ object: "account", id: account.id, field: "balance.amount", value: start },
                   { object: "run", id: "window", field: "committed_outflows_cents", value: committedCents }] });
    }
    if (decision === "pay") { available -= c.amountCents ?? 0; payCents += c.amountCents ?? 0; }
    return { ...c, findings, dueDate: byId.get(c.billId)?.due_date ?? null, decision, holdReasons };
  });

  if (start - committedCents < opts.cashFloorCents) runFindings.push({ rule: "floor_breached_by_schedule", severity: "block", billId: null,
    message: `Already-scheduled payments alone take ${account.account_name} below the cash floor this week.`,
    evidence: [{ object: "account", id: account.id, field: "balance.amount", value: start }] });

  return {
    runId: `run_${opts.asOf}_${pf.snapshotHash.slice(0, 12)}`,
    asOf: opts.asOf, windowEnd, sourceAccountId: account.id,
    cash: { startCents: start, committedOutflowsCents: committedCents, payCents, endCents: start - committedCents - payCents, floorCents: opts.cashFloorCents, expectedInflowsCents: inflowCents },
    bills, runFindings, preflight: pf,
  };
}
