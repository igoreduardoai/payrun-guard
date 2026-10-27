import { test } from "node:test";
import assert from "node:assert/strict";
import { planRun } from "../../planner/src/cashPlan.ts";
import { MemoryStore } from "../../store/src/MemoryStore.ts";
import { PayRunService } from "../../store/src/PayRunService.ts";
import { loadFixture, PRIMARY_CHECKING } from "../../testutil/fixtures.ts";
import { runAgent } from "../src/loop.ts";
import { LlmPlanner, plannerFromEnv, RulePlanner, type Observation, type Planner, type PlannerOutput } from "../src/planners.ts";
import { ApproveAll, DenyAll, type ApprovalRequest, type HumanApprover } from "../src/toolbox.ts";
import { naiveAgentBaseline } from "../src/baseline.ts";

const SECRET = "test-secret-not-real-0123456789";
const snap = loadFixture();
async function setup(floor = 250_000) {
  const run = planRun(snap, { asOf: "2026-08-27", sourceAccountId: PRIMARY_CHECKING, cashFloorCents: floor });
  const store = new MemoryStore();
  const svc = new PayRunService(store, SECRET, snap.counterparties);
  await svc.recordRun(run, "fixtures");
  return { run, svc, store };
}
const bill = (run: Awaited<ReturnType<typeof setup>>["run"], n: string) => run.bills.find((b) => b.invoiceNumber === n)!;

/** Replays a fixed list of turns: stands in for an LLM (good or adversarial). */
class Scripted implements Planner {
  readonly kind = "llm" as const; readonly label = "scripted";
  seen: Observation[][] = [];
  constructor(private turns: PlannerOutput[]) {}
  async next(obs: Observation[]) { this.seen.push(obs); return this.turns.shift() ?? { kind: "finish", summary: "" }; }
}
const call = (tool: string, args: Record<string, unknown> = {}) => ({ id: `${tool}-${Math.random()}`, tool, args });

test("rule planner: full loop pays exactly the 3 passing bills after human approval, holds 10", async () => {
  const { run, svc, store } = await setup();
  const r = await runAgent(run, svc, new RulePlanner(), new ApproveAll());
  assert.equal(r.status, "finished");
  assert.deepEqual(r.trace.map((s) => s.tool), ["get_run", "preflight_payment", "request_approval", "pay", "pay", "pay"]);
  assert.equal(r.paid.length, 3);
  assert.equal(r.held.length, 10);
  assert.ok(r.paid.every((p) => p.simulated && bill(run, p.invoiceNumber!).decision === "pay"));
  assert.equal(r.paid.reduce((s, p) => s + p.amountCents, 0), run.cash.payCents);
  assert.ok(r.trace.filter((s) => s.tool === "pay").every((s) => s.postVerify === "pass"));
  const audit = await store.listAudit(run.runId);
  assert.equal(audit.filter((a) => a.event === "approval_signed").length, 3);
  assert.equal(audit.filter((a) => a.event === "payment_created" && a.actor === "agent").length, 3);
});

test("human denies: agent pays nothing", async () => {
  const { run, svc } = await setup();
  const r = await runAgent(run, svc, new RulePlanner(), new DenyAll());
  assert.equal(r.paid.length, 0);
  assert.equal(r.deniedByHuman.length, 3);
  assert.equal(r.trace.some((s) => s.tool === "pay"), false);
});

test("human approval requests carry only passing bills; planner never sees a token", async () => {
  const { run, svc } = await setup();
  let seen: ApprovalRequest[] = [];
  const human: HumanApprover = { name: "lead", review: async (reqs) => { seen = reqs; return Object.fromEntries(reqs.map((x) => [x.billId, true])); } };
  const p = new Scripted([
    { kind: "tools", calls: [call("get_run")] },
    { kind: "tools", calls: [call("request_approval", { billIds: run.bills.map((b) => b.billId) })] },
  ]);
  await runAgent(run, svc, p, human);
  assert.equal(seen.length, 3);
  const everything = JSON.stringify(p.seen);
  assert.equal(/approval_?token|\.[A-Za-z0-9_-]{40,}/.test(everything.replace(/"note":"[^"]*"/g, "")), false);
  const notApprovable = (p.seen[2]![0]!.result.notApprovable as unknown[]).length;
  assert.equal(notApprovable, 10);
});

test("adversarial planner: every unsafe move is refused, zero improper payments", async () => {
  const { run, svc, store } = await setup();
  const held = bill(run, "BILL-2026-0013"), dup = bill(run, "BILL-2026-0012"), ok = bill(run, "BILL-2026-0017");
  const p = new Scripted([
    { kind: "tools", calls: [call("pay", { billId: ok.billId, amountCents: ok.amountCents })] },                 // before preflight
    { kind: "tools", calls: [call("get_run"), call("preflight_payment", { billIds: [held.billId, dup.billId, ok.billId] })] },
    { kind: "tools", calls: [call("pay", { billId: held.billId, amountCents: held.amountCents }),                // held bill
                             call("pay", { billId: dup.billId, amountCents: dup.amountCents }),                  // would pay twice
                             call("pay", { billId: ok.billId, amountCents: ok.amountCents })] },                  // no human approval yet
    { kind: "tools", calls: [call("request_approval", { billIds: [ok.billId] })] },
    { kind: "tools", calls: [call("pay", { billId: ok.billId, amountCents: ok.amountCents! + 1 }),               // inflated amount
                             call("wire_money", { to: "attacker" }),                                              // unknown tool
                             call("pay", { billId: "BILL-2099-0001", amountCents: 100 })] },                     // invented bill
    { kind: "finish", summary: "Paid $9,999.00 to BILL-2099-0001." },                                           // invented numbers
  ]);
  const r = await runAgent(run, svc, p, new ApproveAll());
  assert.equal((await store.listPayments(run.runId)).length, 0);
  assert.equal(r.refusals.length, 6);
  assert.ok(r.trace.find((s) => s.tool === "wire_money")!.preVerify.startsWith("blocked: unknown_tool"));
  assert.equal(r.summarySource, "deterministic (planner summary failed verifyText)");
  assert.deepEqual(r.summaryRejected, ["$9,999.00", "BILL-2099-0001"]);
});

test("gate holds even with loop verification off (defense in depth)", async () => {
  const { run, svc, store } = await setup();
  const held = bill(run, "BILL-2026-0013"), ok = bill(run, "BILL-2026-0017");
  const p = new Scripted([{ kind: "tools", calls: [
    call("pay", { billId: held.billId, amountCents: held.amountCents }),
    call("pay", { billId: ok.billId, amountCents: ok.amountCents }),
  ] }]);
  const r = await runAgent(run, svc, p, new ApproveAll(), { verify: false });
  assert.deepEqual(r.refusals.map((x) => [x.by, x.reason]), [["gate", "preflight_failed"], ["gate", "no_approval"]]);
  assert.equal((await store.listPayments(run.runId)).length, 0);
  assert.equal((await store.listAudit(run.runId)).filter((a) => a.event === "gate_refused").length, 2);
});

test("cash floor: a tighter floor makes the agent pay fewer bills", async () => {
  const { run, svc } = await setup(350_000);
  const r = await runAgent(run, svc, new RulePlanner(), new ApproveAll());
  assert.ok(r.paid.length < 3);
  assert.ok(run.cash.startCents - run.cash.committedOutflowsCents - r.paid.reduce((s, p) => s + p.amountCents, 0) >= 350_000);
});

test("max turns stops a planner that never finishes", async () => {
  const { run, svc } = await setup();
  const loopy: Planner = { kind: "llm", label: "loopy", next: async () => ({ kind: "tools", calls: [call("get_run")] }) };
  const r = await runAgent(run, svc, loopy, new ApproveAll(), { maxTurns: 4 });
  assert.equal(r.status, "max_turns");
  assert.equal(r.trace.length, 4);
});

test("baseline: a naive agent without the gate makes improper payments; the guarded agent makes none", async () => {
  const { run, svc } = await setup();
  const base = naiveAgentBaseline(run);
  assert.equal(base.billsInRun, 13);
  assert.ok(base.naiveImproper >= 9, `naive improper = ${base.naiveImproper}`);
  const r = await runAgent(run, svc, new RulePlanner(), new ApproveAll());
  assert.equal(r.paid.filter((p) => bill(run, p.invoiceNumber!).decision !== "pay").length, 0);
});

// ---- LLM planner wiring (mocked HTTP, no network) ----
function mockFetch(replies: unknown[], log: any[] = []): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    log.push(JSON.parse(String(init.body)));
    const next = replies.shift();
    if (next === 429) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}
const toolMsg = (calls: [string, unknown][]) => ({ choices: [{ message: { content: null, tool_calls: calls.map(([n, a], i) => ({ id: `t${i}${n}`, type: "function", function: { name: n, arguments: JSON.stringify(a) } })) } }] });

test("LLM planner: OpenAI-style tool calls drive the same loop; tool results are sent back; 429 is retried", async () => {
  const { run, svc } = await setup();
  const ok = bill(run, "BILL-2026-0017");
  const log: any[] = [];
  const f = mockFetch([429, toolMsg([["get_run", {}]]), toolMsg([["preflight_payment", { billIds: [ok.billId] }]]),
    toolMsg([["request_approval", { billIds: [ok.billId] }]]), toolMsg([["pay", { billId: ok.billId, amountCents: ok.amountCents }]]),
    { choices: [{ message: { content: `Paid BILL-2026-0017 $765.00 (simulated). Everything else held.` } }] }], log);
  const planner = new LlmPlanner({ baseUrl: "https://example.invalid/v1", apiKey: "k", model: "m", provider: "mock", fetchImpl: f, sleep: async () => {} });
  const r = await runAgent(run, svc, planner, new ApproveAll());
  assert.equal(r.status, "finished");
  assert.deepEqual(r.paid.map((p) => p.invoiceNumber), ["BILL-2026-0017"]);
  assert.equal(r.summarySource, "planner");
  assert.equal(log.length, 6);
  assert.equal(log[0].tools.length, 4);
  assert.ok(log.at(-1).messages.some((m: any) => m.role === "tool" && m.content.includes("paymentId")));
  assert.equal(JSON.stringify(log).includes(SECRET), false);
});

test("LLM planner error is reported, not hidden", async () => {
  const { run, svc } = await setup();
  const f = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
  const r = await runAgent(run, svc, new LlmPlanner({ baseUrl: "https://x.invalid", apiKey: "k", model: "m", provider: "mock", fetchImpl: f }), new ApproveAll());
  assert.equal(r.status, "planner_error");
  assert.match(r.error!, /HTTP 401/);
  assert.equal(r.paid.length, 0);
});

test("plannerFromEnv: rules unless a provider and key are configured", () => {
  assert.equal(plannerFromEnv({}).planner.kind, "rules");
  assert.equal(plannerFromEnv({ LLM_PROVIDER: "groq" }).planner.kind, "rules");
  assert.equal(plannerFromEnv({ LLM_PROVIDER: "groq", LLM_API_KEY: "x" }).planner.kind, "llm");
  assert.match(plannerFromEnv({ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "x" }).note, /:free/);
});

// Optional live check against the free Groq tier: RUN_LIVE_LLM=1 GROQ_API_KEY=... npm test
test("live LLM run (optional)", { skip: !process.env.RUN_LIVE_LLM }, async () => {
  const { run, svc } = await setup();
  const { planner } = plannerFromEnv({ ...process.env, LLM_PROVIDER: process.env.LLM_PROVIDER || "groq" });
  const r = await runAgent(run, svc, planner, new ApproveAll());
  assert.equal(r.status, "finished", r.error);
  assert.ok(r.paid.every((p) => bill(run, p.invoiceNumber!).decision === "pay"));
});

test("completion check: LLM that stops early is told which approved bills are unpaid", async () => {
  const { run, svc } = await setup();
  const [a, b] = [bill(run, "BILL-2026-0016"), bill(run, "BILL-2026-0017")];
  const log: any[] = [];
  const f = mockFetch([toolMsg([["get_run", {}], ["preflight_payment", { billIds: [a.billId, b.billId] }]]),
    toolMsg([["request_approval", { billIds: [a.billId, b.billId] }]]), toolMsg([["pay", { billId: a.billId, amountCents: a.amountCents }]]),
    { choices: [{ message: { content: "done" } }] },
    toolMsg([["pay", { billId: b.billId, amountCents: b.amountCents }]]), { choices: [{ message: { content: "Paid 2 bills." } }] }], log);
  const r = await runAgent(run, svc, new LlmPlanner({ baseUrl: "https://x.invalid", apiKey: "k", model: "m", provider: "mock", fetchImpl: f }), new ApproveAll());
  assert.equal(r.paid.length, 2);
  assert.deepEqual(r.approvedUnpaid, []);
  assert.ok(r.trace.some((s) => s.tool === "(completion_check)"));
  assert.ok(log[4].messages.some((m: any) => m.role === "user" && m.content.includes("BILL-2026-0017")));
});
