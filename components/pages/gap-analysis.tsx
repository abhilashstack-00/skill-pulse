'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react'
import { exportUrl, getGaps, type GapsData } from '@/lib/client/api'
import { toQuery, useFilters } from '@/lib/filters-context'
import { cx, formatNumber, signed, signedPct } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { gapTone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'
import { PageHeader } from '@/components/layout/page-header'
import { Drawer } from '@/components/ui/drawer'
import { FilterBar } from '@/components/ui/filter-bar'
import { useFigures } from '@/components/ui/intelligence'
import { Button, EmptyState, ErrorState, LoadingState, PriorityBadge, SearchInput, SectionCard, StatusBadge } from '@/components/ui/primitives'

const PAGE_SIZE = 5

type Row = GapsData['rows'][number]
type SortKey = 'trade' | 'location' | 'demand' | 'supply' | 'gap' | 'gapPct' | 'priority'
type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null

const COLUMNS: { key: SortKey | 'status'; label: string; width: string }[] = [
  { key: 'trade', label: 'gap.col.trade', width: '22%' },
  { key: 'location', label: 'gap.col.location', width: '15%' },
  { key: 'demand', label: 'gap.col.demand', width: '10%' },
  { key: 'supply', label: 'gap.col.supply', width: '10%' },
  { key: 'gap', label: 'gap.col.gap', width: '9%' },
  { key: 'gapPct', label: 'gap.col.gapPct', width: '9%' },
  { key: 'status', label: 'gap.col.status', width: '15%' },
  { key: 'priority', label: 'gap.col.priority', width: 'auto' },
]

export function GapAnalysisPage() {
  const router = useRouter()
  const { t } = useI18n()
  const { meta, names } = useMeta()
  const { filters, setFilters, resetFilters } = useFilters()
  const { num, periodText } = useFigures()
  const query = toQuery(filters)
  const matrix = useService(() => getGaps(query), [filters])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>(null)
  const [page, setPage] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const found = (matrix.data?.rows ?? []).filter(
      (r) => !q || [names.trade(r.tradeId), names.district(r.districtId), names.state(r.stateId), names.sector(r.sectorId)].some((text) => text.toLowerCase().includes(q)),
    )
    if (!sort) return found // server order: largest mismatch first
    const value: Record<SortKey, (r: Row) => string | number> = {
      trade: (r) => names.trade(r.tradeId), location: (r) => names.district(r.districtId),
      demand: (r) => r.demand ?? -Infinity, supply: (r) => r.supply ?? -Infinity, gap: (r) => r.gap ?? -Infinity,
      gapPct: (r) => r.gapPercentage ?? -Infinity, priority: (r) => r.priorityScore ?? -Infinity,
    }
    const pick = value[sort.key]
    return [...found].sort((a, b) => {
      const [x, y] = [pick(a), pick(b)]
      const order = typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y)
      return sort.dir === 'asc' ? order : -order
    })
  }, [matrix.data, search, sort, names])

  // Back to the first page whenever what is listed changes.
  const listKey = JSON.stringify([filters, search, sort])
  const [seenKey, setSeenKey] = useState(listKey)
  if (seenKey !== listKey) {
    setSeenKey(listKey)
    setPage(0)
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const visible = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const opened = matrix.data?.rows.find((r) => r.key === openKey) ?? null
  const thresholds = matrix.data?.thresholds

  const toggleSort = (key: SortKey) =>
    setSort((current) => {
      const first = key === 'trade' || key === 'location' ? 'asc' : 'desc'
      if (current?.key !== key) return { key, dir: first }
      return current.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null
    })

  return (
    <div className="page">
      <PageHeader title="gap.title" subtitle="gap.subtitle" />
      <FilterBar fields={['state', 'district', 'sector', 'trade', 'status', 'horizon']} />

      <SectionCard className="matrix-card content-top" aria-labelledby="matrix-title">
        <div className="card-header">
          <div>
            <h2 className="card-title" id="matrix-title">{t('gap.matrix')}</h2>
            <p className="card-subtitle">{t('gap.matrix.subtitle')}</p>
          </div>
          <div className="card-tools">
            <SearchInput value={search} onChange={setSearch} label={t('common.search')} />
            {meta?.session.permissions.export && (
              <a className="btn btn-secondary btn-sm" href={exportUrl('gaps', query)} download>
                <Download aria-hidden="true" /> {t('common.export')}
              </a>
            )}
          </div>
        </div>

        {matrix.status === 'error' ? (
          <ErrorState error={matrix.error} onRetry={matrix.retry} />
        ) : !matrix.data ? (
          <LoadingState height={480} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('gap.empty')}
            text={search ? t('gap.emptySearch', { query: search }) : t('gap.emptyFilters')}
            action={<Button variant="secondary" size="sm" onClick={() => { setSearch(''); resetFilters() }}>{t('common.clearAll')}</Button>}
          />
        ) : (
          <>
            <div className={cx('table-scroll', matrix.refreshing && 'is-refreshing')}>
              <table className="data-table matrix-table">
                <colgroup>{COLUMNS.map((column) => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map((column) => {
                      if (column.key === 'status') return <th key={column.key} scope="col">{t(column.label)}</th>
                      const key = column.key
                      const active = sort?.key === key
                      return (
                        <th key={key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                          <button type="button" className="sort-btn" data-sorted={active} onClick={() => toggleSort(key)}>
                            {t(column.label)}
                            {active ? (sort.dir === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />) : <ArrowUpDown aria-hidden="true" />}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr
                      key={r.key} tabIndex={0}
                      aria-label={`${names.trade(r.tradeId)}, ${names.district(r.districtId)}: ${t(`status.${r.status}`)}. ${t('common.explain')}`}
                      onClick={() => setOpenKey(r.key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setOpenKey(r.key)
                        }
                      }}
                    >
                      <td><span className="cell-strong">{names.trade(r.tradeId)}</span></td>
                      <td>{names.district(r.districtId)}</td>
                      <td className="cell-num">{num(r.demand)}</td>
                      <td className="cell-num">{num(r.supply)}</td>
                      <td className={cx('cell-gap', `tone-${gapTone(r.status)}`)}>{r.gap === null ? '—' : signed(r.gap)}</td>
                      <td className={cx('cell-gap', `tone-${gapTone(r.status)}`)}>{r.gapPercentage === null ? '—' : signedPct(r.gapPercentage)}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td><PriorityBadge band={r.priorityBand} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span aria-live="polite">
                {t('gap.range', { from: page * PAGE_SIZE + 1, to: Math.min(rows.length, (page + 1) * PAGE_SIZE), total: rows.length })} · {periodText(matrix.data.horizon)}
              </span>
              <div className="pagination-controls">
                <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('common.previous')}</Button>
                <Button variant="secondary" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>{t('common.next')}</Button>
              </div>
            </div>
          </>
        )}
      </SectionCard>

      <Drawer
        open={opened !== null}
        onClose={() => setOpenKey(null)}
        eyebrow={opened ? `${names.trade(opened.tradeId)} · ${names.district(opened.districtId)}, ${names.state(opened.stateId)}` : undefined}
        title={t('gap.drawer.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenKey(null)}>{t('common.close')}</Button>
            <Button
              onClick={() => {
                if (!opened) return
                setFilters({ stateId: opened.stateId, districtId: opened.districtId, sectorId: opened.sectorId, tradeId: opened.tradeId, status: null })
                router.push('/skill-intelligence')
              }}
            >
              {t('common.openTrade')}
            </Button>
          </>
        }
      >
        {opened && matrix.data && thresholds && (
          <>
            <p className="calc-note" style={{ marginTop: 0 }}>{t('skill.gap.intro')} {periodText(matrix.data.horizon)}.</p>

            <h3 className="drawer-section-title">{t('gap.drawer.demand')}</h3>
            <dl className="calc-list">
              {opened.explain.demandParts ? (
                <>
                  <div className="kv-row"><dt className="kv-label">{t('skill.forecast.baseline')}</dt><dd className="kv-value">{formatNumber(opened.explain.demandParts.baseline)}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.forecast.trend')}</dt><dd className="kv-value">{signed(opened.explain.demandParts.trend)}</dd></div>
                  <div className="kv-row"><dt className="kv-label">{t('skill.forecast.growth')}</dt><dd className="kv-value">{signed(opened.explain.demandParts.recentGrowth)}</dd></div>
                </>
              ) : (
                <div className="kv-row"><dt className="kv-label">{t('gap.drawer.runRate')}</dt><dd className="kv-value">{opened.explain.monthlyRunRate === null ? t('common.insufficient') : `${formatNumber(opened.explain.monthlyRunRate, 1)} × 12`}</dd></div>
              )}
              <div className="kv-row is-total"><dt className="kv-label">{t('gap.drawer.demand')}</dt><dd className="kv-value">{opened.demand === null ? t('common.insufficient') : formatNumber(opened.demand)}</dd></div>
              <div className="kv-row"><dt className="kv-label">{t('skill.forecast.method')}</dt><dd className="kv-value">{t(`method.short.${opened.method}`)}{opened.confidence ? ` · ${t('skill.forecast.confidence')} ${t(`confidence.${opened.confidence.label}`)}` : ''}</dd></div>
            </dl>

            <h3 className="drawer-section-title">{t('gap.drawer.supply')}</h3>
            <dl className="calc-list">
              <div className="kv-row"><dt className="kv-label">{t('gap.drawer.capacityNow')}</dt><dd className="kv-value">{opened.explain.currentAnnualCapacity === null ? t('common.insufficient') : formatNumber(opened.explain.currentAnnualCapacity)}</dd></div>
              {opened.explain.yearlyChange !== null && <div className="kv-row"><dt className="kv-label">{t('gap.drawer.capacityChange')}</dt><dd className="kv-value">{signed(opened.explain.yearlyChange, 1)}</dd></div>}
              {opened.explain.projectedAnnualCapacity !== null && <div className="kv-row"><dt className="kv-label">{t('gap.drawer.capacityProjected')}</dt><dd className="kv-value">{formatNumber(opened.explain.projectedAnnualCapacity)}</dd></div>}
              <div className="kv-row is-total"><dt className="kv-label">{t('gap.drawer.supply')}</dt><dd className="kv-value">{opened.supply === null ? t('common.insufficient') : formatNumber(opened.supply)}</dd></div>
            </dl>

            <h3 className="drawer-section-title">{t('skill.gap.gap')}</h3>
            <dl className="calc-list">
              <div className="kv-row is-total"><dt className="kv-label">{t('skill.gap.gap')}</dt><dd className="kv-value">{opened.gap === null ? t('common.insufficient') : `${formatNumber(opened.demand as number)} − ${formatNumber(opened.supply as number)} = ${signed(opened.gap)}`}</dd></div>
              <div className="kv-row is-total"><dt className="kv-label">{t('skill.gap.gapPct')}</dt><dd className="kv-value">{opened.gapPercentage === null ? t('common.notAvailable') : `${signed(opened.gap as number)} ÷ ${formatNumber(opened.supply as number)} = ${signedPct(opened.gapPercentage, 2)}`}</dd></div>
              <div className="kv-row"><dt className="kv-label">{t('skill.gap.class')}</dt><dd className="kv-value"><StatusBadge status={opened.status} /></dd></div>
            </dl>
            {opened.note && <p className="calc-note">{t(`note.${opened.note}`)}</p>}

            <h3 className="drawer-section-title">{t('gap.drawer.thresholds')} · {t('common.prototypeThresholds')}</h3>
            <dl className="calc-list">
              <div className="kv-row"><dt className="kv-label">{t('status.severe_shortage')}</dt><dd className="kv-value">{t('gap.threshold.severeShortage', { value: thresholds.severeShortage })}</dd></div>
              <div className="kv-row"><dt className="kv-label">{t('status.shortage')}</dt><dd className="kv-value">{t('gap.threshold.shortage', { from: thresholds.shortage, to: thresholds.severeShortage })}</dd></div>
              <div className="kv-row"><dt className="kv-label">{t('status.balanced')}</dt><dd className="kv-value">{t('gap.threshold.balanced', { value: thresholds.shortage })}</dd></div>
              <div className="kv-row"><dt className="kv-label">{t('status.oversupply')}</dt><dd className="kv-value">{t('gap.threshold.oversupply', { to: Math.abs(thresholds.oversupply), from: Math.abs(thresholds.severeOversupply) })}</dd></div>
              <div className="kv-row"><dt className="kv-label">{t('status.severe_oversupply')}</dt><dd className="kv-value">{t('gap.threshold.severeOversupply', { value: Math.abs(thresholds.severeOversupply) })}</dd></div>
            </dl>
          </>
        )}
      </Drawer>
    </div>
  )
}
