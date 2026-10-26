// Tool surface for an AI agent (and, later, an MCP server). The agent can read the run and
// request approval, but `pay` goes through guardedPay(), which needs a human-signed token
// the agent cannot create. Enforcement is in code, not in the prompt.
export const AGENT_TOOLS = [
  { name: "get_run", description: "Get this week's payment run: bills to pay, holds with evidence, cash after run.", input: { asOf: "YYYY-MM-DD" } },
  { name: "preflight_payment", description: "Run deterministic pre-flight checks on one bill. Returns pass/hold with Rho object ids as evidence.", input: { billId: "string" } },
  { name: "request_approval", description: "Ask a human to approve bills that passed pre-flight. Returns a pending request; the agent never receives the signing secret.", input: { billIds: "string[]" } },
  { name: "pay", description: "Pay one bill. Refused unless pre-flight passed AND a valid human approval token for this exact run, bill, amount and check result is supplied.", input: { billId: "string", amountCents: "integer", approvalToken: "string" } },
] as const;
