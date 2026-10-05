import { GAP_THRESHOLDS } from '@/lib/config/methodology'
import type { GapResult, GapStatus, StatusFilter } from '@/lib/domain/types'
import { round } from './math'

export type GapThresholds = { severeShortage: number; shortage: number; oversupply: number; severeOversupply: number }

/** Classify a gap percentage with the prototype, configurable thresholds. */
export function classifyGap(gapPercentage: number, t: GapThresholds = GAP_THRESHOLDS): Exclude<GapStatus, 'insufficient_data'> {
  if (gapPercentage >= t.severeShortage) return 'severe_shortage'
  if (gapPercentage >= t.shortage) return 'shortage'
  if (gapPercentage <= t.severeOversupply) return 'severe_oversupply'
  if (gapPercentage <= t.oversupply) return 'oversupply'
  return 'balanced'
}

/**
 * Gap = demand − supply; Gap % = (demand − supply) / supply × 100.
 * Missing inputs give "insufficient data" rather than a number.
 */
export function computeGap(demand: number | null, supply: number | null, thresholds: GapThresholds = GAP_THRESHOLDS): GapResult {
  if (demand === null) return { demand, supply, gap: null, gapPercentage: null, status: 'insufficient_data', note: 'no_demand_forecast' }
  if (supply === null) return { demand, supply, gap: null, gapPercentage: null, status: 'insufficient_data', note: 'no_supply_data' }
  const gap = demand - supply
  if (supply === 0) {
    // A percentage of zero supply is undefined. Demand with no capacity at all
    // is the most acute shortage there is; no demand and no capacity is balanced.
    return { demand, supply, gap, gapPercentage: null, status: demand > 0 ? 'severe_shortage' : 'balanced', note: 'zero_supply' }
  }
  const gapPercentage = (gap / supply) * 100
  return { demand, supply, gap, gapPercentage: round(gapPercentage, 2), status: classifyGap(gapPercentage, thresholds), note: null }
}

/** Position of a status on the oversupply → shortage axis. */
export const STATUS_RANK: Record<GapStatus, number> = {
  severe_oversupply: -2,
  oversupply: -1,
  balanced: 0,
  shortage: 1,
  severe_shortage: 2,
  insufficient_data: 0,
}

export const isShortage = (s: GapStatus) => s === 'shortage' || s === 'severe_shortage'
export const isOversupply = (s: GapStatus) => s === 'oversupply' || s === 'severe_oversupply'

export function matchesStatus(status: GapStatus, filter: StatusFilter | null): boolean {
  if (!filter) return true
  if (filter === 'any_shortage') return isShortage(status)
  if (filter === 'any_oversupply') return isOversupply(status)
  return status === filter
}
