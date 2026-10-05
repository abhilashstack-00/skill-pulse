import type {
  ActionItem, DataSource, Evidence, FilterOptions, Filters, Forecast, ForecastHorizon, ForecastPoint,
  GapStatus, IndexWeight, KpiStat, MethodologyStep, SkillMetrics, State, TrendPeriod, TrendPoint,
} from '@/lib/types'
import {
  dataSources, dataset, demandWeights, districts, gapFormula, marketRecords, pipelineSteps,
  recommendations, skills, states, supplyWeights, thresholds,
} from '@/lib/data'
import { formatMonth, formatNumber } from '@/lib/format'
import { request } from './client'
import { gapPriority, gapStatus, pressureLevel, statusLabel, type PressureLevel } from './derive'

/* -------------------------------------------------------------------------- */
/* Joins and derived fields                                                    */
/* -------------------------------------------------------------------------- */

function toMetrics(): SkillMetrics[] {
  return marketRecords.map((record) => {
    const skill = skills.find((s) => s.id === record.skillId)
    const district = districts.find((d) => d.id === record.districtId)
    const state = states.find((s) => s.id === district?.stateId)
    if (!skill || !district || !state) throw new Error(`Incomplete record for ${record.skillId}`)
    const gapIndex = record.demandIndex - record.supplyIndex
    const status = gapStatus(gapIndex)
    const gap6M = record.forecast['6M'].demand - record.forecast['6M'].supply
    return {
      ...record, skill, district, state, gapIndex, status,
      priority: gapPriority(gapIndex),
      emerging: status === 'balanced' && gapStatus(gap6M) !== 'balanced',
    }
  })
}

const allMetrics = toMetrics()

function applyFilters(rows: SkillMetrics[], filters: Partial<Filters>): SkillMetrics[] {
  return rows.filter(
    (row) =>
      (!filters.stateId || row.state.id === filters.stateId) &&
      (!filters.districtId || row.district.id === filters.districtId) &&
      (!filters.sector || row.skill.sector === filters.sector) &&
      (!filters.skillId || row.skill.id === filters.skillId) &&
      (!filters.gapType || row.status === filters.gapType),
  )
}

const byWorkforceGap = (a: SkillMetrics, b: SkillMetrics) => b.workforceGap - a.workforceGap
const byGapSize = (a: SkillMetrics, b: SkillMetrics) =>
  Math.abs(b.gapIndex) - Math.abs(a.gapIndex) || b.workforceGap - a.workforceGap

function forecastFor(row: SkillMetrics, horizon: ForecastHorizon): Forecast {
  const pair = horizon === 'current' ? { demand: row.demandIndex, supply: row.supplyIndex } : row.forecast[horizon]
  return { horizon, demand: pair.demand, supply: pair.supply, gap: pair.demand - pair.supply, confidence: row.confidence }
}

function evidenceFor(row: SkillMetrics): Evidence {
  return {
    demandSources: dataSources.filter((s) => s.role === 'demand'),
    supplySources: dataSources.filter((s) => s.role === 'supply'),
    coverage: row.coverage,
    freshness: dataset.updatedAt,
    method: gapFormula.method,
  }
}

/* -------------------------------------------------------------------------- */
/* Mock time series                                                            */
/* Month-by-month values are interpolated from the mock anchors in market.ts   */
/* (current index, 6-month growth, and the 3/6/12M forecast values). This is   */
/* presentation scaffolding for charts, not a forecasting model.               */
/* -------------------------------------------------------------------------- */

const HORIZON_MONTHS: Record<ForecastHorizon, number> = { current: 0, '3M': 3, '6M': 6, '12M': 12 }
const PERIOD_MONTHS: Record<TrendPeriod, number> = { '3M': 3, '6M': 6, '12M': 12 }
const BAND_BASE = { High: 2, Medium: 3.5, Low: 5 } as const

function monthAt(offset: number): string {
  const [y, m] = dataset.updatedAt.split('-').map(Number)
  const index = y * 12 + (m - 1) + offset
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

const round1 = (n: number) => Math.round(n * 10) / 10

function pastValue(current: number, growthPct: number, offset: number, seed: number): number {
  const trend = current * Math.pow(1 + growthPct / 100, offset / 6)
  const wobble = offset === 0 ? 0 : 0.35 * Math.sin(seed + offset * 1.7)
  return round1(trend + wobble)
}

function futureValue(current: number, a3: number, a6: number, a12: number, month: number): number {
  const anchors: [number, number][] = [[0, current], [3, a3], [6, a6], [12, a12]]
  for (let i = 1; i < anchors.length; i++) {
    const [m0, v0] = anchors[i - 1]
    const [m1, v1] = anchors[i]
    if (month <= m1) return round1(v0 + ((v1 - v0) * (month - m0)) / (m1 - m0))
  }
  return a12
}

function history(row: SkillMetrics, months: number): TrendPoint[] {
  const seed = row.skill.id.length
  const points: TrendPoint[] = []
  for (let offset = -months; offset <= 0; offset++) {
    const demand = pastValue(row.demandIndex, row.demandGrowth, offset, seed)
    const supply = pastValue(row.supplyIndex, row.supplyGrowth, offset, seed + 2)
    const month = monthAt(offset)
    points.push({ month, label: formatMonth(month), demand, supply, gap: round1(demand - supply) })
  }
  return points
}

function forecastSeries(row: SkillMetrics, horizon: ForecastHorizon): ForecastPoint[] {
  const past: ForecastPoint[] = history(row, 6).map((p) => ({ month: p.month, label: p.label, actual: p.gap, forecast: null, band: null }))
  const last = past[past.length - 1]
  const months = HORIZON_MONTHS[horizon]
  if (months === 0) return past
  last.forecast = last.actual
  last.band = [last.actual as number, last.actual as number]
  const f = row.forecast
  const future: ForecastPoint[] = []
  for (let m = 1; m <= months; m++) {
    const demand = futureValue(row.demandIndex, f['3M'].demand, f['6M'].demand, f['12M'].demand, m)
    const supply = futureValue(row.supplyIndex, f['3M'].supply, f['6M'].supply, f['12M'].supply, m)
    const gap = round1(demand - supply)
    const half = round1(BAND_BASE[row.confidence] * Math.sqrt(m / 6))
    const month = monthAt(m)
    future.push({ month, label: formatMonth(month), actual: null, forecast: gap, band: [round1(gap - half), round1(gap + half)] })
  }
  return [...past, ...future]
}

/* -------------------------------------------------------------------------- */
/* Service functions (the only API the UI calls)                               */
/* -------------------------------------------------------------------------- */

export function getDatasetInfo() {
  return request(() => ({ ...dataset }))
}

export function getFilterOptions(): Promise<FilterOptions> {
  return request(() => ({
    states: states.map((s) => ({ value: s.id, label: s.name })),
    districts: districts.map((d) => ({ value: d.id, label: d.name, stateId: d.stateId })),
    sectors: [...new Set(skills.map((s) => s.sector))].sort().map((s) => ({ value: s, label: s })),
    skills: allMetrics.map((m) => ({ value: m.skill.id, label: m.skill.name, sector: m.skill.sector, stateId: m.state.id, districtId: m.district.id })),
    gapTypes: (Object.keys(statusLabel) as GapStatus[]).map((s) => ({ value: s, label: statusLabel[s] })),
    periods: [
      { value: '3M', label: '3 Months' },
      { value: '6M', label: '6 Months' },
      { value: '12M', label: '12 Months' },
    ],
  }))
}

export interface OverviewData {
  kpis: KpiStat[]
  balance: Record<GapStatus, number>
  signals: SkillMetrics[]
  radar: SkillMetrics[]
}

function alertCount(): number {
  return allMetrics.filter((m) => m.status !== 'balanced' || m.emerging).length
}

export function getOverview(): Promise<OverviewData> {
  return request(() => {
    const count = (status: GapStatus) => allMetrics.filter((m) => m.status === status).length
    const signals = allMetrics.reduce((sum, m) => sum + m.demandSignals, 0)
    return {
      kpis: [
        { id: 'states', value: String(states.length), label: 'States monitored', note: 'Pilot regions', tone: 'success' },
        { id: 'skills', value: String(skills.length), label: 'Skills monitored', note: 'Priority occupations', tone: 'success' },
        { id: 'signals', value: formatNumber(signals), label: 'Demand signals', note: 'Current signal volume', tone: 'success' },
        { id: 'alerts', value: String(alertCount()), label: 'Active alerts', note: 'Requires attention', tone: 'warning' },
      ],
      balance: { shortage: count('shortage'), balanced: count('balanced'), surplus: count('surplus') },
      signals: allMetrics.filter((m) => m.status === 'shortage').sort(byGapSize).slice(0, 3),
      radar: [...allMetrics].sort(byWorkforceGap).slice(0, 4),
    }
  })
}

export interface StatePressure {
  state: State
  meanGap: number | null
  level: PressureLevel
  skillCount: number
}

export interface RankedSkill {
  metrics: SkillMetrics
  /** Change of the gap index over the selected period, in index points. */
  gapChange: number
}

export interface MarketExplorerData {
  states: StatePressure[]
  rankings: RankedSkill[]
  matchCount: number
}

export function getMarketExplorer(filters: Filters): Promise<MarketExplorerData> {
  return request(() => {
    const rows = applyFilters(allMetrics, { ...filters, gapType: null })
    // The map always shows every pilot state, so it ignores the location filters.
    const mapRows = applyFilters(allMetrics, { sector: filters.sector, skillId: filters.skillId })
    const months = PERIOD_MONTHS[filters.period]
    return {
      states: states.map((state) => {
        const inState = mapRows.filter((r) => r.state.id === state.id)
        const meanGap = inState.length ? round1(inState.reduce((s, r) => s + r.gapIndex, 0) / inState.length) : null
        return { state, meanGap, level: pressureLevel(meanGap), skillCount: inState.length }
      }),
      rankings: [...rows].sort(byWorkforceGap).slice(0, 5).map((metrics) => {
        const past = history(metrics, months)[0]
        return { metrics, gapChange: Math.round(metrics.gapIndex - past.gap) }
      }),
      matchCount: rows.length,
    }
  })
}

export interface SkillIntelligenceData {
  metrics: SkillMetrics
  trend: TrendPoint[]
  forecast6M: Forecast
  evidence: Evidence
}

/** Returns null when no skill matches the selection. */
export function getSkillIntelligence(filters: Filters): Promise<SkillIntelligenceData | null> {
  return request(() => {
    const rows = applyFilters(allMetrics, { ...filters, gapType: null }).sort(byWorkforceGap)
    const metrics = rows[0]
    if (!metrics) return null
    return { metrics, trend: history(metrics, 11), forecast6M: forecastFor(metrics, '6M'), evidence: evidenceFor(metrics) }
  })
}

export function getGapMatrix(filters: Filters): Promise<SkillMetrics[]> {
  return request(() => applyFilters(allMetrics, filters).sort(byGapSize))
}

export type WarningKind = 'critical' | 'emerging' | 'saturation'

export interface EarlyWarning {
  kind: WarningKind
  metrics: SkillMetrics
  /** Forecast change of the gap over the next 6 months, in index points. */
  gapChange6M: number
}

export interface ForecastData {
  metrics: SkillMetrics
  horizon: ForecastHorizon
  series: ForecastPoint[]
  forecast: Forecast
  coverage: number
  freshness: string
}

export function getForecast(skillId: string | null, horizon: ForecastHorizon): Promise<ForecastData> {
  return request(() => {
    const metrics = allMetrics.find((m) => m.skill.id === skillId) ?? [...allMetrics].sort(byWorkforceGap)[0]
    return {
      metrics, horizon,
      series: forecastSeries(metrics, horizon),
      forecast: forecastFor(metrics, horizon),
      coverage: metrics.coverage,
      freshness: dataset.updatedAt,
    }
  })
}

export function getEarlyWarnings(): Promise<EarlyWarning[]> {
  return request(() => {
    const change = (m: SkillMetrics) => forecastFor(m, '6M').gap - m.gapIndex
    const shortages = allMetrics.filter((m) => m.status === 'shortage')
    const critical = [...shortages].sort(byGapSize)[0]
    const emerging = shortages
      .filter((m) => m.priority !== 'high')
      .sort((a, b) => change(b) - change(a) || byGapSize(a, b))[0]
    const saturation = allMetrics.filter((m) => m.status === 'surplus').sort(byGapSize)[0]
    const pick = (kind: WarningKind, m?: SkillMetrics): EarlyWarning[] => (m ? [{ kind, metrics: m, gapChange6M: change(m) }] : [])
    return [...pick('critical', critical), ...pick('emerging', emerging), ...pick('saturation', saturation)]
  })
}

export function getActions(): Promise<ActionItem[]> {
  return request(() =>
    recommendations.flatMap((rec) => {
      const metrics = allMetrics.find((m) => m.skill.id === rec.skillId)
      return metrics ? [{ ...rec, metrics, forecast6M: forecastFor(metrics, '6M'), evidence: evidenceFor(metrics) }] : []
    }),
  )
}

export interface MethodologyData {
  steps: MethodologyStep[]
  demandWeights: IndexWeight[]
  supplyWeights: IndexWeight[]
  formula: typeof gapFormula
  thresholds: typeof thresholds
}

export function getMethodology(): Promise<MethodologyData> {
  return request(() => ({ steps: pipelineSteps, demandWeights, supplyWeights, formula: gapFormula, thresholds }))
}

export function getDataSources(): Promise<DataSource[]> {
  return request(() => dataSources)
}
