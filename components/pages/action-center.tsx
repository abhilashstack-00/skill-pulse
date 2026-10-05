'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import type { ActionSeverity, Tone } from '@/lib/types'
import { useFilters } from '@/lib/filters-context'
import { useService } from '@/lib/hooks/use-service'
import { getActions } from '@/lib/services/skillpulse'
import { gapTone } from '@/lib/services/derive'
import { cx, formatDate, signed } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { Button, EmptyState, ErrorState, LoadingState, Pill, SectionCard } from '@/components/ui/primitives'

const SEVERITY: Record<ActionSeverity, { label: string; short: string; tone: Tone }> = {
  critical: { label: 'Critical action', short: 'Critical', tone: 'danger' },
  priority: { label: 'Priority action', short: 'Priority', tone: 'warning' },
  rebalance: { label: 'Rebalance action', short: 'Rebalance', tone: 'warning' },
  watch: { label: 'Watch', short: 'Watch', tone: 'primary' },
}

export function ActionCenterPage() {
  const { filters, setFilters } = useFilters()
  const actions = useService(getActions, [])
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())
  const list = actions.data ?? []
  const selected = list.find((a) => a.skillId === filters.skillId) ?? list[0]
  const open = list.filter((a) => !reviewed.has(a.id)).length

  const toggleReviewed = (id: string) =>
    setReviewed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="page">
      <PageHeader title="Planning Action Center" subtitle="Convert analytics into transparent, reviewable planning actions." />

      {actions.status === 'error' ? (
        <SectionCard className="action-card">
          <ErrorState text={actions.error.message} onRetry={actions.retry} />
        </SectionCard>
      ) : !actions.data ? (
        <>
          <div className="action-count"><div className="skeleton" style={{ width: 190, height: 17 }} /></div>
          <SectionCard className="action-card"><LoadingState height={200} label="Loading actions" /></SectionCard>
        </>
      ) : !selected ? (
        <SectionCard className="action-card">
          <EmptyState title="No actions need attention" text="All monitored skills are in balance for the pilot regions." />
        </SectionCard>
      ) : (
        <>
          <p className="action-count" aria-live="polite">
            {open} {open === 1 ? 'action requires' : 'actions require'} attention
            {reviewed.size > 0 && ` · ${reviewed.size} under review`}
          </p>

          <SectionCard className="action-card" aria-labelledby="action-title">
            <p className={cx('action-tag', `tone-${SEVERITY[selected.severity].tone}`)}>{SEVERITY[selected.severity].label}</p>
            <h2 className="action-title" id="action-title">{selected.title}</h2>
            <p className="action-meta">{selected.metrics.state.name} · {selected.metrics.skill.sector}</p>
            <dl className="action-metrics" style={{ marginBottom: 0 }}>
              <Metric label="Demand growth" value={signed(selected.metrics.demandGrowth, '%')} tone="neutral" />
              <Metric label="Training growth" value={signed(selected.metrics.supplyGrowth, '%')} tone="neutral" />
              <Metric label="Current gap" value={signed(selected.metrics.gapIndex)} tone={gapTone(selected.metrics.gapIndex)} />
              <Metric label="6M forecast" value={signed(selected.forecast6M.gap)} tone={gapTone(selected.forecast6M.gap)} />
            </dl>
            <div className="action-footer">
              <p className="action-suggestion">Suggested action: {selected.suggestedAction}</p>
              <div className="action-buttons">
                {reviewed.has(selected.id) ? (
                  <Button variant="secondary" onClick={() => toggleReviewed(selected.id)} aria-label="Under review. Undo.">
                    <Check aria-hidden="true" /> Under review · Undo
                  </Button>
                ) : (
                  <Button onClick={() => toggleReviewed(selected.id)}>Review Action</Button>
                )}
              </div>
            </div>
          </SectionCard>

          <div className="split action-row">
            <SectionCard className="queue-card" aria-labelledby="queue-title">
              <div className="card-header">
                <h2 className="card-title" id="queue-title">Action queue</h2>
                <span className="queue-count">{list.length} actions</span>
              </div>
              <ul className="queue-list">
                {list.map((action) => (
                  <li key={action.id}>
                    <button
                      type="button"
                      className="queue-item"
                      aria-current={action.id === selected.id}
                      onClick={() => setFilters({ skillId: action.skillId, stateId: action.metrics.state.id, sector: action.metrics.skill.sector, districtId: null })}
                    >
                      <span>
                        <span className="queue-name">{action.title}</span>
                        <span className="queue-place">{action.metrics.district.name}, {action.metrics.state.name}</span>
                      </span>
                      <span className={cx('queue-gap', `tone-${gapTone(action.metrics.gapIndex)}`)}>{signed(action.metrics.gapIndex)}</span>
                      {reviewed.has(action.id) ? (
                        <Pill tone="neutral">In review</Pill>
                      ) : (
                        <Pill tone={SEVERITY[action.severity].tone}>{SEVERITY[action.severity].short}</Pill>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard className="trace-card" aria-labelledby="trace-title">
              <h2 className="card-title" id="trace-title">Evidence &amp; traceability</h2>
              <dl className="trace-rows" style={{ marginBottom: 0 }}>
                <Trace label="Demand sources" value={String(selected.evidence.demandSources.length)} hint={selected.evidence.demandSources.map((s) => s.name).join(', ')} />
                <Trace label="Supply sources" value={String(selected.evidence.supplySources.length)} hint={selected.evidence.supplySources.map((s) => s.name).join(', ')} />
                <Trace label="Coverage" value={`${selected.evidence.coverage}%`} />
                <Trace label="Freshness" value={formatDate(selected.evidence.freshness)} />
                <Trace label="Method" value={selected.evidence.method} />
              </dl>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div>
      <dt className="action-metric-label">{label}</dt>
      <dd className={cx('action-metric-value', `tone-${tone}`)} style={{ marginLeft: 0 }}>{value}</dd>
    </div>
  )
}

function Trace({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kv-row trace-row">
      <dt className="kv-label">{label}</dt>
      <dd className="kv-value" style={{ marginLeft: 0 }} title={hint}>
        {value}
        {hint && <span className="sr-only"> ({hint})</span>}
      </dd>
    </div>
  )
}
