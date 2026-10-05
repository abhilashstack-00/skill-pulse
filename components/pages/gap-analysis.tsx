'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SkillMetrics } from '@/lib/types'
import { useFilters } from '@/lib/filters-context'
import { useService } from '@/lib/hooks/use-service'
import { getFilterOptions, getGapMatrix } from '@/lib/services/skillpulse'
import { gapTone } from '@/lib/services/derive'
import { cx, signed } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { FilterBar } from '@/components/ui/filter-bar'
import { Button, EmptyState, ErrorState, LoadingState, SearchInput, SectionCard, StatusBadge } from '@/components/ui/primitives'

const PAGE_SIZE = 5

type SortKey = 'skill' | 'location' | 'demand' | 'supply' | 'gap'
type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null

const COLUMNS: { key: SortKey | 'status'; label: string; width: string }[] = [
  { key: 'skill', label: 'Skill', width: '26.25%' },
  { key: 'location', label: 'Location', width: '20.33%' },
  { key: 'demand', label: 'Demand', width: '10.17%' },
  { key: 'supply', label: 'Supply', width: '10.17%' },
  { key: 'gap', label: 'Gap', width: '11.09%' },
  { key: 'status', label: 'Status', width: 'auto' },
]

const sortValue: Record<SortKey, (m: SkillMetrics) => string | number> = {
  skill: (m) => m.skill.name,
  location: (m) => m.district.name,
  demand: (m) => m.demandIndex,
  supply: (m) => m.supplyIndex,
  gap: (m) => m.gapIndex,
}

export function GapAnalysisPage() {
  const router = useRouter()
  const { filters, setFilters, resetFilters } = useFilters()
  const options = useService(getFilterOptions, [])
  const matrix = useService(() => getGapMatrix(filters), [filters])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>(null)
  const [page, setPage] = useState(0)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const found = (matrix.data ?? []).filter(
      (m) => !q || [m.skill.name, m.district.name, m.state.name, m.skill.sector].some((text) => text.toLowerCase().includes(q)),
    )
    if (!sort) return found // service order: largest mismatch first
    const value = sortValue[sort.key]
    return [...found].sort((a, b) => {
      const [x, y] = [value(a), value(b)]
      const order = typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y)
      return sort.dir === 'asc' ? order : -order
    })
  }, [matrix.data, query, sort])

  useEffect(() => setPage(0), [filters, query, sort])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const visible = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  const toggleSort = (key: SortKey) =>
    setSort((current) => {
      if (current?.key !== key) return { key, dir: key === 'skill' || key === 'location' ? 'asc' : 'desc' }
      const first = key === 'skill' || key === 'location' ? 'asc' : 'desc'
      return current.dir === first ? { key, dir: first === 'asc' ? 'desc' : 'asc' } : null
    })

  const open = (m: SkillMetrics) => {
    setFilters({ skillId: m.skill.id, stateId: m.state.id, sector: m.skill.sector, districtId: null, gapType: null })
    router.push('/skill-intelligence')
  }

  return (
    <div className="page">
      <PageHeader title="Gap Analysis" subtitle="Identify where training supply is diverging from labour demand." />
      <FilterBar fields={['state', 'district', 'sector', 'skill', 'gapType']} options={options.data} />

      <SectionCard className="matrix-card content-top" aria-labelledby="matrix-title">
        <div className="card-header">
          <div>
            <h2 className="card-title" id="matrix-title">Priority mismatch matrix</h2>
            <p className="card-subtitle">Gap = Demand − Supply · positive is a shortage, negative is a surplus</p>
          </div>
          <SearchInput value={query} onChange={setQuery} label="Search the mismatch matrix" />
        </div>

        {matrix.status === 'error' ? (
          <ErrorState text={matrix.error.message} onRetry={matrix.retry} />
        ) : !matrix.data ? (
          <LoadingState height={480} label="Loading mismatch matrix" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No mismatches match this view"
            text={query ? `Nothing matches “${query}” with the current filters.` : 'Try widening the filters.'}
            action={
              <Button variant="secondary" size="sm" onClick={() => { setQuery(''); resetFilters({ period: filters.period }) }}>
                Clear search and filters
              </Button>
            }
          />
        ) : (
          <>
            <div className={cx('table-scroll', matrix.refreshing && 'is-refreshing')}>
              <table className="data-table matrix-table">
                <colgroup>
                  {COLUMNS.map((column) => <col key={column.key} style={{ width: column.width }} />)}
                </colgroup>
                <thead>
                  <tr>
                    {COLUMNS.map((column) => {
                      if (column.key === 'status') return <th key={column.key} scope="col">{column.label}</th>
                      const key = column.key
                      const active = sort?.key === key
                      return (
                        <th key={key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                          <button type="button" className="sort-btn" data-sorted={active} onClick={() => toggleSort(key)}>
                            {column.label}
                            {active ? (sort.dir === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />) : <ArrowUpDown aria-hidden="true" />}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => (
                    <tr
                      key={m.skill.id}
                      tabIndex={0}
                      aria-label={`${m.skill.name}, ${m.district.name}: demand ${m.demandIndex}, supply ${m.supplyIndex}, gap ${signed(m.gapIndex)}. Open skill intelligence.`}
                      onClick={() => open(m)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          open(m)
                        }
                      }}
                    >
                      <td><span className="cell-strong">{m.skill.name}</span></td>
                      <td>{m.district.name}</td>
                      <td className="cell-num">{m.demandIndex}</td>
                      <td className="cell-num">{m.supplyIndex}</td>
                      <td className={cx('cell-gap', `tone-${gapTone(m.gapIndex)}`)}>{signed(m.gapIndex)}</td>
                      <td><StatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span aria-live="polite">
                {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length} skills
              </span>
              <div className="pagination-controls">
                <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  )
}
