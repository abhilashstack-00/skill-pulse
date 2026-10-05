import { ALERTS, DATA_QUALITY, DEMAND_INDEX, FORECAST, GROUP, METHODOLOGY_VERSION, NORMALIZATION, PRIORITY } from '@/lib/config/methodology'
import type {
  BacktestResult, CellAnalysis, DataQuality, Dataset, DemandForecast, DemandMonth, HorizonKey, HorizonResult,
  LabourDemandRow, Snapshot, SupplyForecast, TrainingCapacityRow,
} from '@/lib/domain/types'
import { evaluateWarnings } from './alerts'
import { computeDemandIndex } from './demand-index'
import { demandTrendPct, forecastDemandSeries, recentWindow, type MonthlyObservation } from './forecast'
import { computeGap, isFirm } from './gap'
import { addMonths, mean, median, monthIndex, percentile, periodFromIndex, round, sum } from './math'
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

/**
 * Average of a signal over its most recent observed months: the same window the
 * forecast baseline uses. Null with fewer than 2 recent observations.
 */
function currentAverage(series: DemandMonth[], asOf: string, pick: (m: DemandMonth) => number | null): number | null {
  const points = series.map((m) => ({ t: monthIndex(m.period), y: pick(m) })).filter((p): p is { t: number; y: number } => p.y !== null)
  const recent = recentWindow(points, monthIndex(asOf))
  return recent.length >= 2 ? mean(recent.map((p) => p.y)) : null
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

  // Backtest first: it measures how far the model intervals have to be widened.
  const tested = backtest(facts, asOfPeriod)
  const calibration = Object.fromEntries(
    tested.map((b) => [b.horizon, {
      factor: b.calibrationFactor ?? FORECAST.calibration.minFactor,
      errorCorrelation: Math.min(1, Math.max(GROUP.minErrorCorrelation, b.errorCorrelation ?? 0)),
      measuredCorrelation: b.errorCorrelation,
    }]),
  ) as Snapshot['calibration']

  const dataQuality = assessDataQuality(dataset)
  const cells = facts.map((f, i) => analyseCell(f, current[i], references, asOfPeriod, currentTrainingYear, calibration, dataQuality.flagged))
  return { meta: dataset.meta, methodologyVersion: METHODOLOGY_VERSION, references, cells, backtest: tested, calibration, dataQuality, dataset }
}

/**
 * How much of each source reached the dataset: rows, and for count sources
 * volume. Rows that could not be mapped are not in the fact tables, so the
 * engine cannot see them; the only trace is the loads' own totals. A source
 * that lost a material share makes demand look lower than it is.
 */
export function assessDataQuality(dataset: Dataset): DataQuality {
  const bySource = new Map<string, Dataset['ingestionRuns']>()
  for (const run of [...dataset.ingestionRuns].sort((a, b) => a.id - b.id)) bySource.set(run.sourceId, [...(bySource.get(run.sourceId) ?? []), run])
  const sources = [...bySource.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([sourceId, all]) => {
    // Everything loaded since the source was last replaced is still in the dataset, so all of it counts:
    // one clean file loaded on top of a lossy one does not make the earlier loss go away.
    const lastReplace = all.map((r) => r.mode).lastIndexOf('replace')
    const runs = all.slice(Math.max(0, lastReplace))
    const rowsRead = sum(runs.map((r) => r.rowsRead))
    const rowsMapped = sum(runs.map((r) => r.rowsMapped))
    const tracksVolume = runs.every((r) => r.valueRead !== null)
    const valueRead = tracksVolume ? sum(runs.map((r) => r.valueRead as number)) : null
    const valueMapped = tracksVolume ? sum(runs.map((r) => r.valueMapped ?? 0)) : null
    const sharePct = valueRead ? round(((valueMapped as number) / valueRead) * 100, 1) : null
    // Rows whose value could not be read carry no volume, so they are only visible in the row count.
    const rowSharePct = rowsRead ? round((rowsMapped / rowsRead) * 100, 1) : 100
    const largeRejects = valueRead
      ? sum(runs.map((r) => r.rejects.filter((x) => x.value !== null && (x.value / valueRead) * 100 >= DATA_QUALITY.largeRejectSharePct).length))
      : 0
    return {
      sourceId, runId: runs[runs.length - 1].id, loads: runs.length, rowsRead, rowsMapped, rowSharePct, valueRead, valueMapped, sharePct,
      rowsHeld: sum(runs.map((r) => r.rowsHeld)), largeRejects,
      flagged: (sharePct !== null && sharePct < DATA_QUALITY.minVolumeSharePct) || rowSharePct < DATA_QUALITY.minVolumeSharePct || largeRejects > 0,
    }
  })
  return { sources, flagged: sources.some((s) => s.flagged) }
}

function analyseCell(
  f: CellFacts,
  currentRaw: { jobPostings: number | null; hiringSignal: number | null; employmentRegistrations: number | null; industryDemandSignal: number | null },
  references: Snapshot['references'],
  asOf: string,
  trainingYear: number,
  calibration: Snapshot['calibration'],
  demandDataDoubtful: boolean,
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
    const d = forecastDemandSeries(obs, asOf, months, FORECAST, calibration[key].factor)
    const s = forecastSupply(f.training, trainingYear, months)
    demandForecasts[key] = d
    supplyForecasts[key] = s
    const gap = computeGap(d.predictedDemand, s.predictedSupply)
    horizons[key] = {
      horizon: key, months, periodStart: d.periodStart, periodEnd: d.periodEnd,
      demand: d.predictedDemand, demandLower: d.lowerBound, demandUpper: d.upperBound,
      supply: s.predictedSupply, gap, firm: isFirm(gap, d.lowerBound, d.upperBound),
      confidence: d.confidence, method: d.method,
    }
  }

  // "Current": the recent average rate of demand, annualised, against this cycle's seats.
  const baseline = demandForecasts['12M'].components?.baseline ?? null
  const currentDemand = baseline === null ? null : Math.round(baseline * 12)
  horizons.current = {
    horizon: 'current', months: 12, periodStart: addMonths(asOf, -(DEMAND_INDEX.smoothingMonths - 1)), periodEnd: asOf,
    demand: currentDemand, demandLower: null, demandUpper: null,
    supply: supplyRaw.seats, gap: computeGap(currentDemand, supplyRaw.seats), firm: null,
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
      priorityScore: priority.score, demandDataDoubtful,
    }),
  }
}

/**
 * Backtest with rolling origins: for every pair and every start month that has
 * a full trend window behind it and H observed months ahead of it, forecast
 * those H months from the earlier ones and compare with what was observed.
 *
 * Measured per horizon:
 *  - the size of the errors (WAPE, median and the `coverage` percentile);
 *  - the calibration factor: each error is divided by that forecast's own model
 *    half-width, and the factor is the `coverage` percentile of those ratios.
 *    This factor is fitted to all the errors, so by construction it contains
 *    `coverage` of them: that is not evidence that it works;
 *  - the forward check, which is the evidence: for each later start month the
 *    factor is set only from forecasts whose outcome was already known at that
 *    month, and the month's own forecasts are counted in or out of the widened
 *    interval. With too little history it cannot be done and is left empty;
 *  - how much errors of different pairs moved together, which decides how wide
 *    the interval of a sum of pairs has to be.
 */
function backtest(facts: CellFacts[], asOf: string): BacktestResult[] {
  const asOfIndex = monthIndex(asOf)
  const coveragePct = FORECAST.coverage * 100
  return FORECAST_HORIZONS.map((horizon) => {
    const months = FORECAST.horizons[horizon]
    const samples: { cell: number; origin: number; actual: number; predicted: number; modelHalf: number }[] = []
    facts.forEach((f, cell) => {
      const obs = observations(f.series)
      const byMonth = new Map(obs.map((o) => [monthIndex(o.period), o.value]))
      for (let origin = asOfIndex - months; origin > asOfIndex - months - FORECAST.trendWindow * 3; origin--) {
        const future = Array.from({ length: months }, (_, k) => byMonth.get(origin + 1 + k))
        if (future.some((v) => v === undefined)) continue
        const cutoff = periodFromIndex(origin)
        const forecast = forecastDemandSeries(obs.filter((o) => o.period <= cutoff), cutoff, months)
        if (forecast.method !== 'full' || forecast.predictedDemand === null || !forecast.interval) continue
        const actual = sum(future as number[])
        if (actual > 0 && forecast.interval.modelHalfWidth > 0) {
          samples.push({ cell, origin, actual, predicted: forecast.predictedDemand, modelHalf: forecast.interval.modelHalfWidth })
        }
      }
    })
    const ratio = (s: (typeof samples)[number]) => Math.abs(s.predicted - s.actual) / s.modelHalf
    const factorOf = (subset: typeof samples) => Math.max(FORECAST.calibration.minFactor, percentile(subset.map(ratio), coveragePct))

    // Forward check. A forecast started at month o is only known to be right or wrong at o + H.
    let hits = 0
    let checked = 0
    for (const origin of [...new Set(samples.map((s) => s.origin))].sort((a, b) => a - b)) {
      const known = samples.filter((s) => s.origin + months <= origin)
      if (known.length < FORECAST.calibration.minForwardSamples) continue
      const factor = factorOf(known)
      const test = samples.filter((s) => s.origin === origin)
      hits += test.filter((s) => ratio(s) <= factor).length
      checked += test.length
    }

    // Error correlation between pairs, per start month: Σ_{i≠j} e_i·e_j ÷ Σ_{i≠j} |e_i|·|e_j|.
    const correlations: number[] = []
    for (const origin of new Set(samples.map((s) => s.origin))) {
      const errors = samples.filter((s) => s.origin === origin).map((s) => s.predicted - s.actual)
      if (errors.length < 3) continue
      const squares = sum(errors.map((e) => e * e))
      const denominator = sum(errors.map(Math.abs)) ** 2 - squares
      if (denominator > 0) correlations.push((sum(errors) ** 2 - squares) / denominator)
    }

    const totalActual = sum(samples.map((s) => s.actual))
    const apes = samples.map((s) => (Math.abs(s.predicted - s.actual) / s.actual) * 100)
    const any = samples.length > 0
    return {
      horizon,
      cells: new Set(samples.map((s) => s.cell)).size,
      origins: new Set(samples.map((s) => s.origin)).size,
      samples: samples.length,
      wape: any ? round((sum(samples.map((s) => Math.abs(s.predicted - s.actual))) / totalActual) * 100, 1) : null,
      medianApe: any ? round(median(apes), 1) : null,
      pctErrorAtCoverage: any ? round(percentile(apes, coveragePct), 1) : null,
      calibrationFactor: any ? round(factorOf(samples), 3) : null,
      holdoutCoverage: checked ? round((hits / checked) * 100, 1) : null,
      holdoutSamples: checked,
      errorCorrelation: correlations.length ? round(mean(correlations), 3) : null,
    }
  })
}
