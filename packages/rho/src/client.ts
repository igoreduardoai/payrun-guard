import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RhoSnapshot } from "./types.ts";

export interface RhoClientOptions {
  baseUrl?: string; // default: Rho sandbox
  token?: string;   // read from env by the caller; never hard-code a real token
  fetchImpl?: typeof fetch;
}

const SANDBOX = "https://rhoapi-sandbox.rho.co/api/v1";

/** Read-only Rho REST client with cursor pagination (next_page_token). */
export class RhoClient {
  private baseUrl: string;
  private token: string;
  private fetchImpl: typeof fetch;

  constructor(opts: RhoClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? SANDBOX).replace(/\/$/, "");
    this.token = opts.token ?? "";
    if (!this.token) throw new Error("RhoClient: token required (use 'sandbox' for the public sandbox)");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** GET every page of a list endpoint and return the items under `key`. */
  async listAll<T>(path: string, key: string, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    let token: string | null = null;
    for (let i = 0; i < maxPages; i++) {
      const url = new URL(this.baseUrl + path);
      if (token) url.searchParams.set("page_token", token);
      const res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Rho ${path} -> HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      const items = body[key];
      if (!Array.isArray(items)) throw new Error(`Rho ${path}: missing array '${key}'`);
      out.push(...(items as T[]));
      const page = body["page"] as { next_page_token?: string | null } | undefined;
      token = page?.next_page_token ?? null;
      if (!token) return out;
    }
    throw new Error(`Rho ${path}: more than ${maxPages} pages`);
  }

  async snapshot(): Promise<RhoSnapshot> {
    const [accounts, bills, counterparties, scheduled_transactions, invoices] = await Promise.all([
      this.listAll<RhoSnapshot["accounts"][number]>("/accounts", "accounts"),
      this.listAll<RhoSnapshot["bills"][number]>("/ap/bills", "bills"),
      this.listAll<RhoSnapshot["counterparties"][number]>("/ap/counterparties", "counterparties"),
      this.listAll<RhoSnapshot["scheduled_transactions"][number]>("/scheduled-transactions", "scheduled_transactions"),
      this.listAll<RhoSnapshot["invoices"][number]>("/invoicing/invoices", "invoices"),
    ]);
    return { fetched_at: new Date().toISOString(), source: this.baseUrl, accounts, bills, counterparties, scheduled_transactions, invoices };
  }
}

/** Load a saved snapshot (offline demo + tests). */
export async function loadSnapshot(dir: string): Promise<RhoSnapshot> {
  return JSON.parse(await readFile(join(dir, "snapshot.json"), "utf8")) as RhoSnapshot;
}
