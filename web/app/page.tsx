import { DashboardHeader } from '@/components/payrun/dashboard-header'
import { HeldTable } from '@/components/payrun/held-table'
import { InteractiveSection } from '@/components/payrun/interactive-section'
import { RunWarnings } from '@/components/payrun/run-warnings'
import { SafeTable } from '@/components/payrun/safe-table'
import { SummaryCards } from '@/components/payrun/summary-cards'
import { getRunView } from '@/lib/server/engine'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const view = await getRunView()
  return (
    <InteractiveSection view={view}>
      <DashboardHeader view={view} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Weekly pay run review</h1>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            PayRun Guard ran {view.billRuleCount} deterministic checks plus a cash-floor plan on every bill in this run. Only bills
            that pass can be approved, and nothing is paid without a human approval token. Data: {view.dataSource}.
          </p>
        </div>
        <SummaryCards view={view} />
        <SafeTable view={view} />
        <HeldTable view={view} />
        <RunWarnings view={view} />
      </main>
    </InteractiveSection>
  )
}
