// Tool surface for an AI agent (and, later, an MCP server). The agent can read the run and
// request approval, but `pay` goes through guardedPay(), which needs a human-signed token
// the agent never sees: the toolbox attaches it only if a human approved that exact bill.
// Enforcement is in code, not in the prompt.
export interface ToolDef {
  name: "get_run" | "preflight_payment" | "request_approval" | "pay";
  description: string;
  parameters: Record<string, unknown>; // JSON Schema (OpenAI-compatible function calling)
}

export const AGENT_TOOLS: readonly ToolDef[] = [
  { name: "get_run", description: "Get this week's payment run: every bill with id, invoice number, amount in cents, planner decision (pay/hold) and hold reasons, plus cash after the run.",
    parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "preflight_payment", description: "Run deterministic pre-flight checks on one or more bills. Returns pass/hold per bill with findings that cite Rho object ids.",
    parameters: { type: "object", properties: { billIds: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["billIds"], additionalProperties: false } },
  { name: "request_approval", description: "Ask a human to approve bills that passed pre-flight. Returns approved/denied per bill. The agent never receives the approval token or the signing secret.",
    parameters: { type: "object", properties: { billIds: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["billIds"], additionalProperties: false } },
  { name: "pay", description: "Pay one bill (SIMULATED rail, no money moves). Refused unless pre-flight passed AND a human approved this exact run, bill, amount and check result.",
    parameters: { type: "object", properties: { billId: { type: "string" }, amountCents: { type: "integer" } }, required: ["billId", "amountCents"], additionalProperties: false } },
] as const;

export type ToolName = ToolDef["name"];
export const TOOL_NAMES = new Set<string>(AGENT_TOOLS.map((t) => t.name));
