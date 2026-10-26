import { formatCents, type RunView } from '@/lib/types'
import { StatusBadge } from './status-badge'

export function SafeTable({ view }: { view: RunView }) {
  return (
    <section aria-labelledby="safe-heading" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 id="safe-heading" className="text-base font-semibold">Safe to pay</h2>
          <p className="text-sm text-muted-foreground">No blocking finding and fits above the cash floor. Still needs a human approval.</p>
        </div>
        <StatusBadge tone="success">{view.safe.length} bills</StatusBadge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">Bill</th>
              <th scope="col" className="px-5 py-2.5 font-medium">Vendor</th>
              <th scope="col" className="px-5 py-2.5 font-medium">Due</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Amount</th>
              <th scope="col" className="px-5 py-2.5 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {view.safe.map((b) => (
              <tr key={b.billId} className="align-top hover:bg-muted/30">
                <td className="whitespace-nowrap px-5 py-3 font-mono text-xs">{b.label}</td>
                <td className="px-5 py-3 font-medium">{b.vendor}</td>
                <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{b.dueDate}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">{formatCents(b.amountCents)}</td>
                <td className="px-5 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge tone="success">Passed all blocking checks</StatusBadge>
                    {b.findings.map((f) => (
                      <span key={f.rule} className="text-xs text-warning-foreground text-pretty">⚠ {f.message}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30">
            <tr>
              <th scope="row" colSpan={3} className="px-5 py-3 text-left font-medium">Total</th>
              <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatCents(view.cash.payCents)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
