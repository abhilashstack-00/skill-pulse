/** Small numeric helpers shared by the engines. Pure and deterministic. */

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
export const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : NaN)
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

export function round(x: number, decimals = 0): number {
  const f = 10 ** decimals
  return Math.round((x + Number.EPSILON) * f) / f
}

/** Percentile with linear interpolation between ranks (p in 0–100). */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  const rank = (clamp(p, 0, 100) / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

export function median(xs: number[]): number {
  return percentile(xs, 50)
}

export function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1))
}

export interface LinearFit {
  slope: number
  intercept: number
  /** Standard deviation of the residuals (n − 2 degrees of freedom). */
  residualStd: number
  /** Standard error of the slope. */
  slopeStdErr: number
  meanX: number
  meanY: number
}

/** Ordinary least squares fit of y on x. Needs at least 2 distinct x values. */
export function linearFit(xs: number[], ys: number[]): LinearFit {
  const n = xs.length
  const meanX = mean(xs)
  const meanY = mean(ys)
  const sxx = sum(xs.map((x) => (x - meanX) ** 2))
  if (n < 2 || sxx === 0) return { slope: 0, intercept: meanY, residualStd: 0, slopeStdErr: 0, meanX, meanY }
  const sxy = sum(xs.map((x, i) => (x - meanX) * (ys[i] - meanY)))
  const slope = sxy / sxx
  const intercept = meanY - slope * meanX
  const sse = sum(xs.map((x, i) => (ys[i] - (intercept + slope * x)) ** 2))
  const residualStd = n > 2 ? Math.sqrt(sse / (n - 2)) : 0
  return { slope, intercept, residualStd, slopeStdErr: residualStd / Math.sqrt(sxx), meanX, meanY }
}

/**
 * Scale a count to 0–100 on a log scale against a reference value:
 * 100 × ln(1 + x) / ln(1 + reference), capped at 100.
 * A tenfold difference in counts is therefore not a tenfold difference in score.
 */
export function scaleCount(value: number, reference: number): number {
  if (!(reference > 0) || !(value > 0)) return 0
  return clamp((100 * Math.log1p(value)) / Math.log1p(reference), 0, 100)
}

/* ------------------------------ Month helpers ----------------------------- */

/** 'YYYY-MM' → months since year 0, so months can be subtracted. */
export function monthIndex(period: string): number {
  const [y, m] = period.split('-').map(Number)
  return y * 12 + (m - 1)
}

export function periodFromIndex(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function addMonths(period: string, months: number): string {
  return periodFromIndex(monthIndex(period) + months)
}
