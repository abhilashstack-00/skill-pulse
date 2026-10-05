import { ArrowDown, ArrowUp, Inbox, Search, TriangleAlert, X } from 'lucide-react'
import type { GapStatus, Option, Priority, Tone } from '@/lib/types'
import { priorityLabel, priorityTone, statusLabel, statusTone } from '@/lib/services/derive'
import { cx } from '@/lib/format'

/* Buttons ------------------------------------------------------------------ */

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'
  size?: 'md' | 'sm'
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)} {...props} />
}

/* Cards --------------------------------------------------------------------- */

export function SectionCard({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cx('card', className)} {...props}>
      {children}
    </section>
  )
}

interface KpiCardProps {
  value: string
  label: string
  note: string
  tone: Tone
  /** Direction arrow shown before the note. */
  trend?: 'up' | 'down'
}

export function KpiCard({ value, label, note, tone, trend }: KpiCardProps) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      <div className={cx('kpi-note', `tone-${tone}`)}>
        {trend === 'up' && <ArrowUp aria-label="up" />}
        {trend === 'down' && <ArrowDown aria-label="down" />}
        {note}
      </div>
    </div>
  )
}

/* Pills --------------------------------------------------------------------- */

export function Pill({ tone, children, compact }: { tone: Tone; children: React.ReactNode; compact?: boolean }) {
  return <span className={cx('pill', `tone-${tone}`, compact && 'pill-compact')}>{children}</span>
}

/** Shortage / Balanced / Surplus — always the same colour for the same status. */
export function StatusBadge({ status }: { status: GapStatus }) {
  return <Pill tone={statusTone[status]}>{statusLabel[status]}</Pill>
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Pill tone={priorityTone[priority]}>{priorityLabel[priority]}</Pill>
}

/* Search -------------------------------------------------------------------- */

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
}

export function SearchInput({ value, onChange, placeholder = 'Search skills, locations…', label }: SearchInputProps) {
  return (
    <label className="search">
      <Search aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input type="search" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {value && (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <X aria-hidden="true" width={12} height={12} />
        </button>
      )}
    </label>
  )
}

/* Tabs ---------------------------------------------------------------------- */

interface TabsProps {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}

export function Tabs({ label, value, options, onChange }: TabsProps) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          className="tab"
          aria-selected={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
            const index = options.findIndex((o) => o.value === value)
            const next = options[(index + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
            onChange(next.value)
            const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
            tabs?.[options.indexOf(next)]?.focus()
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* Loading / empty / error --------------------------------------------------- */

export function LoadingState({ height = 220, label = 'Loading data' }: { height?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ padding: 24, minHeight: height }}>
      <div className="skeleton" style={{ width: '38%', height: 16 }} />
      <div className="skeleton" style={{ width: '100%', height: Math.max(40, height - 96), marginTop: 20 }} />
      <div className="skeleton" style={{ width: '62%', height: 12, marginTop: 16 }} />
    </div>
  )
}

export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className="kpi-card" key={index} role="status" aria-label="Loading metric">
          <div className="skeleton" style={{ width: 72, height: 28, marginTop: 4 }} />
          <div className="skeleton" style={{ width: 120, height: 12, marginTop: 12 }} />
          <div className="skeleton" style={{ width: 90, height: 12, marginTop: 9 }} />
        </div>
      ))}
    </>
  )
}

interface StateProps {
  title: string
  text?: string
  action?: React.ReactNode
}

export function EmptyState({ title, text, action }: StateProps) {
  return (
    <div className="state-block">
      <div className="state-icon">
        <Inbox aria-hidden="true" />
      </div>
      <p className="state-title">{title}</p>
      {text && <p className="state-text">{text}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Data could not be loaded', text, onRetry }: { title?: string; text?: string; onRetry?: () => void }) {
  return (
    <div className="state-block is-error" role="alert">
      <div className="state-icon">
        <TriangleAlert aria-hidden="true" />
      </div>
      <p className="state-title">{title}</p>
      {text && <p className="state-text">{text}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
