import { FORECAST } from '@/lib/config/methodology'
import type { Confidence, DemandForecast, ForecastMethod, MonthlyForecastPoint } from '@/lib/domain/types'
import { clamp, linearFit, mean, monthIndex, periodFromIndex, round, sampleStd, sum } from './math'

export interface MonthlyObservation {
  /** YYYY-MM */
  period: string
  value: number
}

export type ForecastParams = typeof FORECAST

/**
 * ForecastService — transparent baseline forecast of monthly demand.
 *
 *   forecast(month k) = baseline + trend component + recent-growth component
 *
 *   baseline       mean of the last 3 observed months (rolling average)
 *   trend          OLS slope over the last 12 months × distance × trendWeight
 *   recent growth  change between the last two 3-month averages, per month,
 *                  × (1 − trendWeight), damped each month
 *
 * The horizon forecast is the sum of the monthly forecasts. The interval
 * combines month-to-month noise, uncertainty in the baseline average and
 * uncertainty in the trend slope, and is widened to the error measured in the
 * backtest when that is larger. Nothing here is random.
 */
export function forecastDemandSeries(
  observations: MonthlyObservation[],
  asOfPeriod: string,
  horizonMonths: number,
  params: ForecastParams = FORECAST,
  /**
   * Relative error observed in the backtest at this horizon (e.g. 0.12).
   * When given, the interval is never narrower than ± this share of the
   * forecast, so stated uncertainty cannot be smaller than measured error.
   */
  empiricalRelativeError = 0,
): DemandForecast {
  const asOf = monthIndex(asOfPeriod)
  const base = {
    horizonMonths,
    periodStart: periodFromIndex(asOf + 1),
    periodEnd: periodFromIndex(asOf + horizonMonths),
    modelVersion: params.modelVersion,
  }
  const none = (reason: 'too_few_months' | 'stale'): DemandForecast => ({
    ...base, method: 'insufficient_data', predictedDemand: null, lowerBound: null, upperBound: null,
    parts: null, confidence: null, components: null, monthly: [], reason,
  })

  const points = observations
    .map((o) => ({ t: monthIndex(o.period), y: o.value }))
    .filter((p) => p.t <= asOf && p.t > asOf - params.trendWindow && Number.isFinite(p.y))
    .sort((a, b) => a.t - b.t)

  if (points.length < params.minMonthsBaseline) return none('too_few_months')
  if (asOf - points[points.length - 1].t >= params.staleAfterMonths) return none('stale')

  const method: ForecastMethod =
    points.length < params.minMonthsTrend ? 'baseline_estimate' : points.length < params.trendWindow ? 'limited_history' : 'full'

  const last = points.slice(-params.baselineWindow)
  const baseline = mean(last.map((p) => p.y))
  const baselineCentre = mean(last.map((p) => p.t))

  let trendSlope = 0
  let recentSlope = 0
  let residualStd = sampleStd(points.map((p) => p.y))
  let slopeStdErr = 0

  if (method !== 'baseline_estimate') {
    const fit = linearFit(points.map((p) => p.t), points.map((p) => p.y))
    trendSlope = fit.slope
    residualStd = fit.residualStd
    slopeStdErr = fit.slopeStdErr
    const previous = points.slice(-2 * params.baselineWindow, -params.baselineWindow)
    const gapMonths = baselineCentre - mean(previous.map((p) => p.t))
    recentSlope = gapMonths > 0 ? (baseline - mean(previous.map((p) => p.y))) / gapMonths : 0
  }

  const wTrend = params.trendWeight
  const phi = params.growthDamping
  const dampedDistance = (d: number) => (1 - phi ** d) / (1 - phi)
  const z = params.intervalZ

  const monthly: MonthlyForecastPoint[] = []
  const distances: number[] = []
  let trendTotal = 0
  let growthTotal = 0
  let total = 0
  for (let k = 1; k <= horizonMonths; k++) {
    const d = asOf + k - baselineCentre
    const trendPart = wTrend * trendSlope * d
    const growthPart = (1 - wTrend) * recentSlope * dampedDistance(d)
    const value = Math.max(0, baseline + trendPart + growthPart)
    const half = Math.max(
      z * Math.sqrt(residualStd ** 2 * (1 + 1 / last.length) + (wTrend * slopeStdErr * d) ** 2),
      empiricalRelativeError * value,
    )
    distances.push(d)
    trendTotal += trendPart
    growthTotal += growthPart
    total += value
    monthly.push({ period: periodFromIndex(asOf + k), value: round(value, 1), lower: round(Math.max(0, value - half), 1), upper: round(value + half, 1) })
  }

  // Variance of the horizon total: independent monthly noise, one shared error
  // in the baseline average, and one shared error in the trend slope.
  const variance =
    horizonMonths * residualStd ** 2 +
    (horizonMonths ** 2 * residualStd ** 2) / last.length +
    (wTrend * slopeStdErr * sum(distances)) ** 2
  const half = Math.max(z * Math.sqrt(variance), empiricalRelativeError * total)

  return {
    ...base,
    method,
    predictedDemand: Math.round(total),
    lowerBound: Math.round(Math.max(0, total - half)),
    upperBound: Math.round(total + half),
    parts: { baseline: round(baseline * horizonMonths, 1), trend: round(trendTotal, 1), recentGrowth: round(growthTotal, 1) },
    confidence: confidenceFrom(total, half, method, params),
    components: {
      baseline: round(baseline, 2),
      trendSlope: round(trendSlope, 3),
      recentSlope: round(recentSlope, 3),
      residualStd: round(residualStd, 2),
      slopeStdErr: round(slopeStdErr, 3),
      monthsUsed: points.length,
      baselineCentre,
    },
    monthly,
    reason: null,
  }
}

/**
 * Confidence is derived from the width of the interval relative to the
 * forecast, then capped when history is short. It is never asserted.
 */
export function confidenceFrom(predicted: number, halfWidth: number, method: ForecastMethod, params: ForecastParams = FORECAST): Confidence {
  const c = params.confidence
  const relative = predicted > 0 ? halfWidth / predicted : 1
  let score = 100 * clamp(1 - relative / c.zeroAtRelativeWidth, 0, 1)
  if (method === 'baseline_estimate') score = Math.min(score, c.capBaselineEstimate)
  if (method === 'limited_history') score = Math.min(score, c.capLimitedHistory)
  score = Math.round(score)
  return { score, label: score >= c.high ? 'high' : score >= c.medium ? 'medium' : 'low' }
}

/**
 * Annualised demand trend: OLS slope over the trend window × 12, as a
 * percentage of the window mean. Null with fewer than minMonthsTrend months.
 */
export function demandTrendPct(observations: MonthlyObservation[], asOfPeriod: string, params: ForecastParams = FORECAST): number | null {
  const asOf = monthIndex(asOfPeriod)
  const points = observations
    .map((o) => ({ t: monthIndex(o.period), y: o.value }))
    .filter((p) => p.t <= asOf && p.t > asOf - params.trendWindow)
  if (points.length < params.minMonthsTrend) return null
  const fit = linearFit(points.map((p) => p.t), points.map((p) => p.y))
  return fit.meanY > 0 ? round(((fit.slope * 12) / fit.meanY) * 100, 1) : null
}

/** Facade matching the service named in the methodology. */
export const ForecastService = {
  forecastDemand: forecastDemandSeries,
  demandTrendPct,
}
