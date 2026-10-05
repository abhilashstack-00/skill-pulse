'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { GapStatus } from '@/lib/types'
import { useFilters } from '@/lib/filters-context'
import { useService } from '@/lib/hooks/use-service'
import { getOverview } from '@/lib/services/skillpulse'
import { gapTone, statusLabel, statusTone } from '@/lib/services/derive'
import { cx, signed } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { BubbleRadar } from '@/components/charts/bubble-radar'
import { EmptyState, ErrorState, KpiCard, KpiSkeleton, LoadingState, PriorityBadge, SectionCard } from '@/components/ui/primitives'

const BALANCE_ORDER: GapStatus[] = ['shortage', 'balanced', 'surplus']

export function OverviewPage() {
  const router = useRouter()
  const { resetFilters } = useFilters()
  const overview = useService(getOverview, [])
  const data = overview.data

  const go = (href: string, patch: Parameters<typeof resetFilters>[0]) => {
    resetFilters(patch)
    router.push(href)
  }

  return (
    <div className="page">
      <PageHeader title="Labour Market Pulse" subtitle="Understand where labour demand is moving and where training supply is falling behind." />

      {overview.status === 'error' ? (
        <SectionCard className="overview-kpis">
          <ErrorState text={overview.error.message} onRetry={overview.retry} />
        </SectionCard>
      ) : (
        <>
          <div className="kpi-grid overview-kpis">
            {data ? data.kpis.map((kpi) => <KpiCard key={kpi.id} value={kpi.value} label={kpi.label} note={kpi.note} tone={kpi.tone} />) : <KpiSkeleton />}
          </div>

          <div className="split overview-row">
            <SectionCard className="balance-card" aria-labelledby="balance-title">
              <h2 className="card-title" id="balance-title">Market Balance</h2>
              {data ? (
                <div className="balance-tiles">
                  {BALANCE_ORDER.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={cx('balance-tile', `tone-${statusTone[status]}`)}
                      aria-label={`${data.balance[status]} skills in ${statusLabel[status].toLowerCase()}. Explore in Gap Analysis.`}
                      onClick={() => go('/gap-analysis', { gapType: status })}
                    >
                      <span className="balance-tile-label">{statusLabel[status]}</span>
                      <span className="balance-tile-value">{data.balance[status]}</span>
                      <span className="balance-tile-link">Explore <ArrowRight aria-hidden="true" /></span>
                    </button>
                  ))}
                </div>
              ) : (
                <LoadingState height={200} />
              )}
            </SectionCard>

            <SectionCard className="signals-card" aria-labelledby="signals-title">
              <h2 className="card-title" id="signals-title">Priority Signals</h2>
              {!data ? (
                <LoadingState height={200} />
              ) : data.signals.length === 0 ? (
                <EmptyState title="No priority signals" text="No skill is currently in shortage in the pilot regions." />
              ) : (
                <div className="signal-list">
                  {data.signals.map((m) => (
                    <button
                      key={m.skill.id}
                      type="button"
                      className="signal-row"
                      aria-label={`${m.skill.name}, ${m.state.name}, gap ${signed(m.gapIndex)}, ${m.priority} priority. Open in Market Explorer.`}
                      onClick={() => go('/market-explorer', { stateId: m.state.id })}
                    >
                      <span>
                        <span className="signal-name">{m.skill.name}</span>
                        <span className="signal-place">{m.state.name}</span>
                      </span>
                      <span className={cx('signal-gap', `tone-${gapTone(m.gapIndex)}`)}>{signed(m.gapIndex)}</span>
                      <PriorityBadge priority={m.priority} />
                    </button>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard className="radar-card" aria-labelledby="radar-title">
            <h2 className="card-title" id="radar-title">Skill Gap Radar</h2>
            <p className="card-subtitle">Bubble size = workforce gap · x = demand growth · y = supply growth</p>
            {data ? (
              <BubbleRadar data={data.radar} onSelect={(m) => go('/skill-intelligence', { skillId: m.skill.id, stateId: m.state.id, sector: m.skill.sector })} />
            ) : (
              <LoadingState height={245} />
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}
