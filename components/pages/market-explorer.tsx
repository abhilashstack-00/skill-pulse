'use client'

import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { getDrilldown, type DrilldownData } from '@/lib/client/api'
import { toQuery, useFilters, type Filters } from '@/lib/filters-context'
import { cx, formatNumber, signed, signedPct } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { gapTone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'
import { PageHeader } from '@/components/layout/page-header'
import { Legend } from '@/components/charts/chart-kit'
import { StateMap } from '@/components/charts/state-map'
import { FilterBar } from '@/components/ui/filter-bar'
import { useFigures } from '@/components/ui/intelligence'
import { Button, EmptyState, ErrorState, LoadingState, PriorityBadge, SectionCard, StatusBadge } from '@/components/ui/primitives'

type Child = DrilldownData['children'][number]

export function MarketExplorerPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { meta, names } = useMeta()
  const { filters, setFilters, resetFilters } = useFilters()
  const { num } = useFigures()
  const explorer = useService(() => getDrilldown(toQuery(filters, ['stateId', 'districtId', 'sectorId', 'tradeId', 'horizon'])), [filters.stateId, filters.districtId, filters.sectorId, filters.tradeId, filters.horizon])
  const data = explorer.data
  const session = meta?.session

  const openTrade = (patch: Partial<Filters>) => {
    setFilters(patch)
    router.push('/skill-intelligence')
  }

  const nameOf = (child: Child) =>
    child.level === 'state' ? names.state(child.id) : child.level === 'district' ? names.district(child.id) : child.level === 'sector' ? names.sector(child.id) : names.trade(child.id)

  const drill = (child: Child) => {
    if (child.level === 'state') setFilters({ stateId: child.id, districtId: null })
    else if (child.level === 'district') setFilters({ districtId: child.id })
    else if (child.level === 'sector') setFilters({ sectorId: child.id, tradeId: null })
    else openTrade({ tradeId: child.id })
  }

  // Breadcrumb: National → State → District → Sector → Trade, following the active filters.
  const path = data?.path
  const crumbs: { label: string; onClick: (() => void) | null }[] = [
    { label: t('common.national'), onClick: session?.stateId ? null : () => setFilters({ stateId: null, districtId: null, sectorId: null, tradeId: null }) },
    ...(path?.stateId ? [{ label: names.state(path.stateId), onClick: session?.districtId ? null : () => setFilters({ districtId: null, sectorId: null, tradeId: null }) }] : []),
    ...(path?.districtId ? [{ label: names.district(path.districtId), onClick: () => setFilters({ sectorId: null, tradeId: null }) }] : []),
    ...(path?.sectorId ? [{ label: names.sector(path.sectorId), onClick: () => setFilters({ tradeId: null }) }] : []),
    ...(path?.tradeId ? [{ label: names.trade(path.tradeId), onClick: null }] : []),
  ]

  return (
    <div className="page">
      <PageHeader title="explorer.title" subtitle="explorer.subtitle" />
      <FilterBar fields={['state', 'district', 'sector', 'trade', 'horizon']} />

      <div className="split explorer-row content-top">
        <SectionCard className="map-card" aria-labelledby="map-title">
          <h2 className="card-title" id="map-title">{t('explorer.map')}</h2>
          {explorer.status === 'error' ? (
            <ErrorState error={explorer.error} onRetry={explorer.retry} />
          ) : !data ? (
            <LoadingState height={500} />
          ) : (
            <div className={cx(explorer.refreshing && 'is-refreshing')}>
              <StateMap
                states={data.states}
                selectedId={filters.stateId ?? session?.stateId ?? null}
                selectable={(meta?.options.states ?? []).map((s) => s.id)}
                onSelect={(stateId) => !session?.stateId && setFilters({ stateId, districtId: null })}
              />
              <div className="map-footer">
                <Legend
                  items={[
                    { label: t('overview.balance.shortage'), color: 'var(--danger)', kind: 'dot' },
                    { label: t('overview.balance.balanced'), color: 'var(--success)', kind: 'dot' },
                    { label: t('overview.balance.oversupply'), color: 'var(--warning)', kind: 'dot' },
                  ]}
                />
                <span className="map-count" aria-live="polite">{t('explorer.map.pairs', { count: data.total.cells })}</span>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard className="rankings-card" aria-labelledby="rankings-title">
          <h2 className="card-title" id="rankings-title">{t('explorer.rankings')}</h2>
          {explorer.status === 'error' ? (
            <ErrorState error={explorer.error} onRetry={explorer.retry} />
          ) : !data ? (
            <LoadingState height={400} />
          ) : data.ranking.length === 0 ? (
            <EmptyState title={t('common.empty')} text={t('common.emptyHint')} action={<Button variant="secondary" size="sm" onClick={() => resetFilters()}>{t('common.resetFilters')}</Button>} />
          ) : (
            <ol className={cx('ranking-list', explorer.refreshing && 'is-refreshing')}>
              {data.ranking.map((row, index) => (
                <li key={row.tradeId}>
                  <button
                    type="button"
                    className="ranking-row"
                    aria-label={`${index + 1}. ${names.trade(row.tradeId)}: ${row.gapPercentage === null ? t('common.insufficient') : signedPct(row.gapPercentage)}. ${t('common.openTrade')}`}
                    onClick={() => openTrade({ tradeId: row.tradeId, sectorId: row.sectorId })}
                  >
                    <span className="ranking-rank">{String(index + 1).padStart(2, '0')}</span>
                    <span>
                      <span className="ranking-name">{names.trade(row.tradeId)}</span>
                      <span className={cx('ranking-gap', `tone-${gapTone(row.status)}`)}>
                        {row.gap === null ? t('common.insufficient') : `${signed(row.gap)} · ${row.gapPercentage === null ? '—' : signedPct(row.gapPercentage)}`}
                      </span>
                    </span>
                    <span className="ranking-score">
                      {t(`status.${row.status}`)}
                      <br />
                      {row.priorityScore === null ? '—' : t('explorer.rankings.score', { score: formatNumber(row.priorityScore, 1) })}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      <SectionCard className="drill-card" aria-labelledby="drill-title">
        <div className="card-header">
          <div>
            <h2 className="card-title" id="drill-title">{t('explorer.drill')}</h2>
            <nav aria-label={t('explorer.drill')}>
              <ol className="breadcrumb">
                {crumbs.map((crumb, index) => (
                  <li key={index}>
                    {index > 0 && <ChevronRight aria-hidden="true" />}
                    {index === crumbs.length - 1 || !crumb.onClick ? (
                      <span aria-current={index === crumbs.length - 1 ? 'true' : undefined}>{crumb.label}</span>
                    ) : (
                      <button type="button" onClick={crumb.onClick}>{crumb.label}</button>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </div>
        {explorer.status === 'error' ? (
          <ErrorState error={explorer.error} onRetry={explorer.retry} />
        ) : !data ? (
          <LoadingState height={220} />
        ) : data.level === 'cell' ? (
          <>
            <p className="drill-note" style={{ paddingTop: 16 }}>{t('explorer.leaf')}</p>
            <div style={{ padding: '14px 24px 4px' }}>
              <Button onClick={() => router.push('/skill-intelligence')}>{t('common.openTrade')}</Button>
            </div>
          </>
        ) : data.children.length === 0 ? (
          <EmptyState title={t('common.empty')} text={t('common.emptyHint')} />
        ) : (
          <>
            <div className={cx('table-scroll', explorer.refreshing && 'is-refreshing')}>
              <table className="data-table drill-table">
                <colgroup>
                  <col style={{ width: '27%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '16%' }} /><col />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">{t(`explorer.level.${data.level}`)}</th>
                    <th scope="col">{t('explorer.col.demand')}</th>
                    <th scope="col">{t('explorer.col.supply')}</th>
                    <th scope="col">{t('explorer.col.gap')}</th>
                    <th scope="col">{t('explorer.col.gapPct')}</th>
                    <th scope="col">{t('explorer.col.status')}</th>
                    <th scope="col">{t('explorer.col.priority')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.children.map((child) => (
                    <tr
                      key={child.id}
                      tabIndex={0}
                      aria-label={`${nameOf(child)}: ${t(`status.${child.status}`)}`}
                      onClick={() => drill(child)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          drill(child)
                        }
                      }}
                    >
                      <td><span className="cell-strong">{nameOf(child)}</span></td>
                      <td className="cell-num">{num(child.demand)}</td>
                      <td className="cell-num">{num(child.supply)}</td>
                      <td className={cx('cell-gap', `tone-${gapTone(child.status)}`)}>{child.gap === null ? '—' : signed(child.gap)}</td>
                      <td className={cx('cell-gap', `tone-${gapTone(child.status)}`)}>{child.gapPercentage === null ? '—' : signedPct(child.gapPercentage)}</td>
                      <td><StatusBadge status={child.status} /></td>
                      <td><PriorityBadge band={child.priorityBand} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="drill-note">{t('explorer.drill.hint')}</p>
          </>
        )}
      </SectionCard>
    </div>
  )
}
