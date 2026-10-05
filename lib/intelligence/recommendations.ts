import { GAP_THRESHOLDS, RECOMMENDATIONS } from '@/lib/config/methodology'
import type { ActionCode, EvidenceItem, HorizonResult, Recommendation, RecommendationEffect } from '@/lib/domain/types'
import { isOversupply, isShortage } from './gap'

export interface RecommendationInputs {
  key: string
  districtId: string
  sectorId: string
  tradeId: string
  planning: HorizonResult
  demandTrendPct: number | null
  capacityChangePct: number | null
  utilizationPct: number | null
  completionRatePct: number | null
  placementRatePct: number | null
  priorityScore: number | null
  /** True when a demand source lost a material share of its volume on the way in. */
  demandDataDoubtful: boolean
  /** Allocated seats and enrolment in the latest cycle, for the "fill seats first" effect. */
  seats?: number | null
  enrolled?: number | null
}

/**
 * What the proposed action would change, from the same forecast and seats the
 * gap was computed from. Not a second model: plain arithmetic on the gap.
 *
 *   add seats      the fewest extra seats that bring gap % under the shortage threshold
 *   release seats  the fewest seats to redirect that bring gap % above the oversupply threshold
 *   fill seats     allocated seats nobody is enrolled in
 */
export function expectedEffect(action: ActionCode, planning: HorizonResult, seats: number | null, enrolled: number | null): RecommendationEffect | null {
  const { demand, supply } = planning
  if (action === 'fill_seats_first') {
    if (seats === null || enrolled === null || seats <= enrolled) return null
    return { kind: 'fill_seats', seats: seats - enrolled, resultingGapPct: null }
  }
  if (demand === null || supply === null) return null
  // The gap after the change, cut (not rounded) to two decimals: the seat count is the smallest that works, so the
  // result sits just inside the threshold, and rounding 14.996 up to 15.00 would print a figure the rule itself calls a shortage.
  const after = (newSupply: number): number | null => (newSupply > 0 ? Math.trunc(((demand - newSupply) / newSupply) * 10000) / 100 : null)
  if (action === 'increase_capacity') {
    // gap % < shortage threshold  ⇔  supply > demand ÷ (1 + threshold)
    const needed = Math.floor(demand / (1 + GAP_THRESHOLDS.shortage / 100)) + 1
    const add = Math.max(1, needed - supply)
    return { kind: 'add_seats', seats: add, resultingGapPct: after(supply + add) }
  }
  if (action === 'review_allocation' || action === 'reduce_or_redirect') {
    // gap % > oversupply threshold  ⇔  supply < demand ÷ (1 + threshold), the threshold being negative.
    // With no demand forecast at all, every seat is spare and there is no percentage to quote.
    const most = Math.max(0, Math.ceil(demand / (1 + GAP_THRESHOLDS.oversupply / 100)) - 1)
    const release = Math.min(supply, Math.max(1, supply - most))
    return { kind: 'release_seats', seats: release, resultingGapPct: after(supply - release) }
  }
  return null
}

/**
 * Planner recommendation for one district–trade cell.
 * The action is chosen by rule from the calculated gap and training outcomes,
 * and every recommendation lists the figures it was derived from.
 */
export function recommend(input: RecommendationInputs, params: typeof RECOMMENDATIONS = RECOMMENDATIONS): Recommendation {
  const { planning } = input
  const status = planning.gap.status
  let action: ActionCode
  let secondary: Recommendation['secondary'] = null

  if (status === 'insufficient_data') {
    action = 'collect_data'
  } else if (isShortage(status)) {
    action = input.utilizationPct !== null && input.utilizationPct < params.lowUtilizationPct ? 'fill_seats_first' : 'increase_capacity'
    const weakCompletion = input.completionRatePct !== null && input.completionRatePct < params.lowCompletionPct
    const weakPlacement = input.placementRatePct !== null && input.placementRatePct < params.lowPlacementPct
    if (weakCompletion || weakPlacement) secondary = 'review_quality'
  } else if (status === 'severe_oversupply') {
    action = 'reduce_or_redirect'
  } else if (isOversupply(status)) {
    action = 'review_allocation'
  } else {
    action = 'maintain'
  }

  const evidence: EvidenceItem[] = [
    { key: 'ev.forecastDemand', value: planning.demand, unit: 'persons' },
    { key: 'ev.forecastSupply', value: planning.supply, unit: 'seats' },
    { key: 'ev.gap', value: planning.gap.gap, unit: 'persons' },
    { key: 'ev.gapPct', value: planning.gap.gapPercentage, unit: 'pct' },
    { key: 'ev.status', value: status, unit: 'status' },
    { key: 'ev.demandTrend', value: input.demandTrendPct, unit: 'pct' },
    { key: 'ev.capacityChange', value: input.capacityChangePct, unit: 'pct' },
    { key: 'ev.utilization', value: input.utilizationPct, unit: 'pct' },
    { key: 'ev.completionRate', value: input.completionRatePct, unit: 'pct' },
    { key: 'ev.placementRate', value: input.placementRatePct, unit: 'pct' },
    { key: 'ev.confidence', value: planning.confidence?.score ?? null, unit: 'score' },
  ]

  return {
    id: `rec:${input.key}`,
    districtId: input.districtId,
    sectorId: input.sectorId,
    tradeId: input.tradeId,
    action,
    secondary,
    // Missing demand makes a pair look oversupplied; cutting seats on that basis would be the costly mistake.
    caution: input.demandDataDoubtful && isOversupply(status) ? 'verify_demand_data' : null,
    // Low confidence, or an interval that reaches another side of the balanced band: watch before reallocating.
    tentative: (planning.firm === false || planning.confidence?.label === 'low') && (isShortage(status) || isOversupply(status)),
    confidence: planning.confidence,
    effect: expectedEffect(action, planning, input.seats ?? null, input.enrolled ?? null),
    params: {
      gap: planning.gap.gap,
      gapPct: planning.gap.gapPercentage,
      months: planning.months,
      reason: planning.gap.note,
      utilizationPct: input.utilizationPct === null ? null : Math.round(input.utilizationPct),
    },
    evidence,
    priorityScore: input.priorityScore,
    status,
  }
}
