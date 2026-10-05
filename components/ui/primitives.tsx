'use client'

import { ArrowDown, ArrowUp, Inbox, Search, TriangleAlert, X } from 'lucide-react'
import type { GroupHeadline, WeightedComponent } from '@/lib/domain/types'
import { cx, formatNumber } from '@/lib/format'
import { useI18n } from '@/lib/i18n/context'
import { bandTone, headlineTone, type Tone } from '@/lib/ui/tones'

import type { Option } from './select'

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
  /** Makes the card a button, e.g. to open the calculation behind the value. */
  onClick?: () => void
  actionLabel?: string
}

export function KpiCard({ value, label, note, tone, trend, onClick, actionLabel }: KpiCardProps) {
  const body = (
    <>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      <div className={cx('kpi-note', `tone-${tone}`)}>
        {trend === 'up' && <ArrowUp aria-hidden="true" />}
        {trend === 'down' && <ArrowDown aria-hidden="true" />}
        {note}
      </div>
    </>
  )
  if (!onClick) return <div className="kpi-card">{body}</div>
  return (
    <button type="button" className="kpi-card is-action" onClick={onClick} aria-label={`${label}: ${value}. ${actionLabel ?? ''}`}>
      {body}
    </button>
  )
}

/* Pills --------------------------------------------------------------------- */

export function Pill({ tone, children, compact, strong }: { tone: Tone; children: React.ReactNode; compact?: boolean; strong?: boolean }) {
  return <span className={cx('pill', `tone-${tone}`, compact && 'pill-compact', strong && 'pill-strong')}>{children}</span>
}

/**
 * One colour per status everywhere; the label carries the distinction too.
 * Takes a pair's status or a group's headline (mostly shortage, mostly oversupply, mixed).
 */
export function StatusBadge({ status }: { status: GroupHeadline }) {
  const { t } = useI18n()
  return (
    <Pill tone={headlineTone[status]} strong={status === 'severe_shortage' || status === 'severe_oversupply'}>
      {t(`status.${status}`)}
    </Pill>
  )
}

/** `pairs` is given for a group: how many of its pairs are high priority. The band is then that of its highest pair. */
export function PriorityBadge({ band, pairs }: { band: 'high' | 'medium' | 'low' | null; pairs?: number }) {
  const { t } = useI18n()
  if (!band) return <Pill tone="neutral">{t('common.notAvailable')}</Pill>
  return <Pill tone={bandTone[band]}>{t(`band.${band}`)}{pairs !== undefined && pairs > 0 ? ` · ${pairs}` : ''}</Pill>
}

/**
 * The calculation behind a weighted index or score: each component's raw
 * input, its 0–100 value, its weight and what it contributes to the total.
 */
export function ComponentTable({ components, total, describe }: {
  components: (Pick<WeightedComponent, 'key' | 'weight' | 'contribution'> & { normalized?: number | null; value?: number | null; raw: number | null; reference?: number | null })[]
  total: number | null
  describe: (component: { key: string; raw: number | null; reference?: number | null }) => string
}) {
  const { t } = useI18n()
  return (
    <table className="calc-table">
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">{t('common.component')}</span></th>
          <th scope="col">{t('common.value')}</th>
          <th scope="col">{t('common.weight')}</th>
          <th scope="col">{t('common.contribution')}</th>
        </tr>
      </thead>
      <tbody>
        {components.map((c) => {
          const score = c.normalized ?? c.value ?? null
          return (
            <tr key={c.key}>
              <th scope="row">
                {t(`comp.${c.key}`)}
                <span>{c.raw === null ? t('comp.missing') : describe(c)}</span>
              </th>
              <td>{score === null ? '—' : formatNumber(score, 1)}</td>
              <td>× {formatNumber(c.weight, 2)}</td>
              <td>{c.contribution === null ? '—' : formatNumber(c.contribution, 2)}</td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{t('common.total')}</th>
          <td colSpan={3}>{total === null ? t('common.insufficient') : formatNumber(total, 1)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

/* Search -------------------------------------------------------------------- */

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
}

export function SearchInput({ value, onChange, placeholder, label }: SearchInputProps) {
  const { t } = useI18n()
  return (
    <label className="search">
      <Search aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input type="search" value={value} placeholder={placeholder ?? t('common.search')} onChange={(event) => onChange(event.target.value)} />
      {value && (
        <button type="button" className="search-clear" aria-label={t('common.reset')} onClick={() => onChange('')}>
          <X aria-hidden="true" width={12} height={12} />
        </button>
      )}
    </label>
  )
}

/* Tabs ---------------------------------------------------------------------- */

interface TabsProps {
  label: string
  /** Id of the panel the tabs control; each tab gets the id `tab-<value>` for the panel to be labelled by. */
  panelId?: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}

export function Tabs({ label, panelId, value, options, onChange }: TabsProps) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          id={`tab-${option.value}`}
          aria-controls={panelId}
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

export function LoadingState({ height = 220, label }: { height?: number; label?: string }) {
  const { t } = useI18n()
  return (
    <div role="status" aria-label={label ?? t('common.loading')} style={{ padding: 24, minHeight: height }}>
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
        <div className="kpi-card" key={index} role="status" aria-label="…">
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

export function ErrorState({ error, onRetry }: { error?: Error; onRetry?: () => void }) {
  const { t } = useI18n()
  const forbidden = (error as { status?: number } | undefined)?.status === 403
  return (
    <div className="state-block is-error" role="alert">
      <div className="state-icon">
        <TriangleAlert aria-hidden="true" />
      </div>
      <p className="state-title">{t(forbidden ? 'common.forbiddenTitle' : 'common.errorTitle')}</p>
      <p className="state-text">{forbidden && (!error?.message || error.message === 'forbidden') ? t('common.forbiddenText') : error?.message}</p>
      {onRetry && !forbidden && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
