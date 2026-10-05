'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { getDrilldown, getTrade, type TradeData } from '@/lib/client/api'
import type { PriorityComponent } from '@/lib/domain/types'
import { useFilters } from '@/lib/filters-context'
import { cx, formatDate, formatNumber, signed, signedPct } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { bandTone, gapTone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'
import { PageHeader } from '@/components/layout/page-header'
import { Legend, seriesColor } from '@/components/charts/chart-kit'
import { DemandSupplyChart } from '@/components/charts/demand-supply-chart'
import { Drawer } from '@/components/ui/drawer'
import { FilterBar } from '@/components/ui/filter-bar'
import { RecommendationList, useFigures, WarningList } from '@/components/ui/intelligence'
import { Button, ComponentTable, EmptyState, ErrorState, KpiCard, KpiSkeleton, LoadingState, Pill, SectionCard, StatusBadge, Tabs } from '@/components/ui/primitives'

type Tab = 'demand' | 'supply' | 'gap' | 'forecast'

export function SkillIntelligencePage() {
  const router = useRouter()
  const { t, locale } = useI18n()
  const { names } = useMeta()
  const { filters, setFilters, resetFilters } = useFilters()
  const { num, periodText } = useFigures()
  const [tab, setTab] = useState<Tab | null>(null)

  // With no trade chosen, show the highest-priority trade in the selection.
  const geo = { stateId: filters.stateId, districtId: filters.districtId, horizon: filters.horizon }
  const ranking = useService(
    () => (filters.tradeId ? Promise.resolve(null) : getDrilldown({ ...geo, sectorId: filters.sectorId })),
    [filters.tradeId, filters.stateId, filters.districtId, filters.sectorId, filters.horizon],
  )
  const tradeId = filters.tradeId ?? ranking.data?.ranking[0]?.tradeId ?? null
  const trade = useService(() => (tradeId ? getTrade(tradeId, geo) : Promise.resolve(null)), [tradeId, filters.stateId, filters.districtId, filters.horizon])
  const data = trade.data
  const loading = trade.status === 'loading' || (!filters.tradeId && ranking.status === 'loading')
  const error = trade.status === 'error' ? trade : ranking.status === 'error' ? ranking : null

  const describe = (c: { key: string; raw: number | null; reference?: number | null }) => {
    const value = formatNumber(c.raw as number, Number.isInteger(c.raw) ? 0 : 1)
    if (c.key === 'hiringSignal' || c.key === 'industryDemandSignal') return t('comp.raw.score', { value })
    return t(`comp.raw.${c.key}`, { value, reference: c.reference === null || c.reference === undefined ? '' : formatNumber(c.reference, 0) })
  }

  return (
    <div className="page">
      <PageHeader title="skill.title" subtitle="skill.subtitle" />
      <FilterBar fields={['state', 'district', 'sector', 'trade', 'horizon']} focusTradeId={tradeId} />

      {error ? (
        <SectionCard className="content-top"><ErrorState error={error.error} onRetry={error.retry} /></SectionCard>
      ) : loading ? (
        <>
          <div className="skill-heading">
            <div className="skeleton" style={{ width: 220, height: 29 }} />
            <div className="skeleton" style={{ width: 260, height: 12, marginTop: 8 }} />
          </div>
          <div className="kpi-grid skill-kpis"><KpiSkeleton /></div>
          <div className="split skill-row">
            <SectionCard className="trend-card"><LoadingState height={400} /></SectionCard>
            <SectionCard className="why-card"><LoadingState height={400} /></SectionCard>
          </div>
        </>
      ) : !data || data.scope.cells === 0 ? (
        <SectionCard className="content-top">
          <EmptyState title={t('skill.empty')} text={t('skill.emptyText')} action={<Button variant="secondary" size="sm" onClick={() => resetFilters()}>{t('common.resetFilters')}</Button>} />
        </SectionCard>
      ) : (
        renderTrade(data)
      )}
    </div>
  )

  function renderTrade(data: TradeData) {
    const f = data.forecast
    const totals = f.totals
    const single = data.byDistrict.length === 1 ? data.byDistrict[0] : null
    const scopeText = single
      ? t('skill.scope.one', { district: names.district(single.districtId), state: names.state(single.stateId) })
      : t('skill.scope.many', { count: data.scope.cells })
    const priority = data.priority
    const horizonShort = t(`horizon.short.${f.horizon.key}`)
    const tradeName = names.trade(data.trade.id)

    const priorityRaw = (c: PriorityComponent) => {
      if (c.raw === null) return t('comp.missing')
      if (c.key === 'gapSeverity') return signedPct(c.raw)
      if (c.key === 'demandGrowth') return `${signedPct(c.raw)} ${t('common.perYear')}`
      if (c.key === 'capacityPressure') return `${formatNumber(c.raw, 1)}%`
      return `${formatNumber(c.raw, 1)} / 100`
    }

    return (
      <div className={cx(trade.refreshing && 'is-refreshing')}>
        <div className="skill-heading">
          <h2 className="skill-name">{tradeName}</h2>
          <p className="skill-meta">
            {t('skill.meta', { sector: names.sector(data.trade.sectorId), level: data.trade.nsqfLevel, nco: data.trade.ncoCode })} · {scopeText}
          </p>
        </div>

        <div className="kpi-grid skill-kpis">
          <KpiCard
            value={num(data.demand.index.value, 1)} label={t('skill.kpi.demandIndex')}
            note={data.demand.trendPct === null ? t('common.insufficient') : t('skill.kpi.trend', { value: `${formatNumber(Math.abs(data.demand.trendPct), 1)}%` })}
            trend={data.demand.trendPct === null ? undefined : data.demand.trendPct >= 0 ? 'up' : 'down'}
            tone={data.demand.trendPct === null ? 'neutral' : data.demand.trendPct >= 0 ? 'success' : 'warning'}
            onClick={() => setTab('demand')} actionLabel={t('common.explain')}
          />
          <KpiCard
            value={num(data.supply.index.value, 1)} label={t('skill.kpi.supplyIndex')}
            note={data.supply.capacityChangePct === null ? t('common.insufficient') : t('skill.kpi.capacity', { value: signedPct(data.supply.capacityChangePct) })}
            tone="neutral" onClick={() => setTab('supply')} actionLabel={t('common.explain')}
          />
          <KpiCard
            value={totals.gap === null ? '—' : signed(totals.gap)} label={t('skill.kpi.gap', { horizon: horizonShort })}
            note={totals.gapPercentage === null ? t(`status.${totals.status}`) : `${signedPct(totals.gapPercentage)} · ${t(`status.${totals.status}`)}`}
            tone={gapTone(totals.status)} onClick={() => setTab('gap')} actionLabel={t('common.explain')}
          />
          <KpiCard
            value={num(priority.score, 1)} label={t('skill.kpi.priority')}
            note={priority.band ? t(`band.long.${priority.band}`) : t('common.insufficient')}
            tone={priority.band ? bandTone[priority.band] : 'neutral'}
          />
        </div>

        <div className="split skill-row">
          <SectionCard className="trend-card" aria-labelledby="trend-title">
            <div className="card-header">
              <h2 className="card-title" id="trend-title">{t('skill.trend')}</h2>
              <Legend
                items={[
                  { label: t('skill.legend.demand'), color: seriesColor.demand },
                  ...(f.monthly.length ? [{ label: t('skill.legend.forecast'), color: seriesColor.demand, kind: 'dashed' as const }] : []),
                  ...(f.supplyPerMonth !== null ? [{ label: t('skill.legend.capacity'), color: seriesColor.supply }] : []),
                ]}
              />
            </div>
            {f.history.length ? (
              <div className="trend-plot plot-surface">
                <DemandSupplyChart history={f.history} forecast={f.monthly} supplyPerMonth={f.supplyPerMonth} />
              </div>
            ) : (
              <EmptyState title={t('common.insufficient')} />
            )}
            <p className="trend-note">{t('skill.trend.note', { scope: scopeText })}</p>
          </SectionCard>

          <SectionCard className="why-card" aria-labelledby="why-title">
            <h2 className="card-title" id="why-title">
              {priority.band ? t('skill.why', { band: t(`band.${priority.band}`).toUpperCase() }) : t('skill.why.none')}
            </h2>
            <div className="why-rows">
              {priority.components.map((c) => (
                <div className="kv-row why-row" key={c.key}>
                  <span className="kv-label">{t(`comp.${c.key}`)} <span className="why-raw">× {formatNumber(c.weight, 2)}</span></span>
                  <span className="why-raw">{priorityRaw(c)}</span>
                  <span className="kv-value">{c.contribution === null ? '—' : `${formatNumber(c.contribution, 1)} ${t('common.pts')}`}</span>
                </div>
              ))}
            </div>
            {priority.score === null ? (
              <p className="muted-text">{t('skill.why.missing', { missing: priority.missing.map((key) => t(`comp.${key}`)).join(', ') })}</p>
            ) : (
              <p className="why-total"><span>{t('skill.why.score')}</span><strong>{formatNumber(priority.score, 1)} / 100</strong></p>
            )}
            <div className="why-footer">
              <Pill tone="neutral" compact>{t('common.notOfficial')}</Pill>
              <Button onClick={() => setTab('demand')}>{t('common.viewEvidence')}</Button>
            </div>
          </SectionCard>
        </div>

        <div className="split detail-row">
          <SectionCard className="detail-card" aria-labelledby="warnings-title">
            <h2 className="card-title" id="warnings-title">{t('skill.warnings')}</h2>
            <WarningList warnings={data.warnings} showPlace={!single} limit={4} />
          </SectionCard>
          <SectionCard className="detail-card" aria-labelledby="rec-title">
            <h2 className="card-title" id="rec-title">{t('skill.recommendation')}</h2>
            <RecommendationList items={data.recommendations} limit={single ? 1 : 3} />
          </SectionCard>
        </div>

        {!single && (
          <SectionCard className="drill-card" aria-labelledby="district-title">
            <div className="card-header"><h2 className="card-title" id="district-title">{t('skill.byDistrict')}</h2></div>
            <div className="table-scroll">
              <table className="data-table drill-table">
                <thead>
                  <tr>
                    <th scope="col">{t('filter.district')}</th>
                    <th scope="col">{t('explorer.col.demand')}</th>
                    <th scope="col">{t('explorer.col.supply')}</th>
                    <th scope="col">{t('explorer.col.gap')}</th>
                    <th scope="col">{t('explorer.col.gapPct')}</th>
                    <th scope="col">{t('explorer.col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDistrict.map((row) => (
                    <tr
                      key={row.key} tabIndex={0}
                      onClick={() => setFilters({ stateId: row.stateId, districtId: row.districtId, tradeId: row.tradeId })}
                      onKeyDown={(event) => { if (event.key === 'Enter') setFilters({ stateId: row.stateId, districtId: row.districtId, tradeId: row.tradeId }) }}
                    >
                      <td><span className="cell-strong">{names.district(row.districtId)}</span></td>
                      <td className="cell-num">{num(row.demand)}</td>
                      <td className="cell-num">{num(row.supply)}</td>
                      <td className={cx('cell-gap', `tone-${gapTone(row.status)}`)}>{row.gap === null ? '—' : signed(row.gap)}</td>
                      <td className={cx('cell-gap', `tone-${gapTone(row.status)}`)}>{row.gapPercentage === null ? '—' : signedPct(row.gapPercentage)}</td>
                      <td><StatusBadge status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        <Drawer
          open={tab !== null}
          onClose={() => setTab(null)}
          eyebrow={t('skill.drawer.eyebrow', { trade: tradeName, scope: scopeText })}
          title={t('skill.drawer.title')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setTab(null)}>{t('common.close')}</Button>
              <Button onClick={() => { setFilters({ tradeId: data.trade.id, sectorId: data.trade.sectorId }); router.push('/forecasts') }}>
                {t('skill.viewForecast')} <ArrowRight aria-hidden="true" />
              </Button>
            </>
          }
        >
          <Tabs
            label={t('skill.drawer.title')} value={tab ?? 'demand'} onChange={(value) => setTab(value as Tab)}
            options={(['demand', 'supply', 'gap', 'forecast'] as Tab[]).map((value) => ({ value, label: t(`skill.tab.${value}`) }))}
          />
          <div role="tabpanel">
            {tab === 'demand' && (
              <>
                <p className="calc-note">{t('skill.demand.intro')}{data.scope.cells > 1 && ` ${t('skill.demand.aggregate', { count: data.demand.index.cellsIncluded })}`}</p>
                <ComponentTable components={data.demand.index.components} total={data.demand.index.value} describe={describe} />
                <dl className="calc-list" style={{ marginTop: 14 }}>
                  <div className="kv-row"><dt className="kv-label">{t('skill.demand.runRate')}</dt><dd className="kv-value">{data.demand.monthlyRunRate === null ? t('common.insufficient') : t('skill.demand.runRateValue', { value: formatNumber(data.demand.monthlyRunRate, 1) })}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.demand.trend')}</dt><dd className="kv-value">{data.demand.trendPct === null ? t('common.insufficient') : `${signedPct(data.demand.trendPct)} ${t('common.perYear')}`}</dd></div>
                  {data.demand.monthsObserved !== null && <div className="kv-row"><dt className="kv-label">{t('skill.demand.history')}</dt><dd className="kv-value">{data.demand.monthsObserved}</dd></div>}
                </dl>
                <h3 className="drawer-section-title">{t('skill.demand.aliases')}</h3>
                <ul className="alias-list">{data.aliases.map((alias) => <li key={alias}>{alias}</li>)}</ul>
                {renderSources(t('skill.sources'), data.sources.demand)}
              </>
            )}
            {tab === 'supply' && (
              <>
                <p className="calc-note">{t('skill.supply.intro')}</p>
                <ComponentTable components={data.supply.index.components} total={data.supply.index.value} describe={describe} />
                <dl className="calc-list" style={{ marginTop: 14 }}>
                  <div className="kv-row"><dt className="kv-label">{t('skill.supply.seats', { year: cycle(data.supply.latestYear) })}</dt><dd className="kv-value">{num(data.supply.seats)}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.supply.enrolled')}</dt><dd className="kv-value">{data.supply.enrolled === null ? t('common.insufficient') : `${num(data.supply.enrolled)} (${num(data.supply.utilizationPct, 1)}%)`}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.supply.completed', { year: cycle(data.supply.outcomesYear ?? (data.supply.latestYear === null ? null : data.supply.latestYear - 1)) })}</dt><dd className="kv-value">{data.supply.completed === null ? t('common.insufficient') : `${num(data.supply.completed)} (${num(data.supply.completionRatePct, 1)}%)`}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.supply.placed')}</dt><dd className="kv-value">{data.supply.placed === null ? t('common.insufficient') : `${num(data.supply.placed)} (${num(data.supply.placementRatePct, 1)}%)`}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.supply.change')}</dt><dd className="kv-value">{data.supply.capacityChangePct === null ? t('common.insufficient') : signedPct(data.supply.capacityChangePct)}</dd></div>
                </dl>
                {renderSources(t('skill.sources'), data.sources.supply)}
              </>
            )}
            {tab === 'gap' && (
              <>
                <p className="calc-note">{t('skill.gap.intro')}</p>
                <dl className="calc-list">
                  <div className="kv-row"><dt className="kv-label">{t('skill.gap.window')}</dt><dd className="kv-value">{periodText(f.horizon)}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.gap.demand')}</dt><dd className="kv-value">{totals.demand === null ? t('common.insufficient') : num(totals.demand)}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.gap.supply')}</dt><dd className="kv-value">{totals.supply === null ? t('common.insufficient') : num(totals.supply)}</dd></div>
                  <div className="kv-row is-total"><dt className="kv-label">{t('skill.gap.gap')}</dt><dd className="kv-value">{totals.gap === null ? t('common.insufficient') : signed(totals.gap)}</dd></div>
                  <div className="kv-row is-total"><dt className="kv-label">{t('skill.gap.gapPct')}</dt><dd className="kv-value">{totals.gapPercentage === null ? t('common.insufficient') : signedPct(totals.gapPercentage, 2)}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.gap.class')}</dt><dd className="kv-value"><StatusBadge status={totals.status} /></dd></div>
                </dl>
                <p className="calc-note">{t('common.prototypeThresholds')}: {t('nav.methodology')}.</p>
                {totals.cellsExcluded > 0 && <p className="calc-note">{t('common.pairsExcluded', { count: totals.cellsExcluded })}</p>}
              </>
            )}
            {tab === 'forecast' && (
              <>
                <p className="calc-note">{t('skill.forecast.intro')}</p>
                {f.components ? (
                  <dl className="calc-list">
                    <div className="kv-row"><dt className="kv-label">{t('skill.forecast.baseline')}</dt><dd className="kv-value">{num(f.components.parts.baseline)}</dd></div>
                    <div className="kv-row"><dt className="kv-label">{t('skill.forecast.trend')}</dt><dd className="kv-value">{signed(f.components.parts.trend)}</dd></div>
                    <div className="kv-row"><dt className="kv-label">{t('skill.forecast.growth')}</dt><dd className="kv-value">{signed(f.components.parts.recentGrowth)}</dd></div>
                    <div className="kv-row is-total"><dt className="kv-label">{t('skill.forecast.total')}</dt><dd className="kv-value">{num(totals.demand)}</dd></div>
                    <div className="kv-row"><dt className="kv-label">{t('skill.forecast.interval')}</dt><dd className="kv-value">{num(totals.lower)} – {num(totals.upper)}</dd></div>
                    <div className="kv-row"><dt className="kv-label">{t('skill.forecast.confidence')}</dt><dd className="kv-value">{totals.confidence ? `${t(`confidence.${totals.confidence.label}`)} (${totals.confidence.score} / 100)` : t('common.insufficient')}</dd></div>
                    <div className="kv-row"><dt className="kv-label">{t('skill.forecast.method')}</dt><dd className="kv-value">{Object.keys(f.methods).map((m) => t(`method.short.${m}`)).join(', ')}</dd></div>
                    <div className="kv-row"><dt className="kv-label">{t('skill.forecast.model')}</dt><dd className="kv-value">{f.model.demand}</dd></div>
                  </dl>
                ) : (
                  <p className="calc-note"><strong>{f.horizon.key === 'current' ? t('horizon.window.current') : t('common.insufficient')}</strong></p>
                )}
                <p className="calc-note">{t('common.freshness')}: {formatDate(data.freshness, locale)}</p>
              </>
            )}
          </div>
        </Drawer>
      </div>
    )
  }

  function renderSources(title: string, sources: TradeData['sources']['demand']) {
    return (
      <>
        <h3 className="drawer-section-title">{title}</h3>
        <ul className="evidence-sources" style={{ marginTop: 0 }}>
          {sources.map((source) => (
            <li className="evidence-source" key={source.id}>
              <span>
                <strong>{source.name}</strong>
                <span>{t(`sources.status.${source.status}`)}</span>
              </span>
              <span>{source.lastUpdated ? formatDate(source.lastUpdated, locale) : '—'}</span>
            </li>
          ))}
        </ul>
      </>
    )
  }
}

/** 2026 → '2026-27' */
function cycle(year: number | null): string {
  return year === null ? '—' : `${year}-${String(year + 1).slice(2)}`
}
