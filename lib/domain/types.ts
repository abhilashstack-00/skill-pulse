/**
 * Domain types. The first block mirrors the database tables one to one;
 * the rest are results produced by the intelligence layer.
 */

/* ------------------------------ Stored data ------------------------------ */

export interface State { id: string; name: string; nameHi: string; code: string }
export interface District { id: string; stateId: string; name: string; nameHi: string; code: string }
export interface Sector { id: string; name: string; nameHi: string; code: string }
export interface Trade { id: string; sectorId: string; name: string; nameHi: string; ncoCode: string; nsqfLevel: number }

export interface TrainingCentre {
  id: string
  name: string
  districtId: string
  sectorId: string
  status: 'active' | 'inactive'
  capacity: number
}

/** One training year for one trade in one district. Outcomes may be unknown. */
export interface TrainingCapacityRow {
  districtId: string
  sectorId: string
  tradeId: string
  /** Start year of the training cycle (2026 = cycle 2026-27). */
  year: number
  allocatedSeats: number
  enrolled: number | null
  completed: number | null
  placed: number | null
}

/** One month of normalised demand signals for one trade in one district. */
export interface LabourDemandRow {
  districtId: string
  sectorId: string
  tradeId: string
  /** YYYY-MM */
  period: string
  /** Openings posted on job portals (count). */
  jobPostings: number | null
  /** Employer hiring-intent score, 0–100. */
  hiringSignal: number | null
  /** Vacancies registered on government employment exchanges (count). */
  employmentRegistrations: number | null
  /** Industry demand outlook score, 0–100. */
  industryDemandSignal: number | null
  source: string
}

export type SourceStatus = 'prototype_synthetic' | 'prototype_reference' | 'planned'

export interface DataSource {
  id: string
  name: string
  description: string
  sourceType: 'demand' | 'supply' | 'reference'
  lastUpdated: string | null
  status: SourceStatus
  coverage: string
  granularity: string
  /** What the pilot uses in place of this source today. */
  feeds: string
  recordsIn: number | null
  recordsMapped: number | null
}

export interface DatasetMeta {
  label: string
  synthetic: boolean
  /** Last month covered by demand data, YYYY-MM. */
  asOfPeriod: string
  /** Date the dataset was last refreshed, YYYY-MM-DD. */
  updatedAt: string
  /** Training cycle in progress at asOfPeriod. */
  currentTrainingYear: number
}

export interface Dataset {
  meta: DatasetMeta
  states: State[]
  districts: District[]
  sectors: Sector[]
  trades: Trade[]
  trainingCentres: TrainingCentre[]
  trainingCapacity: TrainingCapacityRow[]
  labourDemand: LabourDemandRow[]
  dataSources: DataSource[]
}

/* --------------------------- Intelligence results ------------------------- */

export type GapStatus =
  | 'severe_shortage'
  | 'shortage'
  | 'balanced'
  | 'oversupply'
  | 'severe_oversupply'
  | 'insufficient_data'

/** A status, or a group of statuses, used as a filter. */
export type StatusFilter = GapStatus | 'any_shortage' | 'any_oversupply'

export type HorizonKey = 'current' | '3M' | '6M' | '12M'
export type ConfidenceLabel = 'high' | 'medium' | 'low'
export type ForecastMethod = 'full' | 'limited_history' | 'baseline_estimate' | 'insufficient_data'

export interface WeightedComponent {
  key: string
  weight: number
  /** Raw input before scaling (count or rate); null when missing. */
  raw: number | null
  /** Reference value used for scaling count components, if any. */
  reference: number | null
  /** Component on the 0–100 scale; null when missing. */
  normalized: number | null
  /** weight × normalized. */
  contribution: number | null
}

export interface IndexResult {
  /** Null when any component is missing. Never imputed. */
  value: number | null
  components: WeightedComponent[]
  missing: string[]
}

export interface GapResult {
  demand: number | null
  supply: number | null
  gap: number | null
  /** ((demand − supply) / supply) × 100. Null when supply is 0 or data is missing. */
  gapPercentage: number | null
  status: GapStatus
  /** Why the result is not a plain classification, if so. */
  note: 'no_demand_forecast' | 'no_supply_data' | 'zero_supply' | null
}

export interface Confidence { score: number; label: ConfidenceLabel }

export interface ForecastComponents {
  /** Mean of the last observed months. */
  baseline: number
  /** OLS slope over the trend window, units per month. */
  trendSlope: number
  /** Change between the last two quarter averages, units per month. */
  recentSlope: number
  residualStd: number
  slopeStdErr: number
  monthsUsed: number
  /** Month index the baseline is centred on. */
  baselineCentre: number
}

export interface MonthlyForecastPoint { period: string; value: number; lower: number; upper: number }

export interface DemandForecast {
  horizonMonths: number
  /** First and last forecast month, YYYY-MM. */
  periodStart: string
  periodEnd: string
  method: ForecastMethod
  predictedDemand: number | null
  lowerBound: number | null
  upperBound: number | null
  /** Split of predictedDemand into its three parts. */
  parts: { baseline: number; trend: number; recentGrowth: number } | null
  confidence: Confidence | null
  components: ForecastComponents | null
  monthly: MonthlyForecastPoint[]
  modelVersion: string
  reason: 'too_few_months' | 'stale' | null
}

export interface SupplyForecast {
  horizonMonths: number
  method: 'capacity_trend' | 'flat_single_year' | 'insufficient_data'
  predictedSupply: number | null
  /** Seats allocated in the latest cycle. */
  currentAnnualCapacity: number | null
  /** Annual capacity projected for the horizon window. */
  projectedAnnualCapacity: number | null
  /** Average yearly change in seats used for the projection. */
  yearlyChange: number | null
  latestYear: number | null
  modelVersion: string
}

export interface HorizonResult {
  horizon: HorizonKey
  months: number
  periodStart: string
  periodEnd: string
  demand: number | null
  demandLower: number | null
  demandUpper: number | null
  supply: number | null
  gap: GapResult
  confidence: Confidence | null
  method: ForecastMethod
}

export interface PriorityComponent {
  key: 'gapSeverity' | 'demandGrowth' | 'employmentSignal' | 'capacityPressure' | 'forecastConfidence'
  weight: number
  /** The underlying figure the component was derived from. */
  raw: number | null
  /** 0–100, measured in the direction of the gap. */
  value: number | null
  contribution: number | null
}

export interface PriorityResult {
  /** Null when a required input is missing. Never imputed. */
  score: number | null
  band: 'high' | 'medium' | 'low' | null
  direction: 'shortage' | 'oversupply'
  components: PriorityComponent[]
  missing: string[]
}

export type WarningType =
  | 'acute_shortage'
  | 'upcoming_shortage'
  | 'emerging_shortage'
  | 'saturation'
  | 'upcoming_saturation'
  | 'oversupply_risk'
  | 'monitor'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface EvidenceItem {
  /** Message key for the label. */
  key: string
  value: number | string | null
  unit?: 'pct' | 'persons' | 'seats' | 'score' | 'status' | 'text' | 'pts'
}

export interface Warning {
  id: string
  type: WarningType
  severity: Severity
  districtId: string
  sectorId: string
  tradeId: string
  /** Message key; rendered with `params` in the reader's language. */
  reason: string
  recommendedAction: string
  params: Record<string, number | string | null>
  evidence: EvidenceItem[]
}

export type ActionCode =
  | 'increase_capacity'
  | 'fill_seats_first'
  | 'review_allocation'
  | 'reduce_or_redirect'
  | 'maintain'
  | 'collect_data'

export interface Recommendation {
  id: string
  districtId: string
  sectorId: string
  tradeId: string
  action: ActionCode
  /** Extra note attached to the action, if a rule fired. */
  secondary: 'review_quality' | null
  params: Record<string, number | string | null>
  evidence: EvidenceItem[]
  priorityScore: number | null
  status: GapStatus
}

export interface DemandMonth {
  period: string
  /** jobPostings + employmentRegistrations; null if either is missing. */
  volume: number | null
  jobPostings: number | null
  hiringSignal: number | null
  employmentRegistrations: number | null
  industryDemandSignal: number | null
}

export interface CellAnalysis {
  key: string
  stateId: string
  districtId: string
  sectorId: string
  tradeId: string
  demand: {
    series: DemandMonth[]
    monthsObserved: number
    index: IndexResult
    /** Average monthly openings over the smoothing window. */
    monthlyRunRate: number | null
    /** OLS trend over the trend window, as % of the window mean per year. */
    trendPct: number | null
    source: string | null
  }
  supply: {
    years: TrainingCapacityRow[]
    latestYear: number | null
    seats: number | null
    enrolled: number | null
    /** Year the completion and placement figures refer to. */
    outcomesYear: number | null
    completed: number | null
    placed: number | null
    utilizationPct: number | null
    completionRatePct: number | null
    placementRatePct: number | null
    /** Change in allocated seats versus the previous cycle, %. */
    capacityChangePct: number | null
    index: IndexResult
  }
  demandForecasts: Record<'3M' | '6M' | '12M', DemandForecast>
  supplyForecasts: Record<'3M' | '6M' | '12M', SupplyForecast>
  horizons: Record<HorizonKey, HorizonResult>
  priority: PriorityResult
  warnings: Warning[]
  recommendation: Recommendation
}

export interface BacktestResult {
  horizon: '3M' | '6M' | '12M'
  cells: number
  /** Σ|error| / Σ actual, %. */
  wape: number | null
  medianApe: number | null
  /** 80% of backtest errors were within ± this share of the actual total, %. */
  p80Ape: number | null
}

export interface Snapshot {
  meta: DatasetMeta
  methodologyVersion: string
  references: { jobPostings: number; employmentRegistrations: number; seats: number }
  cells: CellAnalysis[]
  backtest: BacktestResult[]
  /** Minimum relative half-width of forecast intervals, from the backtest. */
  intervalCalibration: Record<'3M' | '6M' | '12M', number>
  dataset: Dataset
}
