'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { Tone } from '@/lib/types'
import { useFilters } from '@/lib/filters-context'
import { useService } from '@/lib/hooks/use-service'
import { getFilterOptions, getSkillIntelligence, type SkillIntelligenceData } from '@/lib/services/skillpulse'
import { gapTone, priorityLabel, priorityTone, statusLabel, statusTone } from '@/lib/services/derive'
import { cx, formatDate, signed } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { Legend, seriesColor } from '@/components/charts/chart-kit'
import { TrendChart } from '@/components/charts/trend-chart'
import { Drawer } from '@/components/ui/drawer'
import { FilterBar } from '@/components/ui/filter-bar'
import { Button, EmptyState, ErrorState, KpiCard, KpiSkeleton, LoadingState, Pill, SectionCard, Tabs } from '@/components/ui/primitives'

const EVIDENCE_TABS = [
  { value: 'demand', label: 'Demand' },
  { value: 'supply', label: 'Supply' },
  { value: 'gap', label: 'Gap' },
  { value: 'forecast', label: 'Forecast' },
]

function gapNote(data: SkillIntelligenceData): { note: string; tone: Tone } {
  const { status, priority } = data.metrics
  if (status === 'balanced') return { note: 'Balanced', tone: 'success' }
  if (status === 'surplus') return { note: 'Oversupply', tone: statusTone.surplus }
  return { note: priority === 'high' ? 'Critical' : priority === 'medium' ? 'Elevated' : 'Moderate', tone: priority === 'low' ? 'warning' : priorityTone[priority] }
}

export function SkillIntelligencePage() {
  const router = useRouter()
  const { filters, resetFilters } = useFilters()
  const options = useService(getFilterOptions, [])
  const skill = useService(() => getSkillIntelligence(filters), [filters])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState('demand')
  const data = skill.data
  const m = data?.metrics

  return (
    <div className="page">
      <PageHeader title="Skill Intelligence" subtitle="Trace one skill from market signal to explainable decision." />
      <FilterBar fields={['state', 'district', 'sector', 'skill']} options={options.data} focus={m ?? null} />

      {skill.status === 'error' ? (
        <SectionCard className="content-top">
          <ErrorState text={skill.error.message} onRetry={skill.retry} />
        </SectionCard>
      ) : skill.status === 'loading' ? (
        <>
          <div className="skill-heading">
            <div className="skeleton" style={{ width: 180, height: 29 }} />
            <div className="skeleton" style={{ width: 150, height: 12, marginTop: 8 }} />
          </div>
          <div className="kpi-grid skill-kpis"><KpiSkeleton /></div>
          <div className="split skill-row">
            <SectionCard className="trend-card"><LoadingState height={400} /></SectionCard>
            <SectionCard className="why-card"><LoadingState height={400} /></SectionCard>
          </div>
        </>
      ) : !data || !m ? (
        <SectionCard className="content-top">
          <EmptyState
            title="No skill matches this selection"
            text="No monitored skill exists for this combination of state, district and sector."
            action={<Button variant="secondary" size="sm" onClick={() => resetFilters()}>Reset filters</Button>}
          />
        </SectionCard>
      ) : (
        <div className={cx(skill.refreshing && 'is-refreshing')}>
          <div className="skill-heading">
            <h2 className="skill-name">{m.skill.name}</h2>
            <p className="skill-meta">{m.skill.sector} · NSQF Level {m.skill.nsqfLevel}</p>
          </div>

          <div className="kpi-grid skill-kpis">
            <KpiCard value={String(m.demandIndex)} label="Demand Index" note={`${Math.abs(m.demandGrowth)}%`} trend={m.demandGrowth >= 0 ? 'up' : 'down'} tone={m.demandGrowth >= 0 ? 'success' : 'warning'} />
            <KpiCard value={String(m.supplyIndex)} label="Supply Index" note={`${Math.abs(m.supplyGrowth)}%`} trend={m.supplyGrowth >= 0 ? 'up' : 'down'} tone={m.supplyGrowth >= m.demandGrowth ? 'success' : 'warning'} />
            <KpiCard value={signed(m.gapIndex)} label="Gap Index" {...gapNote(data)} />
            <KpiCard value={priorityLabel[m.priority].toUpperCase()} label="Priority" note="Decision signal" tone={priorityTone[m.priority]} />
          </div>

          <div className="split skill-row">
            <SectionCard className="trend-card" aria-labelledby="trend-title">
              <div className="card-header">
                <h2 className="card-title" id="trend-title">Demand vs Supply Trend</h2>
                <Legend items={[{ label: 'Demand', color: seriesColor.demand }, { label: 'Supply', color: seriesColor.supply }]} />
              </div>
              <div className="trend-plot plot-surface">
                <TrendChart data={data.trend} />
              </div>
              <p className="trend-note">Index 0–100 · {m.district.name}, {m.state.name} · last 12 months</p>
            </SectionCard>

            <SectionCard className="why-card" aria-labelledby="why-title">
              <h2 className="card-title" id="why-title">Why is this {priorityLabel[m.priority].toUpperCase()} priority?</h2>
              <div className="why-rows">
                <div className="kv-row why-row"><span className="kv-label">Demand growth</span><span className="kv-value tone-primary">{signed(m.demandGrowth, '%')}</span></div>
                <div className="kv-row why-row"><span className="kv-label">Training growth</span><span className="kv-value tone-success">{signed(m.supplyGrowth, '%')}</span></div>
                <div className="kv-row why-row"><span className="kv-label">Current gap</span><span className={cx('kv-value', `tone-${gapTone(m.gapIndex)}`)}>{signed(m.gapIndex)}</span></div>
                <div className="kv-row why-row"><span className="kv-label">6M forecast</span><span className={cx('kv-value', `tone-${gapTone(data.forecast6M.gap)}`)}>{signed(data.forecast6M.gap)}</span></div>
              </div>
              <p className="why-driver">Primary driver · {m.primaryDriver}</p>
              <div className="why-footer">
                <Pill tone="success" compact>{m.coverage}% coverage</Pill>
                <Button onClick={() => setDrawerOpen(true)}>View Evidence</Button>
              </div>
            </SectionCard>
          </div>

          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            eyebrow={`${m.skill.name} · ${m.district.name}, ${m.state.name}`}
            title={`Why is this ${priorityLabel[m.priority].toUpperCase()} priority?`}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDrawerOpen(false)}>Close</Button>
                <Button onClick={() => router.push('/forecasts')}>View forecast <ArrowRight aria-hidden="true" /></Button>
              </>
            }
          >
            <div className="evidence-panel">
              <div className="kv-row evidence-row"><span className="kv-label">Demand</span><span className="kv-value">{signed(m.demandGrowth, '%')}</span></div>
              <div className="kv-row evidence-row"><span className="kv-label">Training</span><span className="kv-value">{signed(m.supplyGrowth, '%')}</span></div>
              <div className="kv-row evidence-row"><span className="kv-label">Current gap</span><span className="kv-value">{signed(m.gapIndex)}</span></div>
              <div className="kv-row evidence-row"><span className="kv-label">6M forecast</span><span className="kv-value">{signed(data.forecast6M.gap)}</span></div>
              <p className="evidence-note">Coverage {data.evidence.coverage}% · {data.evidence.demandSources.length} demand sources</p>
            </div>

            <h3 className="drawer-section-title">Evidence</h3>
            <Tabs label="Evidence view" value={tab} options={EVIDENCE_TABS} onChange={setTab} />
            <div role="tabpanel" aria-label={EVIDENCE_TABS.find((t) => t.value === tab)?.label}>
              {tab === 'demand' && (
                <>
                  <p className="evidence-note">Demand Index {m.demandIndex}, {signed(m.demandGrowth, '%')} over 6 months. Primary driver: {m.primaryDriver.toLowerCase()}.</p>
                  <SourceList sources={data.evidence.demandSources} />
                </>
              )}
              {tab === 'supply' && (
                <>
                  <p className="evidence-note">Supply Index {m.supplyIndex}, {signed(m.supplyGrowth, '%')} over 6 months, from training and workforce records.</p>
                  <SourceList sources={data.evidence.supplySources} />
                </>
              )}
              {tab === 'gap' && (
                <div className="evidence-list">
                  <div className="kv-row evidence-row"><span className="kv-label">Demand Index</span><span className="kv-value">{m.demandIndex}</span></div>
                  <div className="kv-row evidence-row"><span className="kv-label">Supply Index</span><span className="kv-value">− {m.supplyIndex}</span></div>
                  <div className="kv-row evidence-row"><span className="kv-label">Gap Index</span><span className="kv-value">= {signed(m.gapIndex)}</span></div>
                  <div className="kv-row evidence-row"><span className="kv-label">Status</span><span className="kv-value">{statusLabel[m.status]}</span></div>
                  <div className="kv-row evidence-row"><span className="kv-label">Method</span><span className="kv-value">{data.evidence.method}</span></div>
                </div>
              )}
              {tab === 'forecast' && (
                <div className="evidence-list">
                  <div className="kv-row evidence-row"><span className="kv-label">6M forecast gap</span><span className="kv-value">{signed(data.forecast6M.gap)}</span></div>
                  <div className="kv-row evidence-row"><span className="kv-label">Change from today</span><span className="kv-value">{signed(data.forecast6M.gap - m.gapIndex)} pts</span></div>
                  <div className="kv-row evidence-row"><span className="kv-label">Confidence</span><span className="kv-value">{data.forecast6M.confidence}</span></div>
                  <div className="kv-row evidence-row"><span className="kv-label">Freshness</span><span className="kv-value">{formatDate(data.evidence.freshness)}</span></div>
                </div>
              )}
            </div>
          </Drawer>
        </div>
      )}
    </div>
  )
}

function SourceList({ sources }: { sources: SkillIntelligenceData['evidence']['demandSources'] }) {
  return (
    <ul className="evidence-sources">
      {sources.map((source) => (
        <li className="evidence-source" key={source.id}>
          <span>
            <strong>{source.name}</strong>
            <span>{source.fieldsUsed.join(' · ')}</span>
          </span>
          <span>{formatDate(source.lastUpdated)}</span>
        </li>
      ))}
    </ul>
  )
}
