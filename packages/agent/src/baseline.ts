// Baseline for the demo: a naive agent with NO gate pays every bill in the run at face value.
// We count how many of those payments the pre-flight checks would have stopped.
import type { PayRun } from "../../planner/src/cashPlan.ts";

export function naiveAgentBaseline(run: PayRun) {
  const attempted = run.bills.filter((b) => b.amountCents !== null && b.amountCents > 0);
  const improper = attempted.filter((b) => b.decision !== "pay");
  return {
    billsInRun: run.bills.length,
    naivePayments: attempted.length,
    naiveImproper: improper.length,
    naiveImproperCents: improper.reduce((s, b) => s + (b.amountCents ?? 0), 0),
    improper: improper.map((b) => ({ invoiceNumber: b.invoiceNumber, amountCents: b.amountCents, reasons: b.holdReasons })),
  };
}
