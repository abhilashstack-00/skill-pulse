import { SUPPLY_INDEX } from '@/lib/config/methodology'
import type { IndexResult } from '@/lib/domain/types'
import { weightedIndex } from './demand-index'
import { clamp, scaleCount } from './math'

/** Raw supply figures. These are kept as-is; the index is derived alongside them. */
export interface SupplyRaw {
  /** Seats allocated in the latest training cycle. */
  seats: number | null
  /** Candidates enrolled in the latest cycle. */
  enrolled: number | null
  /** Enrolled, completed and placed for the latest cycle with outcomes. */
  outcomesEnrolled: number | null
  completed: number | null
  placed: number | null
}

export interface SupplyRates {
  utilizationPct: number | null
  completionRatePct: number | null
  placementRatePct: number | null
}

const rate = (numerator: number | null, denominator: number | null): number | null =>
  numerator === null || denominator === null || denominator <= 0 ? null : clamp((numerator / denominator) * 100, 0, 100)

export function supplyRates(raw: SupplyRaw): SupplyRates {
  return {
    utilizationPct: rate(raw.enrolled, raw.seats),
    completionRatePct: rate(raw.completed, raw.outcomesEnrolled),
    placementRatePct: rate(raw.placed, raw.completed),
  }
}

/**
 * Supply Index = 0.40 × seats (scaled) + 0.25 × enrolment utilisation
 *              + 0.20 × completion rate + 0.15 × placement rate.
 * Null when any component is missing.
 */
export function computeSupplyIndex(raw: SupplyRaw, seatsReference: number, weights: Record<keyof typeof SUPPLY_INDEX.weights, number> = SUPPLY_INDEX.weights): IndexResult {
  const rates = supplyRates(raw)
  const normalized = {
    seats: raw.seats === null ? null : scaleCount(raw.seats, seatsReference),
    utilization: rates.utilizationPct,
    completion: rates.completionRatePct,
    placement: rates.placementRatePct,
  }
  const rawValues = { seats: raw.seats, utilization: raw.enrolled, completion: raw.completed, placement: raw.placed }
  return weightedIndex(normalized, weights, rawValues, { seats: seatsReference })
}
