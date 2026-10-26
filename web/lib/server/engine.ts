import 'server-only'
import { randomBytes } from 'node:crypto'
import snapshotJson from '../../../fixtures/rho-sandbox-2026-10-26/snapshot.json'
import type { RhoSnapshot } from '../../../packages/rho/src/types.ts'
import { planRun, type PayRun, type PlannedBill } from '../../../packages/planner/src/cashPlan.ts'
import { BILL_RULES } from '../../../packages/preflight/src/rules.ts'
import type { Finding } from '../../../packages/preflight/src/types.ts'
import { GateRefusal } from '../../../packages/rails/src/guardedPay.ts'
import { storeFromEnvWithFallback } from '../../../packages/store/src/index.ts'
import { PayRunService } from '../../../packages/store/src/PayRunService.ts'
import type { StoredAudit } from '../../../packages/store/src/Store.ts'
import type { AgentPayResult, ApproveResult, RunView, Tone, ViewAudit, ViewBill, ViewFinding } from '../types'

// Demo defaults: Rho sandbox "Primary Checking", week of 2026-08-27 in the sandbox timeline, $2,500 floor.
const AS_OF = process.env.AS_OF ?? '2026-08-27'
const SOURCE_ACCOUNT_ID = process.env.SOURCE_ACCOUNT_ID ?? '30000000-0000-4000-8000-000000000006'
const CASH_FLOOR_CENTS = Number(process.env.CASH_FLOOR_CENTS ?? 250000)

const snapshot = snapshotJson as unknown as RhoSnapshot

type Ctx = { run: PayRun; svc: PayRunService; storeNote: string }
let ctxPromise: Promise<Ctx> | null = null

function getCtx(): Promise<Ctx> {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const run = planRun(snapshot, { asOf: AS_OF, sourceAccountId: SOURCE_ACCOUNT_ID, cashFloorCents: CASH_FLOOR_CENTS })
      // Approval secret lives only on the server. Without APPROVAL_SECRET a random per-instance secret is used.
      const secret = process.env.APPROVAL_SECRET && process.env.APPROVAL_SECRET.length >= 16 ? process.env.APPROVAL_SECRET : randomBytes(32).toString('hex')
      const { store, note } = await storeFromEnvWithFallback()
      const svc = new PayRunService(store, secret, snapshot.counterparties)
      await svc.recordRun(run, 'fixtures')
      return { run, svc, storeNote: note }
    })().catch((e) => { ctxPromise = null; throw e })
  }
  return ctxPromise
}

const vendorName = new Map(snapshot.counterparties.map((c) => [c.id, c.legal_name]))

const HEADLINE: Record<string, string> = {
  vendor_missing: 'No payee', vendor_unknown: 'Unknown vendor', vendor_not_active: 'Vendor not active',
  payment_method_missing: 'No payment method', w9_missing: 'No W-9', bill_incomplete: 'Bill incomplete',
  amount_invalid: 'Invalid amount', status_unrecognized: 'Unrecognized status', line_sum_mismatch: 'Lines ≠ total',
  line_currency_mismatch: 'Mixed currencies', duplicate_invoice_number: 'Duplicate invoice', previous_payment_failed: 'Last payment failed',
  already_scheduled: 'Already scheduled · would pay twice', cash_floor: 'Would breach cash floor',
}

function viewFinding(f: Finding): ViewFinding {
  return { rule: f.rule, severity: f.severity, message: f.message,
    evidence: f.evidence.map((e) => `${e.object}:${e.id} ${e.field}=${JSON.stringify(e.value)}`) }
}

function viewBill(b: PlannedBill): ViewBill {
  const blocks = b.findings.filter((f) => f.severity === 'block')
  const headline = b.decision === 'pay' ? 'Passed all blocking checks' : [...new Set(blocks.map((f) => HEADLINE[f.rule] ?? f.rule))].join(' · ')
  return { billId: b.billId, label: b.invoiceNumber ?? b.billId, vendor: b.vendorId ? vendorName.get(b.vendorId) ?? null : null, vendorId: b.vendorId,
    amountCents: b.amountCents, dueDate: b.dueDate, decision: b.decision, headline, findings: b.findings.map(viewFinding) }
}

const TONE: Record<string, Tone> = { run_planned: 'neutral', approval_signed: 'success', payment_created: 'success', payment_duplicate: 'warning', gate_refused: 'danger' }

function viewAudit(a: StoredAudit, run: PayRun): ViewAudit {
  const bill = a.billId ? run.bills.find((x) => x.billId === a.billId) : undefined
  const d = a.detail as Record<string, any>
  const billLabel = bill ? (bill.invoiceNumber ?? bill.billId) : ''
  const money = (c: unknown) => (typeof c === 'number' ? `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '')
  const detail =
    a.event === 'run_planned' ? `${d.bills} bills checked · ${d.pay} pay · ${d.bills - d.pay} held · source ${d.source}` :
    a.event === 'approval_signed' ? `${billLabel} ${money(d.amountCents)} approved · token hash stored, expires ${d.expiresAt}` :
    a.event === 'payment_created' ? `SIMULATED payment ${d.paymentId} · ${billLabel} ${money(d.amountCents)} · no money moved` :
    a.event === 'payment_duplicate' ? `Repeat request for ${billLabel} returned existing ${d.paymentId} (idempotent, no new payment)` :
    a.event === 'gate_refused' ? `${billLabel || a.billId} refused · ${d.reason}: ${d.message}` : JSON.stringify(d)
  const actorKind = a.actor.startsWith('human') ? 'human' : a.actor === 'agent' ? 'agent' : 'system'
  return { id: String(a.id), event: a.event, actor: a.actor, actorKind, timestamp: a.createdAt, detail, tone: TONE[a.event] ?? 'neutral' }
}

async function auditView(ctx: Ctx): Promise<ViewAudit[]> {
  return (await ctx.svc.store.listAudit(ctx.run.runId)).map((a) => viewAudit(a, ctx.run))
}

export async function getRunView(): Promise<RunView> {
  const ctx = await getCtx()
  const { run } = ctx
  const acct = snapshot.accounts.find((a) => a.id === run.sourceAccountId)!
  const bills = run.bills.map(viewBill)
  return {
    runId: run.runId, asOf: run.asOf, windowEnd: run.windowEnd, dataSource: 'Rho public sandbox snapshot (2026-10-26)',
    company: 'Rho sandbox company (fictional)',
    account: { id: acct.id, name: acct.account_name, last4: acct.account_number_last_4 ?? null },
    cash: run.cash, safe: bills.filter((b) => b.decision === 'pay'), held: bills.filter((b) => b.decision === 'hold'),
    runFindings: run.runFindings.map(viewFinding), billRuleCount: BILL_RULES.length, store: ctx.storeNote, audit: await auditView(ctx),
  }
}

export async function approveSafeBills(approver = 'demo-approver'): Promise<ApproveResult> {
  const ctx = await getCtx()
  const payments: ApproveResult['payments'] = []
  for (const b of ctx.run.bills.filter((x) => x.decision === 'pay')) {
    const token = await ctx.svc.approve(ctx.run, b.billId, approver) // human approval: token stays server-side, only its hash is stored
    const out = await ctx.svc.pay(ctx.run, b.billId, b.amountCents!, token, `human:${approver}`)
    payments.push({ billLabel: b.invoiceNumber ?? b.billId, paymentId: out.record.paymentId, amountCents: out.record.amountCents, created: out.created, simulated: out.record.simulated })
  }
  return { ok: true, payments, audit: await auditView(ctx) }
}

/** The agent path: no human approval token. The real gate decides. */
export async function agentTriesToPay(billIdOrLabel: string): Promise<AgentPayResult> {
  const ctx = await getCtx()
  // Accept the Rho bill id or its invoice number (e.g. BILL-2026-0013).
  const b = ctx.run.bills.find((x) => x.billId === billIdOrLabel || x.invoiceNumber === billIdOrLabel)
  const billId = b?.billId ?? billIdOrLabel
  const request = { billId, billLabel: b?.invoiceNumber ?? billId, vendor: b?.vendorId ? vendorName.get(b.vendorId) ?? null : null, amountCents: b?.amountCents ?? null, approvalToken: null }
  try {
    await ctx.svc.pay(ctx.run, billId, b?.amountCents ?? 0, undefined, 'agent')
    return { refused: false, reason: null, message: 'UNEXPECTED: payment went through', request, audit: await auditView(ctx) }
  } catch (e) {
    if (!(e instanceof GateRefusal)) throw e
    return { refused: true, reason: e.reason, message: e.message, request, audit: await auditView(ctx) }
  }
}

export async function getAudit(): Promise<ViewAudit[]> { return auditView(await getCtx()) }
