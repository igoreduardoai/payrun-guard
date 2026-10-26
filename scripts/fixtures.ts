// Save a snapshot of the Rho public sandbox (fictional data) for offline demo + tests.
import { mkdir, writeFile } from "node:fs/promises";
import { RhoClient } from "../packages/rho/src/client.ts";

const dir = process.argv[2] ?? `fixtures/rho-sandbox-${new Date().toISOString().slice(0, 10)}`;
const client = new RhoClient({
  baseUrl: process.env.RHO_API_BASE ?? "https://rhoapi-sandbox.rho.co/api/v1",
  token: process.env.RHO_API_TOKEN ?? "sandbox",
});
const snap = await client.snapshot();
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/snapshot.json`, JSON.stringify(snap, null, 2) + "\n");
console.log(`saved ${dir}/snapshot.json: ${snap.accounts.length} accounts, ${snap.bills.length} bills, ${snap.counterparties.length} counterparties, ${snap.scheduled_transactions.length} scheduled, ${snap.invoices.length} invoices`);
