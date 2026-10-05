import { DEMAND_INDEX, GROUP, SUPPLY_INDEX } from '@/lib/config/methodology'
import type { CellAnalysis, Confidence, GapStatus, GroupHeadline, HorizonKey, IndexResult, PriorityResult, Snapshot } from '@/lib/domain/types'
import { HORIZON_KEYS } from './engine'
import { confidenceFrom, demandTrendPct } from './forecast'
import { isOversupply, isShortage } from './gap'
import { round, sum } from './math'

/**
 * Group figures: how a set of district–trade pairs (a district, a state, a
 * sector, the whole pilot) is summarised.
 *
 * A group is NOT classified by its net gap. A state with 400 seats short in one
 * trade and 400 spare in another is not "balanced": the spare seats do not
 * train the missing people. So a group reports
 *   - totals, which are plain sums of its pairs;
 *   - the net gap, labelled as net;
 *   - seats short (in its shortage pairs) and seats spare (in its oversupply
 *     pairs) separately, with how many pairs are in each class;
 *   - a headline taken from those two gross figures, never from the net.
 * A group of exactly one pair is that pair: same status, same priority, same
 * confidence.
 */

export interface GroupHorizon {
  horizon: HorizonKey
  months: number
  periodStart: string | null
  periodEnd: string | null
  demand: number | null
  demandLower: number | null
  demandUpper: number | null
  supply: number | null
  /** demand − supply over the included pairs. Shortages and surpluses cancel in this figure. */
  netGap: number | null
  netGapPercentage: number | null
  /** The pair's own status for a single pair; otherwise which side of the mismatch dominates. */
  headline: GroupHeadline
  confidence: Confidence | null
  /** Half-width of the interval of the summed forecast. */
  halfWidth: number | null
  /** Pairs with both a demand and a supply figure, which the totals cover. */
  cellsIncluded: number
  /** Pairs left out because demand or supply is missing. */
  cellsExcluded: number
  statusCounts: Record<GapStatus, number>
  shortagePairs: number
  oversupplyPairs: number
  /** Seats short, summed over pairs classified shortage or severe shortage (≥ 0). */
  shortageTotal: number
  /** Seats spare, summed over pairs classified oversupply or severe oversupply (≤ 0). */
  surplusTotal: number
  /** Net gap of the pairs classified balanced. shortageTotal + surplusTotal + balancedNet = netGap. */
  balancedNet: number
  /** The part of the above that is firm: pairs still short (or spare) at both ends of their demand interval. */
  firmShortagePairs: number
  firmShortageTotal: number
  firmOversupplyPairs: number
  firmSurplusTotal: number
}

export interface GroupPriority {
  /** The highest-scoring pair in the group; its full breakdown is in `peak`. */
  peak: PriorityResult | null
  peakKey: string | null
  peakDistrictId: string | null
  peakTradeId: string | null
  highPairs: number
  mediumPairs: number
  lowPairs: number
  /** Pairs with no score because an input is missing. */
  unscoredPairs: number
}

export type GroupIndex = IndexResult & {
  cellsIncluded: number
  /** True when the value is a weighted average of several pairs' indices rather than one pair's index. */
  averaged: boolean
}

export interface GroupAnalysis {
  cellCount: number
  horizons: Record<HorizonKey, GroupHorizon>
  demandIndex: GroupIndex
  supplyIndex: GroupIndex
  monthlyRunRate: number | null
  demandTrendPct: number | null
  /** Monthly demand summed over pairs; `cells` says how many reported that month. */
  series: { period: string; volume: number; cells: number }[]
  seats: number | null
  enrolled: number | null
  completed: number | null
  placed: number | null
  utilizationPct: number | null
  completionRatePct: number | null
  placementRatePct: number | null
  capacityChangePct: number | null
  priority: GroupPriority
}

const emptyCounts = (): Record<GapStatus, number> => ({
  severe_shortage: 0, shortage: 0, balanced: 0, oversupply: 0, severe_oversupply: 0, insufficient_data: 0,
})

const pct = (numerator: number, denominator: number): number | null => (denominator > 0 ? round((numerator / denominator) * 100, 1) : null)

/**
 * Half-width of the interval of a sum of forecasts whose errors have pairwise
 * correlation ρ:  √( (1 − ρ)·Σh² + ρ·(Σh)² ).
 * ρ = 0 is the independent case (quadrature); ρ = 1 adds the half-widths.
 */
export function combineHalfWidths(halves: number[], rho: number): number {
  const squares = sum(halves.map((h) => h * h))
  return Math.sqrt(Math.max(0, (1 - rho) * squares + rho * sum(halves) ** 2))
}

/**
 * Headline of a group, from seats short and seats spare against the group's
 * supply. Never from the net gap.
 *   no pair outside the balanced band        balanced
 *   neither side material                    largely balanced
 *   one side material                        mostly shortage / mostly oversupply
 *   both sides material                      mixed
 * "Material" is GROUP.materialSharePct of the group's supply.
 */
export function groupHeadline(shortageTotal: number, surplusTotal: number, supply: number | null, pairs: { classified: number; outside: number }): GroupHeadline {
  if (pairs.classified === 0) return 'insufficient_data'
  if (pairs.outside === 0) return 'balanced'
  const threshold = ((supply ?? 0) * GROUP.materialSharePct) / 100
  const short = shortageTotal >= threshold && shortageTotal > 0
  const spare = Math.abs(surplusTotal) >= threshold && surplusTotal < 0
  if (short && spare) return 'mixed'
  if (short) return 'mostly_shortage'
  if (spare) return 'mostly_oversupply'
  return 'largely_balanced'
}

/**
 * Index of a group: the average of its pairs' indices, weighted by each pair's
 * size (monthly demand, or seats). Component scores are averaged the same way,
 * so weight × score still adds up to the value. Raw counts are totals and are
 * shown for scale only: a group's score is not its total scaled against the
 * reference, which is why `reference` is empty here.
 */
function aggregateIndex(
  cells: CellAnalysis[],
  pick: (c: CellAnalysis) => IndexResult,
  weightOf: (c: CellAnalysis) => number | null,
  weights: Record<string, number>,
  additive: string[],
): GroupIndex {
  const usable = cells.filter((c) => pick(c).value !== null && (weightOf(c) ?? 0) > 0)
  const keys = Object.keys(weights)
  if (!usable.length) {
    return {
      value: null,
      components: keys.map((key) => ({ key, weight: weights[key], raw: null, reference: null, normalized: null, contribution: null })),
      missing: keys,
      cellsIncluded: 0,
      averaged: false,
    }
  }
  if (usable.length === 1) return { ...pick(usable[0]), cellsIncluded: 1, averaged: false }
  const totalWeight = sum(usable.map((c) => weightOf(c) as number))
  const components = keys.map((key) => {
    const parts = usable.map((c) => ({ w: (weightOf(c) as number) / totalWeight, comp: pick(c).components.find((x) => x.key === key)! }))
    const normalized = sum(parts.map((p) => p.w * (p.comp.normalized as number)))
    const raws = parts.map((p) => p.comp.raw)
    const raw = raws.some((r) => r === null)
      ? null
      : additive.includes(key)
        ? sum(raws as number[])
        : sum(parts.map((p) => p.w * (p.comp.raw as number)))
    return { key, weight: weights[key], raw: raw === null ? null : round(raw, 1), reference: null, normalized: round(normalized, 1), contribution: round(weights[key] * normalized, 2) }
  })
  const value = sum(usable.map((c) => ((weightOf(c) as number) / totalWeight) * (pick(c).value as number)))
  return { value: round(value, 1), components, missing: [], cellsIncluded: usable.length, averaged: true }
}

function groupPriority(cells: CellAnalysis[]): GroupPriority {
  const scored = cells.filter((c) => c.priority.score !== null)
  // Highest score first; the key breaks ties so the choice is always the same.
  const top = [...scored].sort((a, b) => (b.priority.score as number) - (a.priority.score as number) || a.key.localeCompare(b.key))[0] ?? null
  return {
    peak: top?.priority ?? null,
    peakKey: top?.key ?? null,
    peakDistrictId: top?.districtId ?? null,
    peakTradeId: top?.tradeId ?? null,
    highPairs: scored.filter((c) => c.priority.band === 'high').length,
    mediumPairs: scored.filter((c) => c.priority.band === 'medium').length,
    lowPairs: scored.filter((c) => c.priority.band === 'low').length,
    unscoredPairs: cells.length - scored.length,
  }
}

/**
 * Combine district–trade pairs into one view. Totals are plain sums of pair
 * values, so any level of the hierarchy adds up to the level above it.
 */
export function aggregateCells(cells: CellAnalysis[], calibration: Snapshot['calibration']): GroupAnalysis {
  const horizons = {} as Record<HorizonKey, GroupHorizon>
  for (const key of HORIZON_KEYS) {
    const included = cells.filter((c) => c.horizons[key].demand !== null && c.horizons[key].supply !== null)
    const statusCounts = emptyCounts()
    for (const c of cells) statusCounts[c.horizons[key].gap.status] += 1
    const demand = included.length ? sum(included.map((c) => c.horizons[key].demand as number)) : null
    const supply = included.length ? sum(included.map((c) => c.horizons[key].supply as number)) : null

    const halves = included.map((c) => {
      const h = c.horizons[key]
      return h.demandUpper === null || h.demand === null ? null : h.demandUpper - h.demand
    })
    const rho = key === 'current' ? 0 : calibration[key].errorCorrelation
    const half = halves.length && halves.every((h) => h !== null) ? combineHalfWidths(halves as number[], rho) : null

    const shortage = included.filter((c) => isShortage(c.horizons[key].gap.status))
    const oversupply = included.filter((c) => isOversupply(c.horizons[key].gap.status))
    const balanced = included.filter((c) => c.horizons[key].gap.status === 'balanced')
    const gapOf = (c: CellAnalysis) => c.horizons[key].gap.gap ?? 0
    const shortageTotal = sum(shortage.map(gapOf))
    const surplusTotal = sum(oversupply.map(gapOf))
    const classified = cells.length - statusCounts.insufficient_data
    const single = cells.length === 1 ? cells[0].horizons[key] : null
    const netGap = demand === null || supply === null ? null : demand - supply

    const first = cells[0]?.horizons[key]
    horizons[key] = {
      horizon: key,
      months: first?.months ?? 12,
      periodStart: first?.periodStart ?? null,
      periodEnd: first?.periodEnd ?? null,
      demand,
      // One pair: its own bounds, exactly. (Rebuilding them from a rounded half-width can differ by one person.)
      demandLower: single ? single.demandLower : demand === null || half === null ? null : Math.max(0, Math.round(demand - half)),
      demandUpper: single ? single.demandUpper : demand === null || half === null ? null : Math.round(demand + half),
      supply,
      netGap,
      netGapPercentage: netGap === null || !supply ? null : round((netGap / supply) * 100, 2),
      headline: single ? single.gap.status : groupHeadline(shortageTotal, surplusTotal, supply, { classified, outside: statusCounts.severe_shortage + statusCounts.shortage + statusCounts.oversupply + statusCounts.severe_oversupply }),
      // One pair keeps its own confidence (with its short-history cap). A group's follows from its interval,
      // capped like a short-history pair when most of its demand comes from pairs forecast without the full method.
      confidence: single ? single.confidence : demand === null || half === null || demand <= 0 ? null
        : confidenceFrom(demand, half, sum(included.filter((c) => c.horizons[key].method !== 'full').map((c) => c.horizons[key].demand as number)) > GROUP.shortHistoryShare * demand && key !== 'current' ? 'limited_history' : 'full'),
      halfWidth: half === null ? null : round(half, 1),
      cellsIncluded: included.length,
      cellsExcluded: cells.length - included.length,
      statusCounts,
      shortagePairs: shortage.length,
      oversupplyPairs: oversupply.length,
      shortageTotal,
      surplusTotal,
      balancedNet: sum(balanced.map(gapOf)),
      firmShortagePairs: shortage.filter((c) => c.horizons[key].firm === true).length,
      firmShortageTotal: sum(shortage.filter((c) => c.horizons[key].firm === true).map(gapOf)),
      firmOversupplyPairs: oversupply.filter((c) => c.horizons[key].firm === true).length,
      firmSurplusTotal: sum(oversupply.filter((c) => c.horizons[key].firm === true).map(gapOf)),
    }
  }

  // Monthly series: sum of the pairs that reported each month.
  const byMonth = new Map<string, { volume: number; cells: number }>()
  for (const c of cells) {
    for (const m of c.demand.series) {
      if (m.volume === null) continue
      const entry = byMonth.get(m.period) ?? { volume: 0, cells: 0 }
      entry.volume += m.volume
      entry.cells += 1
      byMonth.set(m.period, entry)
    }
  }
  const series = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, ...v }))

  // Trend of the group: only pairs with a trend of their own, so pairs that
  // start reporting part-way through do not look like growth.
  const trended = cells.filter((c) => c.demand.trendPct !== null)
  const trendMonths = new Map<string, number>()
  for (const c of trended) for (const m of c.demand.series) if (m.volume !== null) trendMonths.set(m.period, (trendMonths.get(m.period) ?? 0) + m.volume)
  const asOf = series.length ? series[series.length - 1].period : null
  const groupTrend = cells.length === 1
    ? cells[0].demand.trendPct
    : asOf && trended.length
      ? demandTrendPct([...trendMonths.entries()].map(([period, value]) => ({ period, value })), asOf)
      : null

  const withSeats = cells.filter((c) => c.supply.seats !== null)
  const withEnrolment = withSeats.filter((c) => c.supply.enrolled !== null)
  const withOutcomes = cells.filter((c) => c.supply.completed !== null)
  const withPlacement = withOutcomes.filter((c) => c.supply.placed !== null)
  // Capacity change: same pairs in both cycles, so new pairs do not look like growth.
  const previousSeats = (c: CellAnalysis) => c.supply.years.find((y) => y.year === (c.supply.latestYear as number) - 1)?.allocatedSeats ?? null
  const withPrevious = withSeats.filter((c) => previousSeats(c) !== null)
  const seatsNow = sum(withPrevious.map((c) => c.supply.seats as number))
  const seatsBefore = sum(withPrevious.map((c) => previousSeats(c) as number))
  const outcomeEnrolled = sum(withOutcomes.map((c) => c.supply.years.find((y) => y.year === c.supply.outcomesYear)?.enrolled ?? 0))
  const runRates = cells.map((c) => c.demand.monthlyRunRate).filter((v): v is number => v !== null)

  return {
    cellCount: cells.length,
    horizons,
    demandIndex: aggregateIndex(cells, (c) => c.demand.index, (c) => c.demand.monthlyRunRate, DEMAND_INDEX.weights, ['jobPostings', 'employmentRegistrations']),
    supplyIndex: aggregateIndex(cells, (c) => c.supply.index, (c) => c.supply.seats, SUPPLY_INDEX.weights, ['seats']),
    monthlyRunRate: runRates.length ? round(sum(runRates), 1) : null,
    demandTrendPct: groupTrend,
    series,
    seats: withSeats.length ? sum(withSeats.map((c) => c.supply.seats as number)) : null,
    enrolled: withEnrolment.length ? sum(withEnrolment.map((c) => c.supply.enrolled as number)) : null,
    completed: withOutcomes.length ? sum(withOutcomes.map((c) => c.supply.completed as number)) : null,
    placed: withPlacement.length ? sum(withPlacement.map((c) => c.supply.placed as number)) : null,
    utilizationPct: withEnrolment.length ? pct(sum(withEnrolment.map((c) => c.supply.enrolled as number)), sum(withEnrolment.map((c) => c.supply.seats as number))) : null,
    completionRatePct: withOutcomes.length ? pct(sum(withOutcomes.map((c) => c.supply.completed as number)), outcomeEnrolled) : null,
    placementRatePct: withPlacement.length ? pct(sum(withPlacement.map((c) => c.supply.placed as number)), sum(withPlacement.map((c) => c.supply.completed as number))) : null,
    capacityChangePct: cells.length === 1 ? cells[0].supply.capacityChangePct : seatsBefore > 0 ? round(((seatsNow - seatsBefore) / seatsBefore) * 100, 1) : null,
    priority: groupPriority(cells),
  }
}
