import { cn } from '@/lib/utils'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

const toneStyles: Record<Tone, string> = {
  success: 'bg-success-soft text-success-foreground ring-success/20',
  warning: 'bg-warning-soft text-warning-foreground ring-warning/30',
  danger: 'bg-danger-soft text-danger-foreground ring-danger/20',
  neutral: 'bg-muted text-muted-foreground ring-border',
}

const dotStyles: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-muted-foreground',
}

export function StatusBadge({
  tone,
  children,
  className,
  dot = true,
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
  dot?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneStyles[tone],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn('size-1.5 rounded-full', dotStyles[tone])} />}
      {children}
    </span>
  )
}
