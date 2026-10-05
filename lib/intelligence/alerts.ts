import { ALERTS, GAP_THRESHOLDS } from '@/lib/config/methodology'
import type { EvidenceItem, GapStatus, HorizonResult, Severity, Warning, WarningType } from '@/lib/domain/types'
import { isOversupply, isShortage, STATUS_RANK } from './gap'

export interface AlertInputs {
  key: string
  districtId: string
  sectorId: string
  tradeId: string
  current: HorizonResult
  lookahead: HorizonResult
  planning: HorizonResult
  demandTrendPct: number | null
  capacityChangePct: number | null
}

/**
 * Early-warning rules. Each rule is a plain condition over calculated values,
 * and each warning carries the evidence that triggered it.
 */
export function evaluateWarnings(input: AlertInputs, params: typeof ALERTS = ALERTS): Warning[] {
  const { current, lookahead, planning, demandTrendPct: trend, capacityChangePct: capacity } = input
  const now = current.gap.status
  const soon = lookahead.gap.status
  const known = (s: GapStatus) => s !== 'insufficient_data'
  const warnings: Warning[] = []

  const baseEvidence: EvidenceItem[] = [
    { key: 'ev.currentStatus', value: now, unit: 'status' },
    { key: 'ev.currentGapPct', value: current.gap.gapPercentage, unit: 'pct' },
    { key: 'ev.lookaheadStatus', value: soon, unit: 'status' },
    { key: 'ev.lookaheadGapPct', value: lookahead.gap.gapPercentage, unit: 'pct' },
    { key: 'ev.lookaheadDemand', value: lookahead.demand, unit: 'persons' },
    { key: 'ev.lookaheadSupply', value: lookahead.supply, unit: 'seats' },
  ]
  const trendEvidence: EvidenceItem[] = [
    { key: 'ev.demandTrend', value: trend, unit: 'pct' },
    { key: 'ev.capacityChange', value: capacity, unit: 'pct' },
    { key: 'ev.planningGapPct', value: planning.gap.gapPercentage, unit: 'pct' },
  ]

  const add = (type: WarningType, severity: Severity, action: string, evidence: EvidenceItem[], variant = '') =>
    warnings.push({
      id: `${type}:${input.key}`,
      type,
      severity,
      districtId: input.districtId,
      sectorId: input.sectorId,
      tradeId: input.tradeId,
      reason: `warning.${type}.reason${variant}`,
      recommendedAction: action,
      params: {
        currentStatus: now,
        currentGapPct: current.gap.gapPercentage,
        lookaheadStatus: soon,
        lookaheadGapPct: lookahead.gap.gapPercentage,
        demandTrendPct: trend,
        capacityChangePct: capacity,
        lookaheadMonths: lookahead.months,
      },
      evidence,
    })

  // Acute shortage: already a severe shortage at the current rate of demand.
  if (now === 'severe_shortage') add('acute_shortage', 'critical', 'warning.action.expandNow', baseEvidence)

  // Upcoming shortage: the forecast moves the cell into (or deeper into) shortage.
  // A pair already short is not "about to" run short: the wording says it gets worse.
  const alreadyShort = known(now) && isShortage(now)
  const capacityAction = alreadyShort ? 'warning.action.planCapacityWidening' : 'warning.action.planCapacity'
  if (known(soon) && isShortage(soon) && STATUS_RANK[soon] > STATUS_RANK[now]) {
    add('upcoming_shortage', soon === 'severe_shortage' ? 'high' : 'medium', capacityAction, baseEvidence, alreadyShort ? '.deepening' : '')
  }

  // Emerging shortage: demand rising rapidly while training capacity stays flat.
  if (trend !== null && capacity !== null && trend >= params.rapidDemandGrowthPct && capacity <= params.flatCapacityPct && (planning.gap.gap ?? 0) > 0) {
    add('emerging_shortage', trend >= 2 * params.rapidDemandGrowthPct ? 'high' : 'medium', capacityAction, trendEvidence)
  }

  // Saturation: already a severe oversupply.
  if (now === 'severe_oversupply') add('saturation', 'high', 'warning.action.reviewSeats', baseEvidence)

  // Upcoming saturation: the forecast moves the cell into (or deeper into) oversupply.
  if (known(soon) && isOversupply(soon) && STATUS_RANK[soon] < STATUS_RANK[now]) {
    add('upcoming_saturation', soon === 'severe_oversupply' ? 'high' : 'medium', 'warning.action.reviewSeats', baseEvidence, known(now) && isOversupply(now) ? '.deepening' : '')
  }

  // Oversupply risk: capacity growing while demand declines.
  if (trend !== null && capacity !== null && capacity >= params.capacityGrowthPct && trend <= params.demandDeclinePct) {
    add('oversupply_risk', 'medium', 'warning.action.reviewSeats', trendEvidence)
  }

  // Monitor: demand and supply approaching parity, or a balanced cell near a threshold.
  const lookaheadPct = lookahead.gap.gapPercentage
  const closing = known(now) && now !== 'balanced' && soon === 'balanced'
  const nearEdge =
    now === 'balanced' && soon === 'balanced' && lookaheadPct !== null && Math.abs(lookaheadPct) >= GAP_THRESHOLDS.shortage - params.monitorMarginPct
  if (closing || nearEdge) add('monitor', 'low', 'warning.action.monitor', baseEvidence)

  return warnings
}

export const SHORTAGE_WARNINGS: WarningType[] = ['upcoming_shortage', 'emerging_shortage']
export const OVERSUPPLY_WARNINGS: WarningType[] = ['upcoming_saturation', 'oversupply_risk']
