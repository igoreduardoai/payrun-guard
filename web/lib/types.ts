// View model shared by server and client. All values come from the PayRun Guard engine run on Rho sandbox fixtures.
export type Tone = 'neutral' | 'success' | 'warning' | 'danger'

export type ViewFinding = { rule: string; severity: 'block' | 'warn'; message: string; evidence: string[] }

export type ViewBill = {
  billId: string
  label: string // invoice number or Rho bill id
  vendor: string | null
  vendorId: string | null
  amountCents: number | null
  dueDate: string | null
  decision: 'pay' | 'hold'
  headline: string
  findings: ViewFinding[]
}

export type ViewAudit = {
  id: string
  event: string
  actor: string
  actorKind: 'agent' | 'human' | 'system'
  timestamp: string
  detail: string
  tone: Tone
}

export type RunView = {
  runId: string
  asOf: string
  windowEnd: string
  dataSource: string
  company: string
  account: { id: string; name: string; last4: string | null }
  cash: { startCents: number; committedOutflowsCents: number; payCents: number; endCents: number; floorCents: number; expectedInflowsCents: number }
  safe: ViewBill[]
  held: ViewBill[]
  runFindings: ViewFinding[]
  billRuleCount: number
  store: string
  audit: ViewAudit[]
}

export type ApproveResult = {
  ok: boolean
  payments: { billLabel: string; paymentId: string; amountCents: number; created: boolean; simulated: boolean }[]
  audit: ViewAudit[]
  error?: string
}

export type AgentPayResult = {
  refused: boolean
  reason: string | null
  message: string | null
  request: { billId: string; billLabel: string; vendor: string | null; amountCents: number | null; approvalToken: null }
  audit: ViewAudit[]
}

export function formatCents(cents: number | null) {
  if (cents === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}
