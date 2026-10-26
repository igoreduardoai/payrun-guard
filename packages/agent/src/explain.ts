// Text layer. An LLM (free tier, optional) may later rephrase these sentences for humans,
// but it never decides or changes amounts: verifyText() rejects any text whose dollar
// amounts or bill numbers are not present in the deterministic finding it explains.
import type { Finding } from "../../preflight/src/types.ts";

export function templateExplanation(findings: Finding[]): string {
  const blocks = findings.filter((f) => f.severity === "block");
  if (blocks.length === 0) return "All pre-flight checks passed. Ready for human approval.";
  return `Held: ${blocks.map((f) => f.message).join(" ")}`;
}

const MONEY = /\$\s?\d[\d,]*(?:\.\d{2})?/g;
const BILL_NO = /\b[A-Z]{2,5}-\d{4}-\d{4}\b/g;
const normMoney = (s: string) => s.replace(/[\s$,]/g, "").replace(/\.00$/, "");

/** True only if every $ amount and bill number in `text` appears in the source findings. */
export function verifyText(text: string, findings: Finding[]): { ok: boolean; unknown: string[] } {
  const source = findings.map((f) => f.message).join(" ");
  const allowedMoney = new Set((source.match(MONEY) ?? []).map(normMoney));
  const allowedBills = new Set(source.match(BILL_NO) ?? []);
  const unknown = [
    ...(text.match(MONEY) ?? []).filter((m) => !allowedMoney.has(normMoney(m))),
    ...(text.match(BILL_NO) ?? []).filter((b) => !allowedBills.has(b)),
  ];
  return { ok: unknown.length === 0, unknown };
}
