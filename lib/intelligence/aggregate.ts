import { DEMAND_INDEX, FORECAST, PRIORITY, SUPPLY_INDEX } from '@/lib/config/methodology'
import type { CellAnalysis, Confidence, GapResult, GapStatus, HorizonKey, IndexResult, PriorityResult } from '@/lib/domain/types'
import { HORIZON_KEYS } from './engine'
import { demandTrendPct } from './forecast'
import { computeGap } from './gap'
import { round, sum } from './math'
import { computePriority } from './priority'

export interface GroupHorizon {
  horizon: HorizonKey
  months: number
  periodStart: string | null
  periodEnd: string | null
  demand: number | null
  demandLower: number | null
  demandUpper: number | null
  supply: number | null
  gap: GapResult
  confidence: Confidence | null
  /** Cells with both a demand and a supply figure, which the totals cover. */
  cellsIncluded: number
  /** Cells left out because demand or supply is missing. */
  cellsExcluded: number
  statusCounts: Record<GapStatus, number>
  /** Sum of positive gaps and of negative gaps across included cells. */
  shortageTotal: number
  surplusTotal: number
}

export interface GroupAnalysis {
  cellCount: number
  horizons: Record<HorizonKey, GroupHorizon>
  demandIndex: IndexResult & { cellsIncluded: number }
  supplyIndex: IndexResult & { cellsIncluded: number }
  monthlyRunRate: number | null
  demandTrendPct: number | null
  /** Monthly demand summed over cells; `cells` says how many reported that month. */
  series: { period: string; volume: number; cells: number }[]
  seats: number | null
  enrolled: number | null
  completed: number | null
  placed: number | null
  utilizationPct: number | null
  completionRatePct: number | null
  placementRatePct: number | null
  capacityChangePct: number | null
  priority: PriorityResult
}

const emptyCounts = (): Record<GapStatus, number> => ({
  severe_shortage: 0, shortage: 0, balanced: 0, oversupply: 0, severe_oversupply: 0, insufficient_data: 0,
})

const pct = (numerator: number, denominator: number): number | null => (denominator > 0 ? round((numerator / denominator) * 100, 1) : null)

/** Weighted mean of cell indices; component values are weighted the same way, so they still add up. */
function aggregateIndex(
  cells: CellAnalysis[],
  pick: (c: CellAnalysis) => IndexResult,
  weightOf: (c: CellAnalysis) => number | null,
  weights: Record<string, number>,
  additive: string[],
): IndexResult & { cellsIncluded: number } {
  const usable = cells.filter((c) => pick(c).value !== null && (weightOf(c) ?? 0) > 0)
  const keys = Object.keys(weights)
  if (!usable.length) {
    return {
      value: null,
      components: keys.map((key) => ({ key, weight: weights[key], raw: null, reference: null, normalized: null, contribution: null })),
      missing: keys,
      cellsIncluded: 0,
    }
  }
  if (usable.length === 1) return { ...pick(usable[0]), cellsIncluded: 1 }
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
    return { key, weight: weights[key], raw: raw === null ? null : round(raw, 1), reference: parts[0].comp.reference, normalized: round(normalized, 1), contribution: round(weights[key] * normalized, 2) }
  })
  const value = sum(usable.map((c) => ((weightOf(c) as number) / totalWeight) * (pick(c).value as number)))
  return { value: round(value, 1), components, missing: [], cellsIncluded: usable.length }
}

/**
 * Combine district–trade cells into one view (a district, a state, a sector,
 * the whole pilot). Totals are plain sums of cell values, so any level of the
 * hierarchy adds up to the level above it.
 */
export function aggregateCells(cells: CellAnalysis[]): GroupAnalysis {
  const horizons = {} as Record<HorizonKey, GroupHorizon>
  for (const key of HORIZON_KEYS) {
    const included = cells.filter((c) => c.horizons[key].demand !== null && c.horizons[key].supply !== null)
    const statusCounts = emptyCounts()
    for (const c of cells) statusCounts[c.horizons[key].gap.status] += 1
    const demand = included.length ? sum(included.map((c) => c.horizons[key].demand as number)) : null
    const supply = included.length ? sum(included.map((c) => c.horizons[key].supply as number)) : null
    // Interval of a sum of independent forecasts: half-widths add in quadrature.
    const halves = included.map((c) => {
      const h = c.horizons[key]
      return h.demandUpper === null || h.demand === null ? null : h.demandUpper - h.demand
    })
    const half = halves.length && halves.every((h) => h !== null) ? Math.sqrt(sum((halves as number[]).map((h) => h ** 2))) : null
    const scored = included.filter((c) => c.horizons[key].confidence !== null && (c.horizons[key].demand as number) > 0)
    const scoreWeight = sum(scored.map((c) => c.horizons[key].demand as number))
    const score = scored.length && scoreWeight > 0
      ? Math.round(sum(scored.map((c) => (c.horizons[key].confidence as Confidence).score * (c.horizons[key].demand as number))) / scoreWeight)
      : null
    const gaps = included.map((c) => c.horizons[key].gap.gap as number)
    const first = cells[0]?.horizons[key]
    horizons[key] = {
      horizon: key,
      months: first?.months ?? (key === '3M' ? 3 : key === '6M' ? 6 : 12),
      periodStart: first?.periodStart ?? null,
      periodEnd: first?.periodEnd ?? null,
      demand,
      demandLower: demand === null || half === null ? null : Math.max(0, Math.round(demand - half)),
      demandUpper: demand === null || half === null ? null : Math.round(demand + half),
      supply,
      gap: computeGap(demand, supply),
      confidence: score === null ? null : { score, label: score >= FORECAST.confidence.high ? 'high' : score >= FORECAST.confidence.medium ? 'medium' : 'low' },
      cellsIncluded: included.length,
      cellsExcluded: cells.length - included.length,
      statusCounts,
      shortageTotal: sum(gaps.filter((g) => g > 0)),
      surplusTotal: sum(gaps.filter((g) => g < 0)),
    }
  }

  // Monthly series: sum of the cells that reported each month.
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

  // Trend of the group: only cells with a trend of their own, so cells that
  // start reporting part-way through do not look like growth.
  const trended = cells.filter((c) => c.demand.trendPct !== null)
  const trendMonths = new Map<string, number>()
  for (const c of trended) for (const m of c.demand.series) if (m.volume !== null) trendMonths.set(m.period, (trendMonths.get(m.period) ?? 0) + m.volume)
  const asOf = series.length ? series[series.length - 1].period : null
  const groupTrend = asOf && trended.length
    ? demandTrendPct([...trendMonths.entries()].map(([period, value]) => ({ period, value })), asOf)
    : null

  const withSeats = cells.filter((c) => c.supply.seats !== null)
  const withEnrolment = withSeats.filter((c) => c.supply.enrolled !== null)
  const withOutcomes = cells.filter((c) => c.supply.completed !== null)
  const withPlacement = withOutcomes.filter((c) => c.supply.placed !== null)
  // Capacity change: same cells in both cycles, so new cells do not look like growth.
  const previousSeats = (c: CellAnalysis) => c.supply.years.find((y) => y.year === (c.supply.latestYear as number) - 1)?.allocatedSeats ?? null
  const withPrevious = withSeats.filter((c) => previousSeats(c) !== null)
  const seatsNow = sum(withPrevious.map((c) => c.supply.seats as number))
  const seatsBefore = sum(withPrevious.map((c) => previousSeats(c) as number))
  const outcomeEnrolled = sum(withOutcomes.map((c) => c.supply.years.find((y) => y.year === c.supply.outcomesYear)?.enrolled ?? 0))

  const demandIndex = aggregateIndex(cells, (c) => c.demand.index, (c) => c.demand.monthlyRunRate, DEMAND_INDEX.weights, ['jobPostings', 'employmentRegistrations'])
  const supplyIndex = aggregateIndex(cells, (c) => c.supply.index, (c) => c.supply.seats, SUPPLY_INDEX.weights, ['seats', 'utilization', 'completion', 'placement'])
  const utilizationPct = withEnrolment.length ? pct(sum(withEnrolment.map((c) => c.supply.enrolled as number)), sum(withEnrolment.map((c) => c.supply.seats as number))) : null
  const planning = horizons[PRIORITY.planningHorizon]
  const runRates = cells.map((c) => c.demand.monthlyRunRate).filter((v): v is number => v !== null)

  return {
    cellCount: cells.length,
    horizons,
    demandIndex,
    supplyIndex,
    monthlyRunRate: runRates.length ? round(sum(runRates), 1) : null,
    demandTrendPct: groupTrend,
    series,
    seats: withSeats.length ? sum(withSeats.map((c) => c.supply.seats as number)) : null,
    enrolled: withEnrolment.length ? sum(withEnrolment.map((c) => c.supply.enrolled as number)) : null,
    completed: withOutcomes.length ? sum(withOutcomes.map((c) => c.supply.completed as number)) : null,
    placed: withPlacement.length ? sum(withPlacement.map((c) => c.supply.placed as number)) : null,
    utilizationPct,
    completionRatePct: withOutcomes.length ? pct(sum(withOutcomes.map((c) => c.supply.completed as number)), outcomeEnrolled) : null,
    placementRatePct: withPlacement.length ? pct(sum(withPlacement.map((c) => c.supply.placed as number)), sum(withPlacement.map((c) => c.supply.completed as number))) : null,
    capacityChangePct: seatsBefore > 0 ? round(((seatsNow - seatsBefore) / seatsBefore) * 100, 1) : null,
    priority:
      cells.length === 1
        ? cells[0].priority
        : computePriority({
            gap: planning.gap,
            demandTrendPct: groupTrend,
            employmentSignal: demandIndex.components.find((c) => c.key === 'employmentRegistrations')?.normalized ?? null,
            utilizationPct,
            confidenceScore: planning.confidence?.score ?? null,
          }),
  }
}
