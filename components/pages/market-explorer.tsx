'use client'

import { useRouter } from 'next/navigation'
import { useFilters } from '@/lib/filters-context'
import { useService } from '@/lib/hooks/use-service'
import { getFilterOptions, getMarketExplorer } from '@/lib/services/skillpulse'
import { gapTone } from '@/lib/services/derive'
import { cx, signed } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { Legend } from '@/components/charts/chart-kit'
import { StateMap } from '@/components/charts/state-map'
import { FilterBar } from '@/components/ui/filter-bar'
import { Button, EmptyState, ErrorState, LoadingState, SectionCard } from '@/components/ui/primitives'

const PRESSURE_LEGEND = [
  { label: 'High shortage pressure', color: 'var(--danger)', kind: 'dot' as const },
  { label: 'Moderate', color: 'var(--warning)', kind: 'dot' as const },
  { label: 'Low or surplus', color: 'var(--primary)', kind: 'dot' as const },
]

export function MarketExplorerPage() {
  const router = useRouter()
  const { filters, setFilters, resetFilters } = useFilters()
  const options = useService(getFilterOptions, [])
  const explorer = useService(() => getMarketExplorer(filters), [filters])
  const data = explorer.data
  const periodLabel = options.data?.periods.find((p) => p.value === filters.period)?.label.toLowerCase() ?? ''

  return (
    <div className="page">
      <PageHeader title="Market Explorer" subtitle="Explore demand, supply and skill gaps across locations." />
      <FilterBar fields={['state', 'district', 'sector', 'skill', 'period']} options={options.data} />

      <div className="split explorer-row content-top">
        <SectionCard className="map-card" aria-labelledby="map-title">
          <h2 className="card-title" id="map-title">Geographic Demand &amp; Supply</h2>
          {explorer.status === 'error' ? (
            <ErrorState text={explorer.error.message} onRetry={explorer.retry} />
          ) : !data ? (
            <LoadingState height={500} />
          ) : (
            <div className={cx(explorer.refreshing && 'is-refreshing')}>
              <StateMap
                states={data.states}
                selectedId={filters.stateId}
                onSelect={(stateId) => setFilters({ stateId, districtId: null, skillId: null })}
              />
              <div className="map-footer">
                <Legend items={PRESSURE_LEGEND} />
                <span className="map-count" aria-live="polite">
                  {data.matchCount} {data.matchCount === 1 ? 'skill' : 'skills'} in view
                </span>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard className="rankings-card" aria-labelledby="rankings-title">
          <h2 className="card-title" id="rankings-title">Skill Rankings</h2>
          {explorer.status === 'error' ? (
            <ErrorState text={explorer.error.message} onRetry={explorer.retry} />
          ) : !data ? (
            <LoadingState height={400} />
          ) : data.rankings.length === 0 ? (
            <EmptyState
              title="No skills match these filters"
              text="Try a different state, sector or skill."
              action={<Button variant="secondary" size="sm" onClick={() => resetFilters({ period: filters.period })}>Reset filters</Button>}
            />
          ) : (
            <ol className={cx('ranking-list', explorer.refreshing && 'is-refreshing')}>
              {data.rankings.map(({ metrics: m, gapChange }, index) => (
                <li key={m.skill.id}>
                  <button
                    type="button"
                    className="ranking-row"
                    aria-label={`Rank ${index + 1}: ${m.skill.name}, ${m.district.name}, gap ${signed(m.gapIndex)}. Open skill intelligence.`}
                    onClick={() => {
                      setFilters({ skillId: m.skill.id, stateId: m.state.id, sector: m.skill.sector, districtId: null })
                      router.push('/skill-intelligence')
                    }}
                  >
                    <span className="ranking-rank">{String(index + 1).padStart(2, '0')}</span>
                    <span>
                      <span className="ranking-name">{m.skill.name}</span>
                      <span className={cx('ranking-gap', `tone-${gapTone(m.gapIndex)}`)}>{signed(m.gapIndex)}</span>
                    </span>
                    <span className="ranking-change">
                      {m.district.name}
                      <br />
                      {signed(gapChange)} pts in {periodLabel}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
