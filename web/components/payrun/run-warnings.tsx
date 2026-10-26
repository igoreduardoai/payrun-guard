import { AlertTriangle } from 'lucide-react'
import type { RunView } from '@/lib/types'

export function RunWarnings({ view }: { view: RunView }) {
  if (view.runFindings.length === 0) return null
  return (
    <section aria-labelledby="warn-heading" className="rounded-xl border bg-card">
      <div className="border-b px-5 py-4">
        <h2 id="warn-heading" className="text-base font-semibold">Run-level warnings</h2>
        <p className="text-sm text-muted-foreground">Not tied to one bill. A human should confirm these.</p>
      </div>
      <ul className="flex flex-col gap-3 p-5">
        {view.runFindings.map((f) => (
          <li key={f.rule + f.message} className="flex gap-3">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            <div className="min-w-0">
              <p className="text-sm text-pretty"><span className="font-mono text-xs text-muted-foreground">{f.rule}</span> {f.message}</p>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {f.evidence.map((e) => <span key={e} className="break-all rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[11px]">{e}</span>)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
