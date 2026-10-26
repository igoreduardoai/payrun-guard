'use client'

import { useRef, useState } from 'react'
import { Check, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCents, type ApproveResult, type RunView } from '@/lib/types'
import { useAudit } from './interactive-section'

export function ActionBar({ view }: { view: RunView }) {
  const { setAudit } = useAudit()
  const [result, setResult] = useState<ApproveResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function approve() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/approve', { method: 'POST' })
      const data = (await res.json()) as ApproveResult
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResult(data)
      setAudit(data.audit)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const created = result?.payments.filter((p) => p.created).length ?? 0
  const repeated = result ? result.payments.length - created : 0

  return (
    <div className="sticky bottom-0 z-20 border-t bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {error ? (
            <span className="font-medium text-danger-foreground">Approval failed: {error}</span>
          ) : result ? (
            <span className="font-medium text-success-foreground text-pretty">
              <Check aria-hidden="true" className="mr-1.5 inline size-4 align-[-3px]" />
              SIMULATED · {created} new payment{created === 1 ? '' : 's'}
              {repeated > 0 && ` · ${repeated} already paid (idempotent, nothing new)`} · no money moved. Click again to test double-pay.
            </span>
          ) : (
            <>
              <span className="font-medium text-foreground">{view.held.length} held bills</span> stay excluded. Approving signs a
              token per safe bill (run, bill, amount, check hash); the server stores only its hash.
            </>
          )}
        </p>
        <Button size="lg" onClick={approve} disabled={busy} className="tabular-nums">
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <ShieldCheck aria-hidden="true" />}
          {result ? 'Approve again' : 'Approve'} {view.safe.length} safe bills · {formatCents(view.cash.payCents)}
        </Button>
      </div>
    </div>
  )
}
