// Planners decide the next tool call. Two implementations behind one interface:
//  - RulePlanner: deterministic, no network. Default when no free LLM key is configured.
//  - LlmPlanner: any OpenAI-compatible chat-completions endpoint with function calling
//    (default: Groq free tier, model openai/gpt-oss-20b). It only chooses tool calls and writes text;
//    every call is validated by the loop and money still goes through the deterministic gate.
import { AGENT_TOOLS } from "./tools.ts";
import type { ToolResult } from "./toolbox.ts";

export interface ToolCall { id: string; tool: string; args: Record<string, unknown> }
export type PlannerOutput = { kind: "tools"; calls: ToolCall[]; thought?: string } | { kind: "finish"; summary: string };
export interface Observation { call: ToolCall; result: ToolResult }

export interface Planner {
  readonly kind: "rules" | "llm";
  readonly label: string;
  /** `obs` = results of the calls this planner emitted last turn (empty on the first turn). */
  next(obs: Observation[]): Promise<PlannerOutput>;
  /** Optional: the loop's completion check tells the planner what is still unfinished. */
  feedback?(text: string): void;
}

export const GOAL = "Run this week's vendor payment run on Rho safely: read the run, pre-flight every bill, ask a human to approve only the bills that passed, pay only what the human approved, then summarize what was paid and what was held and why.";

let seq = 0;
const id = () => `call_${++seq}`;

export class RulePlanner implements Planner {
  readonly kind = "rules" as const;
  readonly label = "rules (deterministic, no LLM)";
  private phase = 0;
  private bills: { billId: string; decision: string }[] = [];
  private passed: string[] = [];
  private approved: string[] = [];
  private amounts = new Map<string, number>();

  async next(obs: Observation[]): Promise<PlannerOutput> {
    switch (this.phase++) {
      case 0: return { kind: "tools", calls: [{ id: id(), tool: "get_run", args: {} }], thought: "Read the run first." };
      case 1: {
        this.bills = (obs[0]?.result.bills as { billId: string; decision: string }[]) ?? [];
        if (!this.bills.length) return { kind: "finish", summary: "No bills in this run." };
        return { kind: "tools", calls: [{ id: id(), tool: "preflight_payment", args: { billIds: this.bills.map((b) => b.billId) } }], thought: "Pre-flight every bill." };
      }
      case 2: {
        const results = (obs[0]?.result.results as { billId: string; pass: boolean; decision: string; amountCents: number | null }[]) ?? [];
        for (const r of results) if (r.amountCents !== null) this.amounts.set(r.billId, r.amountCents);
        this.passed = results.filter((r) => r.pass && r.decision === "pay").map((r) => r.billId);
        if (!this.passed.length) return { kind: "finish", summary: "Nothing passed pre-flight; no approval requested, nothing paid." };
        return { kind: "tools", calls: [{ id: id(), tool: "request_approval", args: { billIds: this.passed } }], thought: "Ask the human to approve only the passing bills." };
      }
      case 3: {
        const d = (obs[0]?.result.decisions as { billId: string; approved: boolean }[]) ?? [];
        this.approved = d.filter((x) => x.approved).map((x) => x.billId);
        if (!this.approved.length) return { kind: "finish", summary: "The human approved nothing; nothing paid." };
        return { kind: "tools", calls: this.approved.map((b) => ({ id: id(), tool: "pay", args: { billId: b, amountCents: this.amounts.get(b)! } })), thought: "Pay only what the human approved." };
      }
      default: return { kind: "finish", summary: "" }; // empty: the loop writes the deterministic report
    }
  }
}

export interface LlmConfig { baseUrl: string; apiKey: string; model: string; provider: string; fetchImpl?: typeof fetch; maxRetries?: number; sleep?: (ms: number) => Promise<void> }

const SYSTEM = `You are PayRun Guard's payment agent for a small company that banks on Rho. ${GOAL}
Rules: use only the provided tools. Refer to bills by their ref (invoice number or bill id) exactly as given. Amounts are integers in cents and must be copied exactly from tool results. Never invent refs or amounts. Pre-flight all bills in one call; request approval for all passing bills in one call; you may issue several pay calls in one turn. Never pay a bill that is held. Payments are SIMULATED (no real money moves). If a tool refuses, do not retry with different arguments; report it.
When done, reply with a short plain-text summary (no tool call) that names paid and held bills using only numbers that appear in tool results.`;

/** Free tiers allow ~8k tokens/minute, so the LLM sees a compact view: refs (invoice number, else bill id),
 *  amounts, decisions and rule names. Full findings with Rho evidence stay in the trace and audit log. */
export function compactForLlm(tool: string, r: ToolResult): unknown {
  const ref = (b: any) => b.invoiceNumber ?? b.billId;
  if (tool === "get_run" && Array.isArray(r.bills)) return { runId: r.runId, cash: r.cash, paymentsSimulated: true,
    bills: (r.bills as any[]).map((b) => ({ ref: ref(b), amountCents: b.amountCents, decision: b.decision, holdReasons: b.holdReasons })) };
  if (tool === "preflight_payment" && Array.isArray(r.results)) return { results: (r.results as any[]).map((b) => b.found === false ? b
    : { ref: ref(b), pass: b.pass, decision: b.decision, amountCents: b.amountCents, blocks: (b.findings as string[]).filter((f) => f.startsWith("[block]")).map((f) => f.split(":")[0]!.slice(8)) }) };
  if (tool === "request_approval" && Array.isArray(r.decisions)) return { approver: r.approver, decisions: r.decisions, notApprovable: (r.notApprovable as unknown[]).length };
  return r;
}

type Msg = { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string };

export class LlmPlanner implements Planner {
  readonly kind = "llm" as const;
  readonly label: string;
  private messages: Msg[] = [{ role: "system", content: SYSTEM }, { role: "user", content: "Start the payment run now." }];
  constructor(private cfg: LlmConfig) { this.label = `llm (${cfg.provider}: ${cfg.model})`; }
  feedback(text: string) { this.messages.push({ role: "user", content: text }); }

  private async complete(): Promise<any> {
    const f = this.cfg.fetchImpl ?? fetch;
    const sleep = this.cfg.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const body = JSON.stringify({ model: this.cfg.model, messages: this.messages, temperature: 0, max_completion_tokens: 1024,
      ...(/gpt-oss/.test(this.cfg.model) ? { reasoning_effort: "low" } : {}),
      tools: AGENT_TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) });
    for (let attempt = 0; ; attempt++) {
      const res = await f(`${this.cfg.baseUrl}/chat/completions`, { method: "POST", body,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` } });
      if (res.ok) return res.json();
      const text = (await res.text()).slice(0, 300);
      // 429/5xx, and a model output the provider could not parse as a tool call (Groq: tool_use_failed), are retried
      const retriable = res.status === 429 || res.status >= 500 || (res.status === 400 && /tool_use_failed|Parsing failed/.test(text));
      if (!retriable || attempt >= (this.cfg.maxRetries ?? 4)) throw new Error(`LLM ${this.cfg.provider} HTTP ${res.status}: ${text.slice(0, 200)}`);
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * (attempt + 1), 20_000));
    }
  }

  async next(obs: Observation[]): Promise<PlannerOutput> {
    for (const o of obs) {
      const s = JSON.stringify(compactForLlm(o.call.tool, o.result));
      this.messages.push({ role: "tool", tool_call_id: o.call.id, content: s.length > 6000 ? `${s.slice(0, 6000)}...(truncated)` : s });
    }
    const data = await this.complete();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error("LLM returned no message");
    const calls = (msg.tool_calls ?? []) as { id: string; function: { name: string; arguments: string } }[];
    this.messages.push({ role: "assistant", content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) return { kind: "finish", summary: String(msg.content ?? "") };
    return { kind: "tools", thought: msg.content ?? undefined, calls: calls.map((c) => {
      let args: Record<string, unknown> = {};
      try { args = c.function.arguments ? JSON.parse(c.function.arguments) : {}; } catch { args = { __unparseable: c.function.arguments }; }
      return { id: c.id, tool: c.function.name, args };
    }) };
  }
}

const PROVIDERS: Record<string, { baseUrl: string; model: string; keyEnv: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b", keyEnv: "GROQ_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-oss-20b:free", keyEnv: "OPENROUTER_API_KEY" },
};

/**
 * LLM_PROVIDER=groq|openrouter (+ LLM_API_KEY or the provider's own *_API_KEY, optional LLM_MODEL) -> LlmPlanner.
 * Anything else, or no key -> RulePlanner. Only free tiers are intended; no paid model is configured by default.
 */
export function plannerFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): { planner: Planner; note: string } {
  const p = PROVIDERS[(env.LLM_PROVIDER ?? "").toLowerCase()];
  if (!p) return { planner: new RulePlanner(), note: "rule planner (LLM_PROVIDER not set)" };
  const apiKey = env.LLM_API_KEY || env[p.keyEnv] || "";
  if (!apiKey) return { planner: new RulePlanner(), note: `rule planner (LLM_PROVIDER=${env.LLM_PROVIDER} but no API key)` };
  const provider = (env.LLM_PROVIDER ?? "").toLowerCase();
  return { planner: new LlmPlanner({ baseUrl: p.baseUrl, apiKey, model: env.LLM_MODEL || p.model, provider, fetchImpl }), note: `LLM planner (${provider}, ${env.LLM_MODEL || p.model})` };
}
