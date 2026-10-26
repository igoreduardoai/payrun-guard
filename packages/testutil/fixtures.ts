import { readFileSync } from "node:fs";
import type { Bill, RhoSnapshot } from "../rho/src/types.ts";

export const FIXTURE_DIR = "fixtures/rho-sandbox-2026-10-26";
export function loadFixture(): RhoSnapshot {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}/snapshot.json`, "utf8")) as RhoSnapshot;
}
export function billByNumber(s: RhoSnapshot, n: string): Bill {
  const b = s.bills.find((x) => x.invoice_number === n);
  if (!b) throw new Error(`fixture bill ${n} not found`);
  return b;
}
export const ACME = "90000000-0000-4000-8000-000000000001";
export const PRIMARY_CHECKING = "30000000-0000-4000-8000-000000000006";
