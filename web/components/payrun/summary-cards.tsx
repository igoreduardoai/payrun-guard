import { CircleCheck, FileStack, Hand } from 'lucide-react'
import { formatCents, type RunView } from '@/lib/types'
import { cn } from '@/lib/utils'

function StatCard({
  label,
  icon: Icon,
  iconClass,
  value,
  sub,
  footer,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  value: React.ReactNode
  sub: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn('flex size-7 items-center justify-center rounded-md', iconClass)}>
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </div>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-sm text-muted-foreground">{sub}</p>
      <div className="mt-auto border-t pt-3 text-xs text-muted-foreground">{footer}</div>
    </div>
  )
}

function CashCard({ cash }: { cash: RunView['cash'] }) {
  const buffer = cash.endCents - cash.floorCents
  const above = buffer >= 0
  const floorPct = Math.min(100, (cash.floorCents / Math.max(cash.endCents, 1)) * 100)

  const rows = [
    { label: 'Cash before', value: formatCents(cash.startCents), muted: false },
    { label: 'Already scheduled', value: `−${formatCents(cash.committedOutflowsCents)}`, muted: true },
    { label: 'This run', value: `−${formatCents(cash.payCents)}`, muted: true },
  ]

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 md:col-span-3 xl:col-span-1">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">Cash</p>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', above ? 'bg-success-soft text-success-foreground' : 'bg-danger-soft text-danger-foreground')}>
          {above ? 'Above floor' : 'Below floor'}
        </span>
      </div>

      <dl className="flex flex-col gap-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={cn('tabular-nums', r.muted && 'text-muted-foreground')}>{r.value}</dd>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t pt-2">
          <dt className="font-medium">Cash after</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatCents(cash.endCents)}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <div
          role="img"
          aria-label={`Cash after ${formatCents(cash.endCents)} vs the ${formatCents(cash.floorCents)} cash floor.`}
          className="relative flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-foreground/20" style={{ width: `${floorPct}%` }} />
          <div className={cn("h-full flex-1", above ? "bg-success" : "bg-danger")} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Floor <span className="tabular-nums">{formatCents(cash.floorCents)}</span>
          </span>
          <span className="font-medium text-success-foreground tabular-nums">
            {above ? '+' : ''}{formatCents(buffer)} buffer
          </span>
        </div>
      </div>
      {cash.expectedInflowsCents > 0 && (
        <p className="text-xs text-muted-foreground">
          Open customer invoices due this week ({formatCents(cash.expectedInflowsCents)}) are not counted.
        </p>
      )}
    </div>
  )
}

export function SummaryCards({ view }: { view: RunView }) {
  const safeBills = view.safe
  const heldBills = view.held
  const heldTotal = heldBills.reduce((s, b) => s + (b.amountCents ?? 0), 0)
  const total = safeBills.length + heldBills.length
  const safePct = total ? (safeBills.length / total) * 100 : 0

  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="sr-only">Run summary</h2>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Bills in run"
          icon={FileStack}
          iconClass="bg-muted text-muted-foreground"
          value={total}
          sub={`Each checked by ${view.billRuleCount} rules + cash floor`}
          footer={
            <div className="flex flex-col gap-2">
              <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-danger/70">
                <div className="h-full bg-success" style={{ width: `${safePct}%` }} />
              </div>
              <div className="flex justify-between">
                <span>{safeBills.length} safe</span>
                <span>{heldBills.length} held</span>
              </div>
            </div>
          }
        />
        <StatCard
          label="Safe to pay"
          icon={CircleCheck}
          iconClass="bg-success-soft text-success-foreground"
          value={<>{safeBills.length}<span className="ml-2 text-lg font-medium text-muted-foreground">bills</span></>}
          sub={<span className="font-medium text-success-foreground tabular-nums">{formatCents(view.cash.payCents)}</span>}
          footer="No blocking finding · needs human approval"
        />
        <StatCard
          label="Held"
          icon={Hand}
          iconClass="bg-danger-soft text-danger-foreground"
          value={<>{heldBills.length}<span className="ml-2 text-lg font-medium text-muted-foreground">bills</span></>}
          sub={<span className="tabular-nums">{formatCents(heldTotal)} · needs human review</span>}
          footer={<span><span className="font-medium text-warning-foreground">{view.runFindings.length} run-level warnings</span> to confirm</span>}
        />
        <CashCard cash={view.cash} />
      </div>
    </section>
  )
}
