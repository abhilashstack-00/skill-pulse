/**
 * Domain types for the SkillPulse frontend.
 * These describe the shapes the UI consumes. The mock data layer produces them
 * today; a Supabase/API layer can produce the same shapes later.
 */

export type GapStatus = 'shortage' | 'balanced' | 'surplus'
export type Priority = 'high' | 'medium' | 'low'
export type Confidence = 'High' | 'Medium' | 'Low'
export type ForecastHorizon = 'current' | '3M' | '6M' | '12M'
export type TrendPeriod = '3M' | '6M' | '12M'
/** Visual tone used for gap figures, pills and tiles. */
export type Tone = 'danger' | 'warning' | 'success' | 'primary' | 'neutral'

export interface State {
  id: string
  name: string
  /** Bubble position on the schematic pilot map, in % of the map area. */
  map: { x: number; y: number }
}

export interface District {
  id: string
  name: string
  stateId: string
}

export interface Skill {
  id: string
  name: string
  /** Short label for tight spaces such as chart bubbles. */
  shortName: string
  sector: string
  nsqfLevel: number
}

/** One point of an index forecast: values at a given horizon. */
export interface IndexPair {
  demand: number
  supply: number
}

/** Raw mock record: one skill observed in its pilot district. */
export interface SkillMarketRecord {
  skillId: string
  districtId: string
  demandIndex: number
  supplyIndex: number
  /** % change of the demand index over the last 6 months. */
  demandGrowth: number
  /** % change of the supply (training) index over the last 6 months. */
  supplyGrowth: number
  /** Estimated head-count behind the index gap (shortfall or excess). */
  workforceGap: number
  /** Number of demand signals observed for this skill. */
  demandSignals: number
  /** % of pilot districts with usable data for this skill. */
  coverage: number
  confidence: Confidence
  primaryDriver: string
  forecast: Record<Exclude<ForecastHorizon, 'current'>, IndexPair>
}

/** Record joined with its skill and location, plus derived gap fields. */
export interface SkillMetrics extends SkillMarketRecord {
  skill: Skill
  district: District
  state: State
  gapIndex: number
  status: GapStatus
  priority: Priority
  /** True when the gap is forecast to move into shortage/surplus within 6M. */
  emerging: boolean
}

export interface Forecast {
  horizon: ForecastHorizon
  demand: number
  supply: number
  gap: number
  confidence: Confidence
}

export interface TrendPoint {
  /** ISO month, e.g. 2026-09. */
  month: string
  label: string
  demand: number
  supply: number
  gap: number
}

export interface ForecastPoint {
  month: string
  label: string
  /** Observed gap (null for future months). */
  actual: number | null
  /** Forecast gap (null for past months, except the joining point). */
  forecast: number | null
  /** Confidence band [low, high] around the forecast. */
  band: [number, number] | null
}

export interface Filters {
  stateId: string | null
  districtId: string | null
  sector: string | null
  skillId: string | null
  gapType: GapStatus | null
  period: TrendPeriod
}

export interface Option {
  value: string
  label: string
}

export interface FilterOptions {
  states: Option[]
  districts: (Option & { stateId: string })[]
  sectors: Option[]
  skills: (Option & { sector: string; stateId: string; districtId: string })[]
  gapTypes: Option[]
  periods: Option[]
}

export type DataSourceRole = 'demand' | 'supply'
export type DataSourceStage = 'Prototype dataset' | 'Planned integration' | 'Demo source'

export interface DataSource {
  id: string
  name: string
  fullName: string
  role: DataSourceRole
  coverage: string
  coverageDetail: string
  lastUpdated: string
  fieldsUsed: string[]
  transformation: [string, string]
  transformationDetail: [string, string]
  stage: DataSourceStage
}

export type ActionSeverity = 'critical' | 'priority' | 'rebalance' | 'watch'

export interface Recommendation {
  id: string
  skillId: string
  severity: ActionSeverity
  title: string
  suggestedAction: string
}

export interface Evidence {
  demandSources: DataSource[]
  supplySources: DataSource[]
  coverage: number
  freshness: string
  method: string
}

/** Recommendation joined with the metrics and evidence that justify it. */
export interface ActionItem extends Recommendation {
  metrics: SkillMetrics
  forecast6M: Forecast
  evidence: Evidence
}

export interface MethodologyStep {
  id: string
  label: string
  description: string
}

export interface IndexWeight {
  label: string
  weight: number
}

export interface KpiStat {
  id: string
  value: string
  label: string
  note: string
  tone: Tone
}
