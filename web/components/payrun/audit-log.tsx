'use client'

import { Bot, Cpu, Lock, User } from 'lucide-react'
import type { ViewAudit } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAudit } from './interactive-section'

const toneDot: Record<ViewAudit['tone'], string> = {
  neutral: 'bg-card ring-border text-muted-foreground',
  success: 'bg-success-soft ring-success/30 text-success-foreground',
  warning: 'bg-warning-soft ring-warning/40 text-warning-foreground',
  danger: 'bg-danger-soft ring-danger/30 text-danger-foreground',
}
const actorIcon = { agent: Bot, human: User, system: Cpu }

export function AuditLog() {
  const { audit } = useAudit()
  const events = [...audit].reverse()
  return (
    <section aria-labelledby="audit-heading" className="flex flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 id="audit-heading" className="text-base font-semibold">Audit log</h2>
          <p className="text-sm text-muted-foreground">Written by the server on every decision, newest first.</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          <Lock aria-hidden="true" className="size-3" />
          Append-only
        </span>
      </div>
      <ol className="flex max-h-[32rem] flex-col overflow-y-auto p-5">
        {events.map((evt, i) => {
          const Icon = actorIcon[evt.actorKind]
          const last = i === events.length - 1
          return (
            <li key={evt.id} className="relative flex gap-4 pb-5 last:pb-0">
              {!last && <span aria-hidden="true" className="absolute left-[13px] top-7 bottom-0 w-px bg-border" />}
              <span aria-hidden="true" className={cn('relative flex size-7 shrink-0 items-center justify-center rounded-full ring-1', toneDot[evt.tone])}>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="font-mono text-sm font-medium">{evt.event}</p>
                  <time className="font-mono text-xs tabular-nums text-muted-foreground">{evt.timestamp}</time>
                </div>
                <p className="mt-0.5 break-words text-sm text-muted-foreground text-pretty">{evt.detail}</p>
                <p className="mt-1 text-xs">
                  <span className="text-muted-foreground">actor </span>
                  <span className="font-mono">{evt.actor}</span>
                  <span className="text-muted-foreground"> · #{evt.id}</span>
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
