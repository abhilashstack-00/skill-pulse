import { PRIORITY } from '@/lib/config/methodology'
import type { GapResult, PriorityComponent, PriorityResult } from '@/lib/domain/types'
import { clamp, round } from './math'

export interface PriorityInputs {
  gap: GapResult
  /** Annualised demand trend, %. */
  demandTrendPct: number | null
  /** Normalised employment-registration component of the Demand Index, 0–100. */
  employmentSignal: number | null
  /** Enrolment utilisation of allocated seats, %. */
  utilizationPct: number | null
  /** Forecast confidence score, 0–100. */
  confidenceScore: number | null
}

/**
 * Priority Score = 0.35 gap severity + 0.25 demand growth + 0.15 employment
 * signal + 0.15 capacity pressure + 0.10 forecast confidence, each on 0–100.
 *
 * Components are measured in the direction of the gap, so the same score
 * ranks shortages (rising demand, full seats) and oversupply (falling demand,
 * empty seats). A prototype decision-support score, not an official ranking.
 * Returns null when any input is missing. A pair forecast to be balanced is
 * never placed in the high band, whatever its score.
 */
export function computePriority(input: PriorityInputs, params: typeof PRIORITY = PRIORITY): PriorityResult {
  const { gap } = input
  const w = params.weights
  const gapPct = gap.gapPercentage
  const zeroSupply = gap.note === 'zero_supply' && gap.status === 'severe_shortage'
  const direction: PriorityResult['direction'] = (gapPct ?? (zeroSupply ? 1 : 0)) >= 0 ? 'shortage' : 'oversupply'
  const sign = direction === 'shortage' ? 1 : -1
  const towardGap = (value: number | null) => (value === null ? null : direction === 'shortage' ? value : 100 - value)

  const values: Record<PriorityComponent['key'], { raw: number | null; value: number | null }> = {
    gapSeverity: {
      raw: gapPct,
      value: zeroSupply ? 100 : gapPct === null ? null : clamp((Math.abs(gapPct) / params.gapSaturationPct) * 100, 0, 100),
    },
    demandGrowth: {
      raw: input.demandTrendPct,
      value: input.demandTrendPct === null ? null : clamp(((sign * input.demandTrendPct) / params.growthSaturationPct) * 100, 0, 100),
    },
    employmentSignal: { raw: input.employmentSignal, value: towardGap(input.employmentSignal) },
    capacityPressure: { raw: input.utilizationPct, value: towardGap(input.utilizationPct) },
    forecastConfidence: { raw: input.confidenceScore, value: input.confidenceScore },
  }

  const components: PriorityComponent[] = (Object.keys(w) as PriorityComponent['key'][]).map((key) => {
    const { raw, value } = values[key]
    return {
      key,
      weight: w[key],
      raw: raw === null ? null : round(raw, 1),
      value: value === null ? null : round(value, 1),
      contribution: value === null ? null : round(w[key] * value, 2),
    }
  })
  const missing = components.filter((c) => c.value === null).map((c) => c.key)
  if (missing.length) return { score: null, band: null, cappedBy: null, direction, components, missing }

  const score = round(components.reduce((total, c) => total + c.weight * (values[c.key].value as number), 0), 1)
  const byScore = score >= params.bands.high ? 'high' : score >= params.bands.medium ? 'medium' : 'low'
  // Fast growth and full seats can lift a balanced pair's score, but there is no mismatch to act on yet.
  const capped = gap.status === 'balanced' && byScore === 'high'
  return { score, band: capped ? params.balancedBandCap : byScore, cappedBy: capped ? 'balanced' : null, direction, components, missing }
}
