import { CalendarDays, Landmark, ShieldCheck, FlaskConical, Building2 } from 'lucide-react'
import type { RunView } from '@/lib/types'

export function DashboardHeader({ view }: { view: RunView }) {
  const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight tracking-tight">PayRun Guard</p>
            <p className="text-xs text-muted-foreground text-pretty">
              The safety check every AI agent must pass before paying bills
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Company</dt>
              <Building2 aria-hidden="true" className="size-4 text-muted-foreground" />
              <dd className="font-medium">{view.company}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Week</dt>
              <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
              <dd className="text-muted-foreground">{fmt(view.asOf)} – {fmt(view.windowEnd)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Account</dt>
              <Landmark aria-hidden="true" className="size-4 text-muted-foreground" />
              <dd className="text-muted-foreground">
                {view.account.name} <span className="font-mono text-xs">{view.account.last4 ? `•• ${view.account.last4}` : ''}</span>
              </dd>
            </div>
          </dl>
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-warning-foreground ring-1 ring-inset ring-warning/40"
          >
            <FlaskConical aria-hidden="true" className="size-3.5" />
            Simulated payments
            <span className="font-normal normal-case tracking-normal">· no money moves</span>
          </span>
        </div>
      </div>
    </header>
  )
}
