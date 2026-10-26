import { test } from "node:test";
import assert from "node:assert/strict";
import { RhoClient } from "../src/client.ts";

test("client follows next_page_token until exhausted", async () => {
  const seen: string[] = [];
  const fake = (async (url: URL | string) => {
    const u = new URL(String(url));
    seen.push(u.searchParams.get("page_token") ?? "-");
    const page = u.searchParams.get("page_token");
    const body = page === "p2" ? { bills: [{ id: "3" }], page: { next_page_token: null } } : { bills: [{ id: "1" }, { id: "2" }], page: { next_page_token: "p2" } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const c = new RhoClient({ token: "sandbox", fetchImpl: fake });
  const all = await c.listAll<{ id: string }>("/ap/bills", "bills");
  assert.deepEqual(all.map((x) => x.id), ["1", "2", "3"]);
  assert.deepEqual(seen, ["-", "p2"]);
});

test("client refuses to run without a token and surfaces HTTP errors", async () => {
  assert.throws(() => new RhoClient({ token: "" }), /token required/);
  const c = new RhoClient({ token: "x", fetchImpl: (async () => new Response("no", { status: 401 })) as typeof fetch });
  await assert.rejects(c.listAll("/accounts", "accounts"), /HTTP 401/);
});
