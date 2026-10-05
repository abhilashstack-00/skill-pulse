'use client'

import { useState } from 'react'
import { Check, Download } from 'lucide-react'
import { ApiError, exportUrl, getRecommendations } from '@/lib/client/api'
import { toQuery, useFilters } from '@/lib/filters-context'
import { cx, formatDate, formatNumber, signed, signedPct } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { evidenceValue, recommendationText } from '@/lib/i18n/render'
import { gapTone, statusTone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'
import { PageHeader } from '@/components/layout/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Button, EmptyState, ErrorState, LoadingState, Pill, SectionCard } from '@/components/ui/primitives'

export function ActionCenterPage() {
  const { t, locale } = useI18n()
  const { meta, names } = useMeta()
  const { filters } = useFilters()
  const query = toQuery(filters, ['stateId', 'districtId', 'sectorId', 'tradeId'])
  // Wait for the session before asking, so a role without planner access is told so
  // on the page instead of the browser sending a request that is bound to be refused.
  const allowed = meta ? meta.session.permissions.recommendations : null
  const actions = useService(
    () =>
      allowed === null ? new Promise<Awaited<ReturnType<typeof getRecommendations>>>(() => {})
      : allowed ? getRecommendations(query)
      : Promise.reject(new ApiError(403, 'forbidden')),
    [filters.stateId, filters.districtId, filters.sectorId, filters.tradeId, allowed],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())

  const queue = (actions.data?.items ?? []).filter((item) => item.action !== 'maintain')
  const selected = queue.find((item) => item.id === selectedId) ?? queue[0]
  const open = queue.filter((item) => !reviewed.has(item.id)).length

  const toggleReviewed = (id: string) =>
    setReviewed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="page">
      <PageHeader title="action.title" subtitle="action.subtitle" />
      <FilterBar fields={['state', 'district', 'sector', 'trade']}>
        {meta?.session.permissions.export && (
          <a className="btn btn-secondary btn-sm" href={exportUrl('recommendations', query)} download>
            <Download aria-hidden="true" /> {t('common.export')}
          </a>
        )}
      </FilterBar>

      {actions.status === 'error' ? (
        <SectionCard className="action-card"><ErrorState error={actions.error} onRetry={actions.retry} /></SectionCard>
      ) : !actions.data ? (
        <>
          <div className="action-count"><div className="skeleton" style={{ width: 190, height: 17 }} /></div>
          <SectionCard className="action-card"><LoadingState height={200} /></SectionCard>
        </>
      ) : !selected ? (
        <SectionCard className="action-card"><EmptyState title={t('action.empty')} text={t('action.emptyText')} /></SectionCard>
      ) : (
        (() => {
          const text = recommendationText(t, names, selected)
          const row = selected.row
          return (
            <div className={cx(actions.refreshing && 'is-refreshing')}>
              <p className="action-count" aria-live="polite">
                {open === 1 ? t('action.countOne') : t('action.count', { count: open })}
                {reviewed.size > 0 && ` · ${t('action.underReview', { count: reviewed.size })}`}
              </p>

              <SectionCard className="action-card" aria-labelledby="action-title">
                <p className={cx('action-tag', `tone-${statusTone[selected.status]}`)}>{text.tag} · {t(`status.${selected.status}`)}</p>
                <h2 className="action-title" id="action-title">{text.title}</h2>
                <p className="action-meta">{names.district(selected.districtId)}, {names.state(selected.stateId)} · {names.sector(selected.sectorId)}</p>
                <dl className="action-metrics is-five" style={{ marginBottom: 0 }}>
                  <Metric label={t('action.metric.demandTrend')} value={row.demandTrendPct === null ? '—' : signedPct(row.demandTrendPct)} tone="neutral" />
                  <Metric label={t('action.metric.capacityChange')} value={row.capacityChangePct === null ? '—' : signedPct(row.capacityChangePct)} tone="neutral" />
                  <Metric label={t('action.metric.gap')} value={row.gap === null ? '—' : signed(row.gap)} tone={gapTone(row.status)} />
                  <Metric label={t('action.metric.gapPct')} value={row.gapPercentage === null ? '—' : signedPct(row.gapPercentage)} tone={gapTone(row.status)} />
                  <Metric label={t('action.metric.priority')} value={selected.priorityScore === null ? '—' : formatNumber(selected.priorityScore, 1)} tone="neutral" />
                </dl>
                <div className="action-footer">
                  <div>
                    <p className="action-suggestion">{t('action.suggested', { text: text.text })}</p>
                    {text.secondary && <p className="notice-action">{text.secondary}</p>}
                  </div>
                  <div className="action-buttons">
                    {reviewed.has(selected.id) ? (
                      <Button variant="secondary" onClick={() => toggleReviewed(selected.id)}><Check aria-hidden="true" /> {t('action.reviewing')}</Button>
                    ) : (
                      <Button onClick={() => toggleReviewed(selected.id)} title={t('action.reviewNote')}>{t('action.review')}</Button>
                    )}
                  </div>
                </div>
              </SectionCard>

              <div className="split action-row">
                <SectionCard className="queue-card" aria-labelledby="queue-title">
                  <div className="card-header">
                    <h2 className="card-title" id="queue-title">{t('action.queue')}</h2>
                    <span className="queue-count">{t('action.queue.count', { count: queue.length })}</span>
                  </div>
                  <ul className="queue-list">
                    {queue.map((item) => (
                      <li key={item.id}>
                        <button type="button" className="queue-item" aria-current={item.id === selected.id} onClick={() => setSelectedId(item.id)}>
                          <span>
                            <span className="queue-name">{recommendationText(t, names, item).title}</span>
                            <span className="queue-place">{names.district(item.districtId)}, {names.state(item.stateId)}</span>
                          </span>
                          <span className={cx('queue-gap', `tone-${gapTone(item.status)}`)}>{item.row.gapPercentage === null ? '—' : signedPct(item.row.gapPercentage, 0)}</span>
                          {reviewed.has(item.id) ? <Pill tone="neutral">{t('action.inReview')}</Pill> : <Pill tone={item.priority.band === 'high' ? 'danger' : item.priority.band === 'medium' ? 'warning' : 'neutral'}>{item.priority.band ? t(`band.${item.priority.band}`) : t('common.notAvailable')}</Pill>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard className="trace-card" aria-labelledby="trace-title">
                  <h2 className="card-title" id="trace-title">{t('action.trace')}</h2>
                  <dl className="trace-rows" style={{ marginBottom: 0 }}>
                    {selected.evidence.map((item) => (
                      <Trace key={item.key} label={t(item.key)} value={evidenceValue(t, item)} />
                    ))}
                    <Trace label={t('action.trace.demandSources')} value={`${actions.data.sources.demand.length} · ${actions.data.sources.demand.map((s) => s.name).join(', ')}`} />
                    <Trace label={t('action.trace.supplySources')} value={`${actions.data.sources.supply.length} · ${actions.data.sources.supply.map((s) => s.name).join(', ')}`} />
                    <Trace label={t('action.trace.history')} value={t('action.trace.historyValue', { months: selected.coverage.monthsObserved })} />
                    <Trace label={t('common.freshness')} value={`${formatDate(actions.data.freshness, locale)} · ${t('app.synthetic')}`} />
                    <Trace label={t('action.trace.method')} value={t('action.trace.methodValue')} />
                  </dl>
                </SectionCard>
              </div>
            </div>
          )
        })()
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <dt className="action-metric-label">{label}</dt>
      <dd className={cx('action-metric-value', `tone-${tone}`)} style={{ marginLeft: 0 }}>{value}</dd>
    </div>
  )
}

function Trace({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row trace-row">
      <dt className="kv-label">{label}</dt>
      <dd className="kv-value" style={{ marginLeft: 0 }}>{value}</dd>
    </div>
  )
}
