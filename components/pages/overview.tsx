'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { getSummary, type SummaryData } from '@/lib/client/api'
import type { StatusFilter } from '@/lib/domain/types'
import { toQuery, useFilters, type Filters } from '@/lib/filters-context'
import { cx, formatNumber, signed, signedPct } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { gapTone, type Tone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'
import { PageHeader } from '@/components/layout/page-header'
import { BubbleRadar } from '@/components/charts/bubble-radar'
import { Drawer } from '@/components/ui/drawer'
import { FilterBar } from '@/components/ui/filter-bar'
import { useFigures } from '@/components/ui/intelligence'
import { Button, EmptyState, ErrorState, KpiCard, KpiSkeleton, LoadingState, PriorityBadge, SectionCard, StatusBadge } from '@/components/ui/primitives'

/** The headline figures that can be opened to see what they are made of. */
type Explain = 'demand' | 'supply' | 'shortage' | 'surplus' | 'highPriority' | 'emergingShortages' | 'emergingOversupply'
type ExplainRow = SummaryData['explain']['demand'][number]

export function OverviewPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { names } = useMeta()
  const { filters, setFilters } = useFilters()
  const { num, windowText, periodText } = useFigures()
  const summary = useService(() => getSummary(toQuery(filters, ['stateId', 'districtId', 'sectorId', 'tradeId', 'horizon'])), [filters.stateId, filters.districtId, filters.sectorId, filters.tradeId, filters.horizon])
  const data = summary.data
  const [explain, setExplain] = useState<Explain | null>(null)

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
  const open = (key: Explain) => ({ onClick: () => setExplain(key), actionLabel: t('common.explain') })

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
          {data?.dataQuality.flagged && (
            <div className="notice tone-warning content-top" role="note">
              <p className="notice-kind">{t('overview.quality.title')}</p>
              {data.dataQuality.sources.filter((s) => s.flagged).map((s) => (
                <p className="notice-text" key={s.sourceId}>
                  {s.sharePct !== null && s.valueRead !== null && s.valueMapped !== null && s.sharePct < data.dataQuality.minVolumeSharePct
                    ? t('overview.quality.text', { source: s.name, share: formatNumber(s.sharePct, 1), mapped: formatNumber(s.valueMapped), read: formatNumber(s.valueRead) })
                    : t('overview.quality.rows', { source: s.name, share: formatNumber(s.rowSharePct, 1), mapped: formatNumber(s.rowsMapped), read: formatNumber(s.rowsRead) })}
                  {s.largeRejects > 0 && ` ${t('overview.quality.large', { count: s.largeRejects, threshold: data.dataQuality.largeRejectSharePct })}`}
                </p>
              ))}
            </div>
          )}
          <div className="kpi-grid is-eight content-top">
            {data ? (
              <>
                <KpiCard
                  value={num(data.totals.demand)}
                  label={t(data.horizon.key === 'current' ? 'overview.kpi.demandCurrent' : 'overview.kpi.demand')}
                  note={t('overview.kpi.demandNote', { window: windowText(data.horizon) })} tone="primary" {...open('demand')}
                />
                <KpiCard value={num(data.totals.supply)} label={t('overview.kpi.supply')} note={t('overview.kpi.supplyNote', { window: windowText(data.horizon) })} tone="success" {...open('supply')} />
                <KpiCard value={num(data.totals.shortageTotal)} label={t('overview.kpi.shortage')} note={t(data.horizon.key === 'current' ? 'overview.kpi.shortageNoteCurrent' : 'overview.kpi.shortageNote', { count: data.totals.shortagePairs, firm: data.totals.firmShortagePairs })} tone="danger" {...open('shortage')} />
                <KpiCard value={num(Math.abs(data.totals.surplusTotal))} label={t('overview.kpi.surplus')} note={t(data.horizon.key === 'current' ? 'overview.kpi.surplusNoteCurrent' : 'overview.kpi.surplusNote', { count: data.totals.oversupplyPairs, firm: data.totals.firmOversupplyPairs })} tone="warning" {...open('surplus')} />
                <KpiCard value={String(data.counts.highPriorityTrades)} label={t('overview.kpi.highPriority')} note={t('overview.kpi.highPriorityNote', { score: data.priorityBands.high })} tone="danger" {...open('highPriority')} />
                <KpiCard value={String(data.counts.emergingShortages)} label={t('overview.kpi.emergingShortage')} note={t('overview.kpi.emergingShortageNote')} tone="danger" {...open('emergingShortages')} />
                <KpiCard value={String(data.counts.emergingOversupply)} label={t('overview.kpi.emergingOversupply')} note={t('overview.kpi.emergingOversupplyNote')} tone="warning" {...open('emergingOversupply')} />
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
                  <p className="card-subtitle balance-headline">
                    <StatusBadge status={data.totals.headline} /> {t('overview.balance.net', { value: data.totals.gap === null ? '—' : signed(data.totals.gap) })}
                  </p>
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
      {data && renderExplain(data)}
    </div>
  )

  /** What a headline number is made of: its definition, how it adds up, and the pairs behind it. */
  function renderExplain(d: SummaryData) {
    const rows: ExplainRow[] = explain ? d.explain[explain] : []
    const tot = d.totals
    const value = (row: ExplainRow) =>
      explain === 'demand' ? num(row.demand)
      : explain === 'supply' ? num(row.supply)
      : explain === 'highPriority' || explain === 'emergingShortages' || explain === 'emergingOversupply' ? (row.priorityScore === null ? '—' : formatNumber(row.priorityScore, 1))
      : row.gap === null ? '—' : signed(row.gap)
    const total =
      explain === 'demand' ? num(tot.demand) : explain === 'supply' ? num(tot.supply)
      : explain === 'shortage' ? num(tot.shortageTotal) : explain === 'surplus' ? num(Math.abs(tot.surplusTotal))
      : explain === 'highPriority' ? String(d.counts.highPriorityTrades) : explain === 'emergingShortages' ? String(d.counts.emergingShortages) : String(d.counts.emergingOversupply)
    const pairCount =
      explain === 'demand' || explain === 'supply' ? tot.cellsIncluded
      : explain === 'shortage' ? tot.shortagePairs : explain === 'surplus' ? tot.oversupplyPairs
      : explain === 'highPriority' ? d.counts.highPriorityCells : explain === 'emergingShortages' ? d.counts.emergingShortages : d.counts.emergingOversupply
    const status: StatusFilter | null = explain === 'shortage' ? 'any_shortage' : explain === 'surplus' ? 'any_oversupply' : null
    return (
      <Drawer
        open={explain !== null}
        onClose={() => setExplain(null)}
        eyebrow={periodText(d.horizon)}
        title={explain ? t(`overview.explain.${explain}.title`) : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExplain(null)}>{t('common.close')}</Button>
            <Button onClick={() => go('/gap-analysis', { status })}>{t('overview.explain.openMatrix')} <ArrowRight aria-hidden="true" /></Button>
          </>
        }
      >
        {explain && (
          <>
            <p className="calc-note">{t(`overview.explain.${explain}.text`, { score: d.priorityBands.high, horizon: t(`horizon.${d.planningHorizon}`) })}</p>
            <dl className="calc-list">
              <div className="kv-row is-total"><dt className="kv-label">{t(`overview.explain.${explain}.title`)}</dt><dd className="kv-value">{total}</dd></div>
              <div className="kv-row"><dt className="kv-label">{t('overview.explain.pairs')}</dt><dd className="kv-value">{pairCount}</dd></div>
              {(explain === 'shortage' || explain === 'surplus') && (
                <>
                  <div className="kv-row"><dt className="kv-label">{t('overview.kpi.shortage')}</dt><dd className="kv-value">{signed(tot.shortageTotal)}</dd></div>
                  {d.horizon.key !== 'current' && <div className="kv-row"><dt className="kv-label">{t('overview.explain.firm')}</dt><dd className="kv-value">{signed(tot.firmShortageTotal)} · {t('common.pairs', { count: tot.firmShortagePairs })}</dd></div>}
                  <div className="kv-row"><dt className="kv-label">{t('overview.kpi.surplus')}</dt><dd className="kv-value">{signed(tot.surplusTotal)}</dd></div>
                  {d.horizon.key !== 'current' && <div className="kv-row"><dt className="kv-label">{t('overview.explain.firm')}</dt><dd className="kv-value">{signed(tot.firmSurplusTotal)} · {t('common.pairs', { count: tot.firmOversupplyPairs })}</dd></div>}
                  <div className="kv-row"><dt className="kv-label">{t('skill.gap.balancedNet')}</dt><dd className="kv-value">{signed(tot.balancedNet)}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.gap.net')}</dt><dd className="kv-value">{tot.gap === null ? '—' : signed(tot.gap)}</dd></div>
                </>
              )}
              {tot.cellsExcluded > 0 && (explain === 'demand' || explain === 'supply') && (
                <div className="kv-row"><dt className="kv-label">{t('overview.explain.excluded')}</dt><dd className="kv-value">{d.explain.excluded.map((r) => `${names.trade(r.tradeId)} (${names.district(r.districtId)})`).join(', ')}</dd></div>
              )}
            </dl>
            <h3 className="drawer-section-title">{t('overview.explain.largest', { shown: rows.length, total: pairCount })}</h3>
            {rows.length === 0 ? (
              <p className="calc-note">{t('common.empty')}</p>
            ) : (
              <ul className="evidence-sources" style={{ marginTop: 0 }}>
                {rows.map((row) => (
                  <li className="evidence-source" key={row.key}>
                    <button type="button" className="link-btn explain-link" onClick={() => go('/skill-intelligence', { stateId: row.stateId, districtId: row.districtId, sectorId: row.sectorId, tradeId: row.tradeId })}>
                      <strong>{names.trade(row.tradeId)}</strong>
                      <span>{names.district(row.districtId)} · {t(`status.${row.status}`)}</span>
                    </button>
                    <span>{value(row)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Drawer>
    )
  }
}
