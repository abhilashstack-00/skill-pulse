import { RECOMMENDATIONS } from '@/lib/config/methodology'
import type { ActionCode, EvidenceItem, HorizonResult, Recommendation } from '@/lib/domain/types'
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
