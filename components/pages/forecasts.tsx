'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { getAlerts, getForecasts } from '@/lib/client/api'
import type { HorizonKey } from '@/lib/domain/types'
import { toQuery, useFilters } from '@/lib/filters-context'
import { cx, formatDate, formatNumber, signed, signedPct } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { useMeta } from '@/components/layout/app-shell'
import { PageHeader } from '@/components/layout/page-header'
import { Legend, seriesColor } from '@/components/charts/chart-kit'
import { DemandSupplyChart } from '@/components/charts/demand-supply-chart'
import { FilterBar } from '@/components/ui/filter-bar'
import { useFigures, WarningList } from '@/components/ui/intelligence'
import { Button, EmptyState, ErrorState, LoadingState, SectionCard, StatusBadge } from '@/components/ui/primitives'

const HORIZONS: HorizonKey[] = ['current', '3M', '6M', '12M']

export function ForecastsPage() {
  const router = useRouter()
  const { t, locale } = useI18n()
  const { meta, names } = useMeta()
  const { filters, setFilters } = useFilters()
  const { num, periodText } = useFigures()
  const scopeQuery = toQuery(filters, ['stateId', 'districtId', 'sectorId', 'tradeId', 'horizon'])
  const deps = [filters.stateId, filters.districtId, filters.sectorId, filters.tradeId, filters.horizon]
  const forecast = useService(() => getForecasts(scopeQuery), deps)
  const alerts = useService(() => getAlerts(scopeQuery), deps.slice(0, 4))
  const data = forecast.data
  const totals = data?.totals
  const short = t(`horizon.short.${filters.horizon}`)
  const place = filters.districtId ? names.district(filters.districtId) : filters.stateId ? names.state(filters.stateId) : t('common.national')
  const tested = data?.backtest.find((b) => b.horizon === filters.horizon)

  return (
    <div className="page">
      <PageHeader title="forecast.title" subtitle="forecast.subtitle" />

      <div className="filter-bar">
        <div role="group" aria-label={t('filter.horizon')} style={{ display: 'contents' }}>
          {HORIZONS.map((h) => (
            <button key={h} type="button" className="toggle" aria-pressed={filters.horizon === h} onClick={() => setFilters({ horizon: h })}>
              {t(`horizon.${h}`)}
            </button>
          ))}
        </div>
      </div>
      <FilterBar fields={['state', 'district', 'sector', 'trade']} />

      <div className="split forecast-row content-top">
        <SectionCard className="forecast-card" aria-labelledby="forecast-title">
          <div className="card-header">
            <div>
              <h2 className="card-title" id="forecast-title">{t('forecast.chart')}</h2>
              <p className="card-subtitle">{t('forecast.scope', { trade: filters.tradeId ? names.trade(filters.tradeId) : filters.sectorId ? names.sector(filters.sectorId) : t('forecast.allTrades'), place })}</p>
            </div>
            <Legend
              items={[
                { label: t('forecast.legend.actual'), color: seriesColor.demand },
                { label: t('forecast.legend.forecast'), color: seriesColor.demand, kind: 'dashed' },
                { label: t('forecast.legend.band'), color: seriesColor.demand, kind: 'band' },
                { label: t('forecast.legend.capacity'), color: seriesColor.supply },
              ]}
            />
          </div>
          {forecast.status === 'error' ? (
            <ErrorState error={forecast.error} onRetry={forecast.retry} />
          ) : !data ? (
            <LoadingState height={390} />
          ) : data.history.length === 0 ? (
            <EmptyState title={t('forecast.empty')} text={t('common.emptyHint')} />
          ) : (
            <div className={cx('forecast-plot plot-surface', forecast.refreshing && 'is-refreshing')}>
              <DemandSupplyChart history={data.history} forecast={data.monthly} supplyPerMonth={data.supplyPerMonth} />
            </div>
          )}
        </SectionCard>

        <SectionCard className="warnings-card" aria-labelledby="warnings-title">
          <h2 className="card-title" id="warnings-title">{t('forecast.warnings')}</h2>
          {alerts.status === 'error' ? (
            <ErrorState error={alerts.error} onRetry={alerts.retry} />
          ) : !alerts.data ? (
            <LoadingState height={380} />
          ) : (
            <WarningList warnings={alerts.data.warnings} limit={3} />
          )}
        </SectionCard>
      </div>

      <SectionCard className="summary-card" aria-label={t('forecast.chart')}>
        {forecast.status === 'error' ? null : !data || !totals ? (
          <div className="skeleton" style={{ height: 60 }} role="status" aria-label={t('common.loading')} />
        ) : (
          <>
            <dl className={cx('summary-grid is-five', forecast.refreshing && 'is-refreshing')} style={{ margin: 0 }}>
              <div>
                <dt className="summary-label">{filters.horizon === 'current' ? t('forecast.summary.demandCurrent') : t('forecast.summary.demand', { horizon: short })}</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>{totals.demand === null ? t('common.insufficient') : num(totals.demand)}</dd>
              </div>
              <div>
                <dt className="summary-label">{t('forecast.summary.supply')}</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>{totals.supply === null ? t('common.insufficient') : num(totals.supply)}</dd>
              </div>
              <div>
                <dt className="summary-label">{t('forecast.summary.gap')}</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>
                  {totals.gap === null ? t('common.insufficient') : `${signed(totals.gap)}${totals.gapPercentage === null ? '' : ` (${signedPct(totals.gapPercentage)})`}`}
                </dd>
              </div>
              <div>
                <dt className="summary-label">{t('forecast.summary.confidence')}</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>
                  {filters.horizon === 'current' ? t('forecast.summary.observed') : totals.confidence ? `${t(`confidence.${totals.confidence.label}`)} · ${totals.confidence.score}` : t('common.insufficient')}
                </dd>
              </div>
              <div>
                <dt className="summary-label">{t('forecast.summary.freshness')}</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>{meta ? formatDate(meta.dataset.updatedAt, locale) : '—'}</dd>
              </div>
            </dl>
            <div className="action-footer" style={{ marginTop: 24 }}>
              <p className="summary-note" style={{ marginTop: 0 }}>
                <StatusBadge status={totals.status} /> &nbsp;{periodText(data.horizon)} · {t('common.pairs', { count: totals.cellsIncluded + totals.cellsExcluded })}
              </p>
              {meta?.session.permissions.recommendations && (
                <Button variant="secondary" onClick={() => router.push('/action-center')}>
                  {t('forecast.openActions')} <ArrowRight aria-hidden="true" />
                </Button>
              )}
            </div>
          </>
        )}
      </SectionCard>

      {data && totals && (
        <SectionCard className="build-card" aria-labelledby="build-title">
          <h2 className="card-title" id="build-title">{t('forecast.build.title')}</h2>
          <div className="build-lines">
            {data.components ? (
              <p>
                <strong>
                  {t('forecast.build.line', {
                    baseline: formatNumber(data.components.parts.baseline), trend: signed(data.components.parts.trend),
                    growth: signed(data.components.parts.recentGrowth), total: num(totals.demand),
                  })}
                </strong>{' '}
                {t('forecast.build.interval', { lower: num(totals.lower), upper: num(totals.upper) })}
              </p>
            ) : (
              <p><strong>{t('horizon.window.current')}</strong></p>
            )}
            <p>{t('forecast.build.methods', { methods: Object.entries(data.methods).map(([method, count]) => `${t(`method.short.${method}`)} ${count}`).join(' · ') })}</p>
            {totals.cellsExcluded > 0 && (
              <p>
                {t('forecast.build.excluded', { count: totals.cellsExcluded })}{' '}
                {data.excluded.slice(0, 4).map((x) => `${names.trade(x.tradeId)} (${names.district(x.districtId)})`).join(', ')}
              </p>
            )}
            {tested && tested.wape !== null && tested.p80Ape !== null && (
              <p>{t('forecast.backtest', { months: data.horizon.months, p80: formatNumber(tested.p80Ape, 1), wape: formatNumber(tested.wape, 1) })}</p>
            )}
            <p>{t('skill.forecast.model')}: {data.model.demand} · {data.model.supply}</p>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
