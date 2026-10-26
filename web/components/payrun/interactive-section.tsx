'use client'

import { createContext, useContext, useState } from 'react'
import type { RunView, ViewAudit } from '@/lib/types'
import { ActionBar } from './action-bar'
import { AuditLog } from './audit-log'
import { RefusalDemo } from './refusal-demo'

type AuditCtx = { audit: ViewAudit[]; setAudit: (a: ViewAudit[]) => void }
const Ctx = createContext<AuditCtx | null>(null)
export function useAudit() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAudit outside InteractiveSection')
  return c
}

/** Holds the live audit log (from the server) and renders the interactive panels after the static sections. */
export function InteractiveSection({ view, children }: { view: RunView; children: React.ReactNode }) {
  const [audit, setAudit] = useState<ViewAudit[]>(view.audit)
  return (
    <Ctx.Provider value={{ audit, setAudit }}>
      <div className="flex min-h-dvh flex-col">
        {children}
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-8 sm:px-6 lg:grid-cols-2 lg:px-8">
          <RefusalDemo view={view} />
          <AuditLog />
        </div>
        <ActionBar view={view} />
      </div>
    </Ctx.Provider>
  )
}
