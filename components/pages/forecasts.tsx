'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import type { ForecastHorizon, Tone } from '@/lib/types'
import { useFilters } from '@/lib/filters-context'
import { useService } from '@/lib/hooks/use-service'
import { getEarlyWarnings, getFilterOptions, getForecast, type WarningKind } from '@/lib/services/skillpulse'
import { cx, formatDate, signed } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { Legend, seriesColor } from '@/components/charts/chart-kit'
import { ForecastChart } from '@/components/charts/forecast-chart'
import { Select } from '@/components/ui/select'
import { Button, EmptyState, ErrorState, LoadingState, SectionCard } from '@/components/ui/primitives'

const HORIZONS: { value: ForecastHorizon; label: string; short: string }[] = [
  { value: 'current', label: 'Current', short: 'Current' },
  { value: '3M', label: '3 Months', short: '3M' },
  { value: '6M', label: '6 Months', short: '6M' },
  { value: '12M', label: '12 Months', short: '12M' },
]

const WARNING_STYLE: Record<WarningKind, { label: string; tone: Tone }> = {
  critical: { label: 'Critical', tone: 'danger' },
  emerging: { label: 'Emerging', tone: 'warning' },
  saturation: { label: 'Saturation', tone: 'primary' },
}

export function ForecastsPage() {
  const router = useRouter()
  const { filters, setFilters } = useFilters()
  const [horizon, setHorizon] = useState<ForecastHorizon>('6M')
  const options = useService(getFilterOptions, [])
  const forecast = useService(() => getForecast(filters.skillId, horizon), [filters.skillId, horizon])
  const warnings = useService(getEarlyWarnings, [])
  const data = forecast.data
  const short = HORIZONS.find((h) => h.value === horizon)?.short ?? ''

  const pickSkill = (skillId: string | null) => {
    const skill = options.data?.skills.find((s) => s.value === skillId)
    if (skill) setFilters({ skillId: skill.value, stateId: skill.stateId, sector: skill.sector, districtId: null })
  }

  return (
    <div className="page">
      <PageHeader title="Labour Demand Forecasts" subtitle="See where current mismatches are likely to move next." />

      <div className="filter-bar">
        <div role="group" aria-label="Forecast horizon" style={{ display: 'contents' }}>
          {HORIZONS.map((h) => (
            <button key={h.value} type="button" className="toggle" aria-pressed={horizon === h.value} onClick={() => setHorizon(h.value)}>
              {h.label}
            </button>
          ))}
        </div>
        <Select label="Skill" value={data?.metrics.skill.id ?? null} options={options.data?.skills ?? []} disabled={!options.data} onChange={pickSkill} />
      </div>

      <div className="split forecast-row content-top">
        <SectionCard className="forecast-card" aria-labelledby="forecast-title">
          <div className="card-header">
            <h2 className="card-title" id="forecast-title">Projected Skill Gap</h2>
            <Legend
              items={[
                { label: 'Actual', color: seriesColor.gap },
                { label: 'Forecast', color: seriesColor.gap, kind: 'dashed' },
                { label: 'Confidence band', color: seriesColor.gap, kind: 'band' },
              ]}
            />
          </div>
          {forecast.status === 'error' ? (
            <ErrorState text={forecast.error.message} onRetry={forecast.retry} />
          ) : !data ? (
            <LoadingState height={390} label="Loading forecast" />
          ) : (
            <div className={cx('forecast-plot plot-surface', forecast.refreshing && 'is-refreshing')}>
              <ForecastChart data={data.series} skillName={data.metrics.skill.name} />
            </div>
          )}
        </SectionCard>

        <SectionCard className="warnings-card" aria-labelledby="warnings-title">
          <h2 className="card-title" id="warnings-title">Early Warnings</h2>
          {warnings.status === 'error' ? (
            <ErrorState text={warnings.error.message} onRetry={warnings.retry} />
          ) : !warnings.data ? (
            <LoadingState height={380} label="Loading early warnings" />
          ) : warnings.data.length === 0 ? (
            <EmptyState title="No early warnings" text="No skill is forecast to move out of balance." />
          ) : (
            <div className="warning-list">
              {warnings.data.map(({ kind, metrics: m, gapChange6M }) => (
                <button
                  key={kind}
                  type="button"
                  className={cx('warning-tile', `tone-${WARNING_STYLE[kind].tone}`)}
                  aria-pressed={data?.metrics.skill.id === m.skill.id}
                  aria-label={`${WARNING_STYLE[kind].label}: ${m.skill.name}, ${m.state.name}. Gap forecast to change ${signed(gapChange6M)} points in 6 months. Show forecast.`}
                  onClick={() => pickSkill(m.skill.id)}
                >
                  <span className="warning-kind">{WARNING_STYLE[kind].label}</span>
                  <span className="warning-name">{m.skill.name}</span>
                  <span className="warning-place">{m.state.name}</span>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard className="summary-card" aria-label="Forecast summary">
        {forecast.status === 'error' ? null : !data ? (
          <div className="skeleton" style={{ height: 60 }} role="status" aria-label="Loading forecast summary" />
        ) : (
          <>
            <dl className={cx('summary-grid', forecast.refreshing && 'is-refreshing')} style={{ margin: 0 }}>
              <div>
                <dt className="summary-label">{horizon === 'current' ? 'Current gap' : `${short} forecast`}</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>{signed(data.forecast.gap)}</dd>
              </div>
              <div>
                <dt className="summary-label">Confidence</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>{horizon === 'current' ? 'Observed' : data.forecast.confidence}</dd>
              </div>
              <div>
                <dt className="summary-label">Data coverage</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>{data.coverage}%</dd>
              </div>
              <div>
                <dt className="summary-label">Freshness</dt>
                <dd className="summary-value" style={{ marginLeft: 0 }}>{formatDate(data.freshness)}</dd>
              </div>
            </dl>
            <div className="action-footer" style={{ marginTop: 24 }}>
              <p className="summary-note" style={{ marginTop: 0 }}>
                {data.metrics.skill.name} · {data.metrics.district.name}, {data.metrics.state.name} · demand {data.forecast.demand}, supply {data.forecast.supply}. Illustrative pilot values, not model output.
              </p>
              <Button variant="secondary" onClick={() => router.push('/action-center')}>
                Open in Action Center <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  )
}
