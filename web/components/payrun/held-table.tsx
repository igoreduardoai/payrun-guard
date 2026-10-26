'use client'

import { Fragment, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatCents, type RunView } from '@/lib/types'
import { cn } from '@/lib/utils'
import { StatusBadge } from './status-badge'

export function HeldTable({ view }: { view: RunView }) {
  const heldBills = view.held
  const [openId, setOpenId] = useState<string | null>(heldBills.find((b) => b.label === 'BILL-2026-0013')?.billId ?? null)
  const total = heldBills.reduce((s, b) => s + (b.amountCents ?? 0), 0)
  const floorCount = heldBills.filter((b) => b.findings.some((f) => f.rule === 'cash_floor')).length

  return (
    <section aria-labelledby="held-heading" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 id="held-heading" className="text-base font-semibold">
            Held
          </h2>
          <p className="text-sm text-muted-foreground">
            The agent cannot pay these. Expand a row to see why.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge tone="danger">{heldBills.length} blocked</StatusBadge>
          {floorCount > 0 && <StatusBadge tone="warning">{floorCount} by cash floor</StatusBadge>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2.5">
                <span className="sr-only">Expand</span>
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">Bill</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Vendor</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
              <th scope="col" className="px-5 py-2.5 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {heldBills.map((bill) => {
              const open = openId === bill.billId
              const panelId = `held-panel-${bill.billId}`
              const tone = 'danger' as const
              return (
                <Fragment key={bill.billId}>
                  <tr
                    className={cn(
                      'cursor-pointer border-t transition-colors hover:bg-muted/30',
                      open && 'bg-muted/30',
                    )}
                    onClick={() => setOpenId(open ? null : bill.billId)}
                  >
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        aria-label={`${open ? 'Hide' : 'Show'} reasons for ${bill.label}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenId(open ? null : bill.billId)
                        }}
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className={cn('size-4 transition-transform', open && 'rotate-90')}
                        />
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{bill.label.length > 20 ? `${bill.label.slice(0, 8)}…${bill.label.slice(-4)}` : bill.label}</td>
                    <td className="px-3 py-3 font-medium">
                      <span className={cn(!bill.vendor && 'text-muted-foreground italic')}>
                        {bill.vendor ?? '— (no payee)'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {formatCents(bill.amountCents)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={tone}>{bill.headline}</StatusBadge>
                    </td>
                  </tr>
                  <tr id={panelId} hidden={!open} className="bg-muted/30">
                    <td />
                    <td colSpan={4} className="px-3 pb-4 pr-5">
                      <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[1fr_auto]">
                        <div>
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Why it was held
                          </p>
                          <ul className="flex flex-col gap-1.5">
                            {bill.findings.map((f) => (
                              <li key={f.rule + f.message} className="flex gap-2 text-pretty leading-relaxed">
                                <span
                                  aria-hidden="true"
                                  className={cn('mt-2 size-1.5 shrink-0 rounded-full', f.severity === 'block' ? 'bg-danger' : 'bg-warning')}
                                />
                                <span>
                                  <span className="font-mono text-xs text-muted-foreground">[{f.severity}] {f.rule}</span> {f.message}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-3 text-xs text-muted-foreground">Due {bill.dueDate ?? '—'} · Rho bill id <span className="font-mono">{bill.billId}</span></p>
                        </div>
                        <div className="md:min-w-56">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Evidence (Rho records)
                          </p>
                          <ul className="flex flex-wrap gap-1.5 md:flex-col md:items-start">
                            {[...new Set(bill.findings.flatMap((f) => f.evidence))].map((e) => (
                              <li
                                key={e}
                                className="break-all rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-foreground/80"
                              >
                                {e}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
          <tfoot className="border-t bg-muted/30">
            <tr>
              <td />
              <th scope="row" colSpan={2} className="px-3 py-3 text-left font-medium">
                Total held
              </th>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatCents(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
