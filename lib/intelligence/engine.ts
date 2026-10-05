import { ALERTS, DEMAND_INDEX, FORECAST, METHODOLOGY_VERSION, NORMALIZATION, PRIORITY } from '@/lib/config/methodology'
import type {
  BacktestResult, CellAnalysis, Dataset, DemandForecast, DemandMonth, HorizonKey, HorizonResult,
  LabourDemandRow, Snapshot, SupplyForecast, TrainingCapacityRow,
} from '@/lib/domain/types'
import { evaluateWarnings } from './alerts'
import { computeDemandIndex } from './demand-index'
import { demandTrendPct, forecastDemandSeries, type MonthlyObservation } from './forecast'
import { computeGap } from './gap'
import { addMonths, mean, median, monthIndex, percentile, round, sum } from './math'
import { computePriority } from './priority'
import { recommend } from './recommendations'
import { computeSupplyIndex, supplyRates } from './supply-index'
import { forecastSupply } from './supply-forecast'

export const FORECAST_HORIZONS = ['3M', '6M', '12M'] as const
export type ForecastHorizonKey = (typeof FORECAST_HORIZONS)[number]
export const HORIZON_KEYS: HorizonKey[] = ['current', '3M', '6M', '12M']

const cellKey = (districtId: string, tradeId: string) => `${districtId}|${tradeId}`

/** Monthly demand volume: portal postings + exchange vacancies. Null if either is missing. */
export function demandVolume(row: Pick<LabourDemandRow, 'jobPostings' | 'employmentRegistrations'>): number | null {
  return row.jobPostings === null || row.employmentRegistrations === null ? null : row.jobPostings + row.employmentRegistrations
}

/** Average of a signal over the smoothing window. Null with fewer than 2 observed months. */
function currentAverage(series: DemandMonth[], asOf: string, pick: (m: DemandMonth) => number | null): number | null {
  const from = monthIndex(asOf) - DEMAND_INDEX.smoothingMonths
  const values = series.filter((m) => monthIndex(m.period) > from).map(pick).filter((v): v is number => v !== null)
  return values.length >= 2 ? mean(values) : null
}

export function observations(series: DemandMonth[]): MonthlyObservation[] {
  return series.filter((m) => m.volume !== null).map((m) => ({ period: m.period, value: m.volume as number }))
}

interface CellFacts {
  key: string
  stateId: string
  districtId: string
  sectorId: string
  tradeId: string
  series: DemandMonth[]
  source: string | null
  training: TrainingCapacityRow[]
}

function collectFacts(dataset: Dataset): CellFacts[] {
  const stateOf = new Map(dataset.districts.map((d) => [d.id, d.stateId]))
  const sectorOf = new Map(dataset.trades.map((t) => [t.id, t.sectorId]))
  const cells = new Map<string, CellFacts>()
  const cell = (districtId: string, tradeId: string) => {
    const key = cellKey(districtId, tradeId)
    let found = cells.get(key)
    if (!found) {
      found = { key, stateId: stateOf.get(districtId) ?? '', districtId, sectorId: sectorOf.get(tradeId) ?? '', tradeId, series: [], source: null, training: [] }
      cells.set(key, found)
    }
    return found
  }
  for (const row of dataset.labourDemand) {
    const c = cell(row.districtId, row.tradeId)
    c.source = row.source
    c.series.push({
      period: row.period,
      volume: demandVolume(row),
      jobPostings: row.jobPostings,
      hiringSignal: row.hiringSignal,
      employmentRegistrations: row.employmentRegistrations,
      industryDemandSignal: row.industryDemandSignal,
    })
  }
  for (const row of dataset.trainingCapacity) cell(row.districtId, row.tradeId).training.push(row)
  for (const c of cells.values()) {
    c.series.sort((a, b) => a.period.localeCompare(b.period))
    c.training.sort((a, b) => a.year - b.year)
  }
  return [...cells.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Run every engine over the dataset. Pure: same dataset in, same snapshot out. */
export function buildSnapshot(dataset: Dataset): Snapshot {
  const { asOfPeriod, currentTrainingYear } = dataset.meta
  const facts = collectFacts(dataset)

  // Reference values for scaling counts: the configured percentile across all cells.
  const current = facts.map((f) => ({
    jobPostings: currentAverage(f.series, asOfPeriod, (m) => m.jobPostings),
    hiringSignal: currentAverage(f.series, asOfPeriod, (m) => m.hiringSignal),
    employmentRegistrations: currentAverage(f.series, asOfPeriod, (m) => m.employmentRegistrations),
    industryDemandSignal: currentAverage(f.series, asOfPeriod, (m) => m.industryDemandSignal),
  }))
  const latestTraining = facts.map((f) => f.training[f.training.length - 1] ?? null)
  const ref = (values: (number | null)[]) => {
    const present = values.filter((v): v is number => v !== null)
    return present.length ? round(percentile(present, NORMALIZATION.referencePercentile), 1) : 0
  }
  const references = {
    jobPostings: ref(current.map((c) => c.jobPostings)),
    employmentRegistrations: ref(current.map((c) => c.employmentRegistrations)),
    seats: ref(latestTraining.map((t) => t?.allocatedSeats ?? null)),
  }

  // Backtest first: its measured error sets the minimum width of every forecast interval.
  const tested = backtest(facts, asOfPeriod)
  const intervalCalibration = Object.fromEntries(tested.map((b) => [b.horizon, (b.p80Ape ?? 0) / 100])) as Snapshot['intervalCalibration']

  const cells = facts.map((f, i) => analyseCell(f, current[i], references, asOfPeriod, currentTrainingYear, intervalCalibration))
  return { meta: dataset.meta, methodologyVersion: METHODOLOGY_VERSION, references, cells, backtest: tested, intervalCalibration, dataset }
}

function analyseCell(
  f: CellFacts,
  currentRaw: { jobPostings: number | null; hiringSignal: number | null; employmentRegistrations: number | null; industryDemandSignal: number | null },
  references: Snapshot['references'],
  asOf: string,
  trainingYear: number,
  calibration: Snapshot['intervalCalibration'],
): CellAnalysis {
  const obs = observations(f.series)
  const demandIndex = computeDemandIndex(
    {
      jobPostings: currentRaw.jobPostings === null ? null : round(currentRaw.jobPostings, 1),
      hiringSignal: currentRaw.hiringSignal === null ? null : round(currentRaw.hiringSignal, 1),
      employmentRegistrations: currentRaw.employmentRegistrations === null ? null : round(currentRaw.employmentRegistrations, 1),
      industryDemandSignal: currentRaw.industryDemandSignal === null ? null : round(currentRaw.industryDemandSignal, 1),
    },
    references,
  )
  const trend = demandTrendPct(obs, asOf)

  // Supply: latest cycle for seats and enrolment, latest cycle with outcomes for completion and placement.
  const usable = f.training.filter((t) => trainingYear - t.year <= 1)
  const latest = usable[usable.length - 1] ?? null
  const previous = latest ? f.training.find((t) => t.year === latest.year - 1) ?? null : null
  const outcomes = [...f.training].reverse().find((t) => t.completed !== null && t.enrolled !== null) ?? null
  const supplyRaw = {
    seats: latest?.allocatedSeats ?? null,
    enrolled: latest?.enrolled ?? null,
    outcomesEnrolled: outcomes?.enrolled ?? null,
    completed: outcomes?.completed ?? null,
    placed: outcomes?.placed ?? null,
  }
  const rates = supplyRates(supplyRaw)
  const capacityChangePct =
    latest && previous && previous.allocatedSeats > 0 ? round(((latest.allocatedSeats - previous.allocatedSeats) / previous.allocatedSeats) * 100, 1) : null

  const demandForecasts = {} as Record<ForecastHorizonKey, DemandForecast>
  const supplyForecasts = {} as Record<ForecastHorizonKey, SupplyForecast>
  const horizons = {} as Record<HorizonKey, HorizonResult>
  for (const key of FORECAST_HORIZONS) {
    const months = FORECAST.horizons[key]
    const d = forecastDemandSeries(obs, asOf, months, FORECAST, calibration[key])
    const s = forecastSupply(f.training, trainingYear, months)
    demandForecasts[key] = d
    supplyForecasts[key] = s
    horizons[key] = {
      horizon: key, months, periodStart: d.periodStart, periodEnd: d.periodEnd,
      demand: d.predictedDemand, demandLower: d.lowerBound, demandUpper: d.upperBound,
      supply: s.predictedSupply, gap: computeGap(d.predictedDemand, s.predictedSupply),
      confidence: d.confidence, method: d.method,
    }
  }

  // "Current": the latest 3-month average rate of demand, annualised, against this cycle's seats.
  const baseline = demandForecasts['12M'].components?.baseline ?? null
  const currentDemand = baseline === null ? null : Math.round(baseline * 12)
  horizons.current = {
    horizon: 'current', months: 12, periodStart: addMonths(asOf, -(DEMAND_INDEX.smoothingMonths - 1)), periodEnd: asOf,
    demand: currentDemand, demandLower: null, demandUpper: null,
    supply: supplyRaw.seats, gap: computeGap(currentDemand, supplyRaw.seats),
    confidence: null, method: demandForecasts['12M'].method,
  }

  const planning = horizons[PRIORITY.planningHorizon]
  const employmentSignal = demandIndex.components.find((c) => c.key === 'employmentRegistrations')?.normalized ?? null
  const priority = computePriority({
    gap: planning.gap,
    demandTrendPct: trend,
    employmentSignal,
    utilizationPct: rates.utilizationPct,
    confidenceScore: planning.confidence?.score ?? null,
  })
  const ids = { key: f.key, districtId: f.districtId, sectorId: f.sectorId, tradeId: f.tradeId }

  return {
    ...ids,
    stateId: f.stateId,
    demand: {
      series: f.series,
      monthsObserved: obs.length,
      index: demandIndex,
      monthlyRunRate: baseline === null ? null : round(baseline, 1),
      trendPct: trend,
      source: f.source,
    },
    supply: {
      years: f.training,
      latestYear: latest?.year ?? null,
      seats: supplyRaw.seats,
      enrolled: supplyRaw.enrolled,
      outcomesYear: outcomes?.year ?? null,
      completed: supplyRaw.completed,
      placed: supplyRaw.placed,
      utilizationPct: rates.utilizationPct === null ? null : round(rates.utilizationPct, 1),
      completionRatePct: rates.completionRatePct === null ? null : round(rates.completionRatePct, 1),
      placementRatePct: rates.placementRatePct === null ? null : round(rates.placementRatePct, 1),
      capacityChangePct,
      index: computeSupplyIndex(supplyRaw, references.seats),
    },
    demandForecasts,
    supplyForecasts,
    horizons,
    priority,
    warnings: evaluateWarnings({
      ...ids, current: horizons.current, lookahead: horizons[ALERTS.lookaheadHorizon], planning,
      demandTrendPct: trend, capacityChangePct,
    }),
    recommendation: recommend({
      ...ids, planning, demandTrendPct: trend, capacityChangePct,
      utilizationPct: rates.utilizationPct, completionRatePct: rates.completionRatePct, placementRatePct: rates.placementRatePct,
      priorityScore: priority.score,
    }),
  }
}

/**
 * Backtest: hide the last H months of every cell, forecast them from the
 * months before, and compare with what was actually observed.
 */
function backtest(facts: CellFacts[], asOf: string): BacktestResult[] {
  return FORECAST_HORIZONS.map((horizon) => {
    const months = FORECAST.horizons[horizon]
    const cutoff = addMonths(asOf, -months)
    const errors: { actual: number; predicted: number }[] = []
    for (const f of facts) {
      const obs = observations(f.series)
      const future = obs.filter((o) => o.period > cutoff)
      if (future.length !== months) continue
      const forecast = forecastDemandSeries(obs.filter((o) => o.period <= cutoff), cutoff, months)
      if (forecast.method !== 'full' || forecast.predictedDemand === null) continue
      const actual = sum(future.map((o) => o.value))
      if (actual > 0) errors.push({ actual, predicted: forecast.predictedDemand })
    }
    const totalActual = sum(errors.map((e) => e.actual))
    const apes = errors.map((e) => (Math.abs(e.predicted - e.actual) / e.actual) * 100)
    return {
      horizon,
      cells: errors.length,
      wape: errors.length ? round((sum(errors.map((e) => Math.abs(e.predicted - e.actual))) / totalActual) * 100, 1) : null,
      medianApe: errors.length ? round(median(apes), 1) : null,
      p80Ape: errors.length ? round(percentile(apes, 80), 1) : null,
    }
  })
}
