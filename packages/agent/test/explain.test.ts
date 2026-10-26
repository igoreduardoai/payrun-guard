import { test } from "node:test";
import assert from "node:assert/strict";
import { templateExplanation, verifyText } from "../src/explain.ts";
import type { Finding } from "../../preflight/src/types.ts";

const f: Finding[] = [{ rule: "line_sum_mismatch", severity: "block", billId: "b", evidence: [],
  message: "BILL-2026-0014: lines add up to $2,149.99 but the bill total is $2,150.00 (difference $0.01)." }];

test("template explanation is built only from finding text", () => {
  assert.match(templateExplanation(f), /^Held: BILL-2026-0014/);
  assert.equal(templateExplanation([]), "All pre-flight checks passed. Ready for human approval.");
});

test("verifyText accepts rephrasing with the same numbers", () => {
  assert.equal(verifyText("Hold BILL-2026-0014: total $2,150 vs lines $2,149.99.", f).ok, true);
});

test("verifyText rejects an invented amount or bill number", () => {
  const r = verifyText("Pay $2,500.00 on BILL-2026-0099 instead.", f);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ["$2,500.00", "BILL-2026-0099"]);
});
