'use client'

import { useState } from 'react'
import { ArrowDown, Bot, Loader2, ShieldX, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCents, type AgentPayResult, type RunView } from '@/lib/types'
import { useAudit } from './interactive-section'

export function RefusalDemo({ view }: { view: RunView }) {
  const { setAudit } = useAudit()
  const initial = view.held.find((b) => b.label === 'BILL-2026-0013') ?? view.held[0]
  const [billId, setBillId] = useState(initial?.billId ?? '')
  const [result, setResult] = useState<AgentPayResult | null>(null)
  const [busy, setBusy] = useState(false)
  const bill = [...view.held, ...view.safe].find((b) => b.billId === billId)

  async function tryPay() {
    setBusy(true)
    try {
      const res = await fetch('/api/agent-pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billId }) })
      const data = (await res.json()) as AgentPayResult
      setResult(data)
      setAudit(data.audit)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="demo-heading" className="flex flex-col rounded-xl border bg-card">
      <div className="border-b px-5 py-4">
        <h2 id="demo-heading" className="text-base font-semibold">
          Agent tries to pay without approval <span className="text-muted-foreground">→ the gate decides</span>
        </h2>
        <p className="text-sm text-muted-foreground">Sends a real request to the gate with no human approval token.</p>
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="bill-pick" className="text-sm text-muted-foreground">Bill</label>
          <select id="bill-pick" value={billId} onChange={(e) => { setBillId(e.target.value); setResult(null) }}
            className="h-9 rounded-md border bg-background px-2 font-mono text-xs">
            <optgroup label="Held">
              {view.held.map((b) => <option key={b.billId} value={b.billId}>{b.label} · {formatCents(b.amountCents)}</option>)}
            </optgroup>
            <optgroup label="Safe (still needs approval)">
              {view.safe.map((b) => <option key={b.billId} value={b.billId}>{b.label} · {formatCents(b.amountCents)}</option>)}
            </optgroup>
          </select>
          <Button size="sm" variant="outline" onClick={tryPay} disabled={busy || !billId}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Bot aria-hidden="true" />}
            Agent: pay this bill
          </Button>
        </div>
        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Bot aria-hidden="true" className="size-4" /> Agent request
          </div>
          <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90">
{`POST /api/agent-pay
${JSON.stringify({ bill: bill?.label, vendor: bill?.vendor ?? null, amount_cents: bill?.amountCents ?? null, approval_token: null }, null, 2)}`}
          </pre>
        </div>
        {result && (
          <>
            <ArrowDown aria-hidden="true" className="mx-auto size-4 text-muted-foreground" />
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-danger-foreground">
                  <ShieldX aria-hidden="true" className="size-5" />
                  <span className="text-sm font-bold tracking-wide">{result.refused ? 'REFUSED' : 'NOT REFUSED (bug)'}</span>
                </div>
                <span className="font-mono text-xs text-danger-foreground/80">403 · {result.reason}</span>
              </div>
              <p className="flex gap-2 text-sm text-danger-foreground">
                <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="text-pretty">{result.message}</span>
              </p>
              {bill && bill.findings.filter((f) => f.severity === 'block').length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-danger-foreground/90">
                  {bill.findings.filter((f) => f.severity === 'block').map((f) => <li key={f.rule}>• {f.message}</li>)}
                </ul>
              )}
              <p className="mt-3 border-t border-danger/20 pt-3 text-xs text-danger-foreground/80">
                No payment was created. The attempt was written to the audit log.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
