'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { getSummary } from '@/lib/client/api'
import type { StatusFilter } from '@/lib/domain/types'
import { toQuery, useFilters, type Filters } from '@/lib/filters-context'
import { cx, formatNumber, signedPct } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { gapTone, type Tone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'
import { PageHeader } from '@/components/layout/page-header'
import { BubbleRadar } from '@/components/charts/bubble-radar'
import { FilterBar } from '@/components/ui/filter-bar'
import { useFigures } from '@/components/ui/intelligence'
import { EmptyState, ErrorState, KpiCard, KpiSkeleton, LoadingState, PriorityBadge, SectionCard } from '@/components/ui/primitives'

export function OverviewPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { names } = useMeta()
  const { filters, setFilters } = useFilters()
  const { num, windowText, periodText } = useFigures()
  const summary = useService(() => getSummary(toQuery(filters, ['stateId', 'districtId', 'sectorId', 'tradeId', 'horizon'])), [filters.stateId, filters.districtId, filters.sectorId, filters.tradeId, filters.horizon])
  const data = summary.data

  const go = (href: string, patch: Partial<Filters>) => {
    setFilters(patch)
    router.push(href)
  }

  const counts = data?.statusCounts
  const tiles: { key: string; tone: Tone; value: number; severe: number | null; status: StatusFilter }[] = counts
    ? [
        { key: 'shortage', tone: 'danger', value: counts.shortage + counts.severe_shortage, severe: counts.severe_shortage, status: 'any_shortage' },
        { key: 'balanced', tone: 'success', value: counts.balanced, severe: null, status: 'balanced' },
        { key: 'oversupply', tone: 'warning', value: counts.oversupply + counts.severe_oversupply, severe: counts.severe_oversupply, status: 'any_oversupply' },
      ]
    : []
  const shortagePairs = counts ? counts.shortage + counts.severe_shortage : 0
  const surplusPairs = counts ? counts.oversupply + counts.severe_oversupply : 0

  return (
    <div className="page">
      <PageHeader title="overview.title" subtitle="overview.subtitle" />
      <FilterBar fields={['state', 'district', 'sector', 'trade', 'horizon']} />

      {summary.status === 'error' ? (
        <SectionCard className="content-top">
          <ErrorState error={summary.error} onRetry={summary.retry} />
        </SectionCard>
      ) : (
        <div className={cx(summary.refreshing && data && 'is-refreshing')}>
          <div className="kpi-grid is-eight content-top">
            {data ? (
              <>
                <KpiCard
                  value={num(data.totals.demand)}
                  label={t(data.horizon.key === 'current' ? 'overview.kpi.demandCurrent' : 'overview.kpi.demand')}
                  note={t('overview.kpi.demandNote', { window: windowText(data.horizon) })} tone="primary"
                />
                <KpiCard value={num(data.totals.supply)} label={t('overview.kpi.supply')} note={t('overview.kpi.supplyNote', { window: windowText(data.horizon) })} tone="success" />
                <KpiCard value={num(data.totals.shortageTotal)} label={t('overview.kpi.shortage')} note={t('overview.kpi.shortageNote', { count: shortagePairs })} tone="danger" />
                <KpiCard value={num(Math.abs(data.totals.surplusTotal))} label={t('overview.kpi.surplus')} note={t('overview.kpi.surplusNote', { count: surplusPairs })} tone="warning" />
                <KpiCard value={String(data.counts.highPriorityTrades)} label={t('overview.kpi.highPriority')} note={t('overview.kpi.highPriorityNote')} tone="danger" />
                <KpiCard value={String(data.counts.emergingShortages)} label={t('overview.kpi.emergingShortage')} note={t('overview.kpi.emergingShortageNote')} tone="danger" />
                <KpiCard value={String(data.counts.emergingOversupply)} label={t('overview.kpi.emergingOversupply')} note={t('overview.kpi.emergingOversupplyNote')} tone="warning" />
                <KpiCard value={t(`horizon.${data.horizon.key}`)} label={t('overview.kpi.horizon')} note={periodText(data.horizon)} tone="primary" />
              </>
            ) : (
              <KpiSkeleton count={8} />
            )}
          </div>

          <div className="split overview-row">
            <SectionCard className="balance-card" aria-labelledby="balance-title">
              <h2 className="card-title" id="balance-title">{t('overview.balance')}</h2>
              {data ? (
                <>
                  <div className="balance-tiles">
                    {tiles.map((tile) => (
                      <button
                        key={tile.key}
                        type="button"
                        className={cx('balance-tile', `tone-${tile.tone}`)}
                        aria-label={`${t(`overview.balance.${tile.key}`)}: ${tile.value}. ${t('nav.gapAnalysis')}`}
                        onClick={() => go('/gap-analysis', { status: tile.status })}
                      >
                        <span className="balance-tile-label">{t(`overview.balance.${tile.key}`)}</span>
                        <span className="balance-tile-value">{tile.value}</span>
                        {tile.severe !== null && <span className="balance-tile-sub">{t('overview.balance.severe', { count: tile.severe })}</span>}
                        <span className="balance-tile-link">{t('overview.balance.explore')} <ArrowRight aria-hidden="true" /></span>
                      </button>
                    ))}
                  </div>
                  {data.statusCounts.insufficient_data > 0 && (
                    <p className="muted-text">{t('overview.balance.insufficient', { count: data.statusCounts.insufficient_data })}</p>
                  )}
                </>
              ) : (
                <LoadingState height={200} />
              )}
            </SectionCard>

            <SectionCard className="signals-card" aria-labelledby="signals-title">
              <h2 className="card-title" id="signals-title">{t('overview.signals')}</h2>
              {!data ? (
                <LoadingState height={200} />
              ) : data.signals.length === 0 ? (
                <EmptyState title={t('overview.signals.empty')} text={t('overview.signals.emptyText')} />
              ) : (
                <div className="signal-list">
                  {data.signals.map((row) => (
                    <button
                      key={row.key}
                      type="button"
                      className="signal-row"
                      aria-label={`${names.trade(row.tradeId)}, ${names.district(row.districtId)}: ${row.gapPercentage === null ? '' : signedPct(row.gapPercentage)}. ${t('nav.marketExplorer')}`}
                      onClick={() => go('/market-explorer', { stateId: row.stateId, districtId: row.districtId, sectorId: row.sectorId, tradeId: null })}
                    >
                      <span>
                        <span className="signal-name">{names.trade(row.tradeId)}</span>
                        <span className="signal-place">{names.district(row.districtId)}, {names.state(row.stateId)}</span>
                      </span>
                      <span className={cx('signal-gap', `tone-${gapTone(row.status)}`)}>{row.gapPercentage === null ? '—' : signedPct(row.gapPercentage, 0)}</span>
                      <PriorityBadge band={row.priorityBand} />
                    </button>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard className="radar-card" aria-labelledby="radar-title">
            <h2 className="card-title" id="radar-title">{t('overview.radar')}</h2>
            <p className="card-subtitle">{t('overview.radar.subtitle')}</p>
            {!data ? (
              <LoadingState height={245} />
            ) : data.radar.length === 0 ? (
              <EmptyState title={t('common.empty')} text={t('common.emptyHint')} />
            ) : (
              <BubbleRadar data={data.radar} onSelect={(row) => go('/skill-intelligence', { stateId: row.stateId, districtId: row.districtId, sectorId: row.sectorId, tradeId: row.tradeId })} />
            )}
          </SectionCard>
          {data && data.totals.cellsExcluded > 0 && (
            <p className="drill-note" style={{ paddingLeft: 0, marginTop: 12 }}>
              {t('common.pairs', { count: formatNumber(data.totals.cells) })} · {t('common.pairsExcluded', { count: data.totals.cellsExcluded })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
