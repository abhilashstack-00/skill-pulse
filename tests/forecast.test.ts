import { describe, expect, it } from 'vitest'
import { FORECAST } from '@/lib/config/methodology'
import { demandTrendPct, forecastDemandSeries, ForecastService } from '@/lib/intelligence/forecast'
import { addMonths } from '@/lib/intelligence/math'
import { forecastSupply } from '@/lib/intelligence/supply-forecast'

const AS_OF = '2026-09'
/** n months ending at AS_OF with value f(i), i = 0 for the oldest month. */
const series = (n: number, f: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({ period: addMonths(AS_OF, i - (n - 1)), value: f(i) }))

describe('demand forecast', () => {
  it('is deterministic: the same history always gives the same forecast', () => {
    const history = series(24, (i) => 80 + 2 * i + (i % 3))
    expect(forecastDemandSeries(history, AS_OF, 12)).toEqual(forecastDemandSeries(history, AS_OF, 12))
  })

  it('holds a flat series flat', () => {
    const f = forecastDemandSeries(series(24, () => 100), AS_OF, 12)
    expect(f.method).toBe('full')
    expect(f.predictedDemand).toBe(1200)
    expect(f.parts).toEqual({ baseline: 1200, trend: 0, recentGrowth: 0 })
    expect(f.lowerBound).toBe(1200)
    expect(f.upperBound).toBe(1200)
  })

  it('is baseline + trend component + recent-growth component', () => {
    // A perfectly linear series rising 2 a month: both slopes are 2, no noise.
    const f = forecastDemandSeries(series(24, (i) => 100 + 2 * i), AS_OF, 12)
    expect(f.components).toMatchObject({ baseline: 144, trendSlope: 2, recentSlope: 2, residualStd: 0, monthsUsed: 12 })
    const w = FORECAST.trendWeight
    const phi = FORECAST.growthDamping
    let trend = 0
    let growth = 0
    for (let k = 1; k <= 12; k++) {
      const d = k + 1 // months from the centre of the 3-month baseline
      trend += w * 2 * d
      growth += (1 - w) * 2 * ((1 - phi ** d) / (1 - phi))
    }
    expect(f.parts?.baseline).toBe(144 * 12)
    expect(f.parts?.trend).toBeCloseTo(trend, 1)
    expect(f.parts?.recentGrowth).toBeCloseTo(growth, 1)
    expect(f.predictedDemand).toBe(Math.round(144 * 12 + trend + growth))
  })

  it('gives larger totals for longer horizons and reports the forecast window', () => {
    const history = series(24, (i) => 60 + i)
    const [h3, h6, h12] = [3, 6, 12].map((h) => ForecastService.forecastDemand(history, AS_OF, h))
    expect(h3.predictedDemand as number).toBeLessThan(h6.predictedDemand as number)
    expect(h6.predictedDemand as number).toBeLessThan(h12.predictedDemand as number)
    expect(h12).toMatchObject({ periodStart: '2026-10', periodEnd: '2027-09', modelVersion: FORECAST.modelVersion })
    expect(h12.monthly).toHaveLength(12)
  })

  it('keeps the forecast inside its bounds and never below zero', () => {
    const f = forecastDemandSeries(series(24, (i) => Math.max(0, 40 - 3 * i + ((i * 7) % 5))), AS_OF, 12)
    expect(f.lowerBound as number).toBeGreaterThanOrEqual(0)
    expect(f.lowerBound as number).toBeLessThanOrEqual(f.predictedDemand as number)
    expect(f.upperBound as number).toBeGreaterThanOrEqual(f.predictedDemand as number)
    expect(f.predictedDemand as number).toBeGreaterThanOrEqual(0)
  })

  it('widens the interval and lowers confidence for a noisier series', () => {
    const calm = forecastDemandSeries(series(24, (i) => 100 + (i % 2)), AS_OF, 12)
    const noisy = forecastDemandSeries(series(24, (i) => 100 + (i % 2) * 40), AS_OF, 12)
    const width = (f: typeof calm) => (f.upperBound as number) - (f.lowerBound as number)
    expect(width(noisy)).toBeGreaterThan(width(calm))
    expect(noisy.confidence?.score as number).toBeLessThan(calm.confidence?.score as number)
  })

  it('never states an interval narrower than the error measured in the backtest', () => {
    const history = series(24, () => 100)
    const f = forecastDemandSeries(history, AS_OF, 12, FORECAST, 0.14)
    expect(f.lowerBound).toBe(1032)
    expect(f.upperBound).toBe(1368)
    expect(f.confidence?.score).toBe(72) // 100 × (1 − 0.14 / 0.5)
  })
})

describe('demand forecast with too little history', () => {
  it('gives no forecast with fewer than 3 months', () => {
    const f = forecastDemandSeries(series(2, () => 50), AS_OF, 12)
    expect(f).toMatchObject({ method: 'insufficient_data', predictedDemand: null, lowerBound: null, upperBound: null, confidence: null, reason: 'too_few_months' })
  })

  it('gives a baseline estimate with low confidence for 3–5 months', () => {
    const f = forecastDemandSeries(series(4, (i) => 20 + i), AS_OF, 12)
    expect(f.method).toBe('baseline_estimate')
    expect(f.parts).toMatchObject({ trend: 0, recentGrowth: 0 })
    expect(f.predictedDemand).toBe(Math.round(((21 + 22 + 23) / 3) * 12))
    expect(f.confidence?.label).toBe('low')
    expect(f.confidence?.score as number).toBeLessThanOrEqual(FORECAST.confidence.capBaselineEstimate)
  })

  it('caps confidence for 6–11 months of history', () => {
    const f = forecastDemandSeries(series(8, () => 100), AS_OF, 6)
    expect(f.method).toBe('limited_history')
    expect(f.confidence?.score as number).toBeLessThanOrEqual(FORECAST.confidence.capLimitedHistory)
  })

  it('gives no forecast when the latest observation is stale', () => {
    const old = series(12, () => 80).map((p) => ({ ...p, period: addMonths(p.period, -4) }))
    expect(forecastDemandSeries(old, AS_OF, 6)).toMatchObject({ method: 'insufficient_data', reason: 'stale' })
  })

  it('does not fill in missing months', () => {
    const withGaps = series(12, (i) => 100 + i).filter((_, i) => i % 2 === 0) // 6 of 12 months observed
    const f = forecastDemandSeries(withGaps, addMonths(AS_OF, -1), 6)
    expect(f.components?.monthsUsed).toBe(6)
    expect(f.method).toBe('limited_history')
  })
})

describe('demand trend', () => {
  it('is the annualised slope as a share of the mean', () => {
    // 100, 102, … over 12 months: slope 2 a month, mean 111 → 24 / 111 = 21.6%
    expect(demandTrendPct(series(12, (i) => 100 + 2 * i), AS_OF)).toBeCloseTo(21.6, 1)
    expect(demandTrendPct(series(12, () => 70), AS_OF)).toBe(0)
  })

  it('is not reported with fewer than 6 months', () => {
    expect(demandTrendPct(series(5, (i) => 10 + i), AS_OF)).toBeNull()
  })
})

describe('supply forecast', () => {
  const years = (seats: number[]) => seats.map((allocatedSeats, i) => ({ year: 2026 - (seats.length - 1) + i, allocatedSeats }))

  it('holds flat capacity flat and prorates it to the horizon', () => {
    const rows = years([800, 800, 800, 800])
    expect(forecastSupply(rows, 2026, 12)).toMatchObject({ predictedSupply: 800, method: 'capacity_trend', yearlyChange: 0, currentAnnualCapacity: 800 })
    expect(forecastSupply(rows, 2026, 6).predictedSupply).toBe(400)
    expect(forecastSupply(rows, 2026, 3).predictedSupply).toBe(200)
  })

  it('projects capacity along the average of the last two yearly changes', () => {
    // changes: +100, +60 → average +80 → next year 1,080
    const f = forecastSupply(years([840, 940, 1000]), 2026, 12)
    expect(f.yearlyChange).toBe(80)
    expect(f.projectedAnnualCapacity).toBe(1080)
    expect(f.predictedSupply).toBe(1080)
    // 6 months: (1000 + 80 × 0.5) × 0.5 = 520
    expect(forecastSupply(years([840, 940, 1000]), 2026, 6).predictedSupply).toBe(520)
  })

  it('holds a single year flat and says so', () => {
    expect(forecastSupply(years([180]), 2026, 12)).toMatchObject({ predictedSupply: 180, method: 'flat_single_year' })
  })

  it('gives no forecast without capacity data or when it is out of date', () => {
    expect(forecastSupply([], 2026, 12)).toMatchObject({ predictedSupply: null, method: 'insufficient_data' })
    expect(forecastSupply([{ year: 2023, allocatedSeats: 500 }], 2026, 12)).toMatchObject({ predictedSupply: null, method: 'insufficient_data' })
  })

  it('never projects negative capacity', () => {
    expect(forecastSupply(years([900, 400, 50]), 2026, 12).predictedSupply).toBe(0)
  })
})
