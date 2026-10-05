import { ALERTS, METHODOLOGY, PRIORITY } from '@/lib/config/methodology'
import type { CellAnalysis, HorizonKey, IngestionRun, Snapshot, Warning, WarningType } from '@/lib/domain/types'
import { aggregateCells, combineHalfWidths, type GroupAnalysis } from '@/lib/intelligence/aggregate'
import { OVERSUPPLY_WARNINGS, SHORTAGE_WARNINGS } from '@/lib/intelligence/alerts'
import { HORIZON_KEYS } from '@/lib/intelligence/engine'
import { isOversupply, isShortage, matchesStatus } from '@/lib/intelligence/gap'
import { recentWindow } from '@/lib/intelligence/forecast'
import { monthIndex, round, sum } from '@/lib/intelligence/math'
import { SOURCE_SPECS } from '@/lib/ingest/sources'
import { TRADE_ALIASES } from '@/lib/intelligence/normalization/mappings'
import { MATCHING } from '@/lib/intelligence/normalization/normalize'
import { can, type GeoScope } from './access'
import { filterCells, type Filters } from './filters'
import type { Session } from './session'
import { dataMode } from './snapshot'

/**
 * View models: the shapes the API returns. Everything here is selected or
 * summed from the snapshot; nothing is calculated differently per screen.
 */

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const
/** How many rows the dashboard lists. Display limits only; they change no figure. */
const RADAR_PAIRS = 6
const SIGNAL_PAIRS = 3
const RANKED_TRADES = 5
const EXPLAIN_ROWS = 8
const HISTORY_MONTHS = 24

/* --------------------------------- Rows ----------------------------------- */

export function cellRow(c: CellAnalysis, horizon: HorizonKey) {
  const h = c.horizons[horizon]
  return {
    key: c.key,
    stateId: c.stateId,
    districtId: c.districtId,
    sectorId: c.sectorId,
    tradeId: c.tradeId,
    horizon,
    demand: h.demand,
    demandLower: h.demandLower,
    demandUpper: h.demandUpper,
    supply: h.supply,
    gap: h.gap.gap,
    gapPercentage: h.gap.gapPercentage,
    status: h.gap.status,
    firm: h.firm,
    note: h.gap.note,
    method: h.method,
    confidence: h.confidence,
    priorityScore: c.priority.score,
    priorityBand: c.priority.band,
    demandIndex: c.demand.index.value,
    supplyIndex: c.supply.index.value,
    demandTrendPct: c.demand.trendPct,
    capacityChangePct: c.supply.capacityChangePct,
    warnings: c.warnings.map((w) => w.type),
  }
}
export type CellRow = ReturnType<typeof cellRow>

function groupRow(group: GroupAnalysis, horizon: HorizonKey) {
  const h = group.horizons[horizon]
  return {
    cells: group.cellCount,
    cellsIncluded: h.cellsIncluded,
    cellsExcluded: h.cellsExcluded,
    demand: h.demand,
    supply: h.supply,
    /** Net figures: shortages and surpluses cancel here. Never used to classify a group. */
    gap: h.netGap,
    gapPercentage: h.netGapPercentage,
    headline: h.headline,
    shortageTotal: h.shortageTotal,
    surplusTotal: h.surplusTotal,
    balancedNet: h.balancedNet,
    shortagePairs: h.shortagePairs,
    oversupplyPairs: h.oversupplyPairs,
    firmShortagePairs: h.firmShortagePairs,
    firmShortageTotal: h.firmShortageTotal,
    firmOversupplyPairs: h.firmOversupplyPairs,
    firmSurplusTotal: h.firmSurplusTotal,
    statusCounts: h.statusCounts,
    confidence: h.confidence,
    /** Score and band of the highest-priority pair in the group, and where it is. */
    priorityScore: group.priority.peak?.score ?? null,
    priorityBand: group.priority.peak?.band ?? null,
    priorityPeak: group.priority.peakKey ? { districtId: group.priority.peakDistrictId as string, tradeId: group.priority.peakTradeId as string } : null,
    highPriorityPairs: group.priority.highPairs,
    demandIndex: group.demandIndex.value,
    supplyIndex: group.supplyIndex.value,
    demandTrendPct: group.demandTrendPct,
    capacityChangePct: group.capacityChangePct,
  }
}
export type GroupRow = ReturnType<typeof groupRow>

/** Ranking of groups by severity: most high-priority pairs, then highest pair score, then most seats short. */
const bySeverity = (a: GroupRow, b: GroupRow) =>
  b.highPriorityPairs - a.highPriorityPairs || (b.priorityScore ?? -1) - (a.priorityScore ?? -1) || b.shortageTotal - a.shortageTotal

const byPriority = (a: { priorityScore: number | null }, b: { priorityScore: number | null }) => (b.priorityScore ?? -1) - (a.priorityScore ?? -1)
/**
 * Largest mismatch first. A shortage against zero seats has no percentage and
 * goes to the top; a pair with no gap at all (insufficient data) goes last.
 */
function bySizeOfGap(a: { gap: number | null; gapPercentage: number | null }, b: { gap: number | null; gapPercentage: number | null }) {
  const rank = (r: { gap: number | null; gapPercentage: number | null }) => (r.gap === null ? -1 : r.gapPercentage === null ? Number.POSITIVE_INFINITY : Math.abs(r.gapPercentage))
  return rank(b) - rank(a) || Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)
}
/** Warnings as a role may see them: the finding for everyone, the suggested action only with planner advice. */
const warningsFor = <W extends Warning>(warnings: W[], session: Session): W[] =>
  can(session, 'recommendations') ? warnings : warnings.map((w) => ({ ...w, recommendedAction: null }))
/** Data-quality signal with source names and the thresholds it was judged against. */
function qualityView(snapshot: Snapshot) {
  const name = new Map(snapshot.dataset.dataSources.map((s) => [s.id, s.name]))
  return {
    flagged: snapshot.dataQuality.flagged,
    minVolumeSharePct: METHODOLOGY.dataQuality.minVolumeSharePct,
    largeRejectSharePct: METHODOLOGY.dataQuality.largeRejectSharePct,
    sources: snapshot.dataQuality.sources.map((s) => ({ ...s, name: name.get(s.sourceId) ?? s.sourceId })),
  }
}
const hasAny = (c: CellAnalysis, types: WarningType[]) => c.warnings.some((w) => types.includes(w.type))

function horizonInfo(snapshot: Snapshot, cells: CellAnalysis[], horizon: HorizonKey) {
  const sample = cells[0]?.horizons[horizon] ?? snapshot.cells[0]?.horizons[horizon]
  return { key: horizon, months: sample?.months ?? 12, periodStart: sample?.periodStart ?? null, periodEnd: sample?.periodEnd ?? null }
}

/* --------------------------------- Meta ----------------------------------- */

export function metaView(snapshot: Snapshot, session: Session, scope: GeoScope) {
  const d = snapshot.dataset
  const districts = d.districts.filter(
    (x) => (!scope.stateId || x.stateId === scope.stateId) && (!scope.districtId || x.id === scope.districtId) && (!scope.districtIds || scope.districtIds.has(x.id)),
  )
  const visible = filterCells(snapshot, { stateId: scope.stateId, districtId: scope.districtId, sectorId: null, tradeId: null, districtIds: scope.districtIds })
  const cellIndex = visible.map((c) => ({ districtId: c.districtId, stateId: c.stateId, sectorId: c.sectorId, tradeId: c.tradeId }))
  return {
    dataset: { ...snapshot.meta, mode: dataMode(), methodologyVersion: snapshot.methodologyVersion },
    session: {
      name: session.name, email: session.email, role: session.role, demo: session.demo,
      stateId: scope.stateId, districtId: scope.districtId,
      permissions: { recommendations: can(session, 'recommendations'), export: can(session, 'view'), ingest: can(session, 'ingest') },
    },
    options: {
      states: d.states.filter((s) => districts.some((x) => x.stateId === s.id)),
      districts,
      sectors: d.sectors,
      trades: d.trades,
      /** Which district–trade pairs exist, so the UI can cascade its filters. */
      cells: cellIndex,
    },
  }
}

/* ------------------------------- Dashboard -------------------------------- */

export function summaryView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  const group = aggregateCells(cells, snapshot.calibration)
  const h = group.horizons[f.horizon]
  const row = (c: CellAnalysis) => cellRow(c, f.horizon)
  const byGap = (a: CellRow, b: CellRow) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)
  const highPriority = cells.filter((c) => c.priority.band === 'high')
  const radar = cells
    .filter((c) => c.horizons[f.horizon].gap.gap !== null && c.demand.trendPct !== null && c.supply.capacityChangePct !== null)
    .sort((a, b) => Math.abs(b.horizons[f.horizon].gap.gap as number) - Math.abs(a.horizons[f.horizon].gap.gap as number))
    .slice(0, RADAR_PAIRS)
  const included = cells.filter((c) => c.horizons[f.horizon].demand !== null && c.horizons[f.horizon].supply !== null)
  return {
    horizon: horizonInfo(snapshot, cells, f.horizon),
    totals: {
      demand: h.demand, supply: h.supply, gap: h.netGap, gapPercentage: h.netGapPercentage, headline: h.headline,
      shortageTotal: h.shortageTotal, surplusTotal: h.surplusTotal, balancedNet: h.balancedNet,
      shortagePairs: h.shortagePairs, oversupplyPairs: h.oversupplyPairs,
      firmShortagePairs: h.firmShortagePairs, firmShortageTotal: h.firmShortageTotal, firmOversupplyPairs: h.firmOversupplyPairs, firmSurplusTotal: h.firmSurplusTotal,
      cells: cells.length, cellsIncluded: h.cellsIncluded, cellsExcluded: h.cellsExcluded,
    },
    statusCounts: h.statusCounts,
    counts: {
      highPriorityTrades: new Set(highPriority.map((c) => c.tradeId)).size,
      highPriorityCells: highPriority.length,
      emergingShortages: cells.filter((c) => hasAny(c, SHORTAGE_WARNINGS)).length,
      emergingOversupply: cells.filter((c) => hasAny(c, OVERSUPPLY_WARNINGS)).length,
      warnings: sum(cells.map((c) => c.warnings.length)),
    },
    /**
     * What each headline number on the dashboard is made of: the pairs behind
     * it, largest first. The client shows these when a figure is opened.
     */
    explain: {
      listLimit: EXPLAIN_ROWS,
      demand: included.map(row).sort((a, b) => (b.demand ?? 0) - (a.demand ?? 0)).slice(0, EXPLAIN_ROWS),
      supply: included.map(row).sort((a, b) => (b.supply ?? 0) - (a.supply ?? 0)).slice(0, EXPLAIN_ROWS),
      shortage: included.filter((c) => isShortage(c.horizons[f.horizon].gap.status)).map(row).sort(byGap).slice(0, EXPLAIN_ROWS),
      surplus: included.filter((c) => isOversupply(c.horizons[f.horizon].gap.status)).map(row).sort(byGap).slice(0, EXPLAIN_ROWS),
      highPriority: highPriority.map(row).sort(byPriority).slice(0, EXPLAIN_ROWS),
      emergingShortages: cells.filter((c) => hasAny(c, SHORTAGE_WARNINGS)).map(row).sort(byPriority).slice(0, EXPLAIN_ROWS),
      emergingOversupply: cells.filter((c) => hasAny(c, OVERSUPPLY_WARNINGS)).map(row).sort(byPriority).slice(0, EXPLAIN_ROWS),
      excluded: cells.filter((c) => !included.includes(c)).map(row),
    },
    priorityBands: PRIORITY.bands,
    /** How much of each count source's volume reached the dataset; `flagged` when demand may be understated. */
    dataQuality: qualityView(snapshot),
    signals: cells.map(row).filter((r) => r.priorityScore !== null).sort(byPriority).slice(0, SIGNAL_PAIRS),
    radar: radar.map(row),
    planningHorizon: PRIORITY.planningHorizon,
  }
}

/* ------------------------------- Drill-down ------------------------------- */

type Level = 'state' | 'district' | 'sector' | 'trade'

export function drilldownView(snapshot: Snapshot, f: Filters, scope: GeoScope) {
  const d = snapshot.dataset
  const cal = snapshot.calibration
  const cells = filterCells(snapshot, f)
  // The next level is the first dimension that is not yet fixed by a filter.
  const level: Level | 'cell' = !f.stateId ? 'state' : !f.districtId ? 'district' : !f.sectorId ? 'sector' : !f.tradeId ? 'trade' : 'cell'
  const keyOf: Record<Level, (c: CellAnalysis) => string> = {
    state: (c) => c.stateId, district: (c) => c.districtId, sector: (c) => c.sectorId, trade: (c) => c.tradeId,
  }
  const children =
    level === 'cell'
      ? []
      : [...new Set(cells.map(keyOf[level]))]
          .map((id) => ({ id, level, ...groupRow(aggregateCells(cells.filter((c) => keyOf[level](c) === id), cal), f.horizon) }))
          .sort(bySeverity)

  // Map: the states this session may see. The district filter is left out so the
  // rest of a planner's own area stays visible, but the session's scope is not:
  // a state or district planner gets figures for their own area only.
  const mapCells = filterCells(snapshot, { stateId: scope.stateId, districtId: scope.districtId, sectorId: f.sectorId, tradeId: f.tradeId, districtIds: scope.districtIds })
  const states = d.states
    .filter((state) => !scope.stateId || state.id === scope.stateId)
    .map((state) => ({ stateId: state.id, ...groupRow(aggregateCells(mapCells.filter((c) => c.stateId === state.id), cal), f.horizon) }))
    .filter((state) => state.cells > 0)

  const trades = [...new Set(cells.map((c) => c.tradeId))]
    .map((id) => ({ tradeId: id, sectorId: d.trades.find((t) => t.id === id)?.sectorId ?? '', ...groupRow(aggregateCells(cells.filter((c) => c.tradeId === id), cal), f.horizon) }))
    .sort(bySeverity)

  return {
    horizon: horizonInfo(snapshot, cells, f.horizon),
    level,
    path: { stateId: f.stateId, districtId: f.districtId, sectorId: f.sectorId, tradeId: f.tradeId },
    /** Set when the map covers less than whole states because of the session's scope. */
    mapScope: { stateId: scope.stateId, districtId: scope.districtId },
    total: groupRow(aggregateCells(cells, cal), f.horizon),
    children,
    states,
    ranking: trades.slice(0, RANKED_TRADES),
    leaf: level === 'cell' ? cells.map((c) => cellRow(c, f.horizon)) : [],
  }
}

/* ---------------------------------- Gaps ---------------------------------- */

export function gapsView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  const rows = cells
    .filter((c) => matchesStatus(c.horizons[f.horizon].gap.status, f.status))
    .map((c) => {
      const forecastKey = f.horizon === 'current' ? null : f.horizon
      const demandForecast = forecastKey ? c.demandForecasts[forecastKey] : null
      const supplyForecast = forecastKey ? c.supplyForecasts[forecastKey] : null
      return {
        ...cellRow(c, f.horizon),
        explain: {
          demandParts: demandForecast?.parts ?? null,
          monthlyRunRate: c.demand.monthlyRunRate,
          currentAnnualCapacity: c.supply.seats,
          projectedAnnualCapacity: supplyForecast?.projectedAnnualCapacity ?? c.supply.seats,
          yearlyChange: supplyForecast?.yearlyChange ?? null,
          supplyMethod: supplyForecast?.method ?? null,
          latestTrainingYear: c.supply.latestYear,
        },
      }
    })
    .sort(bySizeOfGap)
  return {
    horizon: horizonInfo(snapshot, cells, f.horizon),
    total: groupRow(aggregateCells(cells, snapshot.calibration), f.horizon),
    thresholds: METHODOLOGY.gapThresholds,
    rows,
  }
}

/* ----------------------------- Demand / supply ---------------------------- */

export function demandView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  const group = aggregateCells(cells, snapshot.calibration)
  return {
    weights: METHODOLOGY.demandIndex.weights,
    references: snapshot.references,
    total: { index: group.demandIndex, monthlyRunRate: group.monthlyRunRate, trendPct: group.demandTrendPct, series: group.series },
    rows: cells.map((c) => ({
      key: c.key, stateId: c.stateId, districtId: c.districtId, sectorId: c.sectorId, tradeId: c.tradeId,
      index: c.demand.index, monthlyRunRate: c.demand.monthlyRunRate, trendPct: c.demand.trendPct,
      monthsObserved: c.demand.monthsObserved, source: c.demand.source,
      latest: c.demand.series[c.demand.series.length - 1] ?? null,
    })),
  }
}

export function supplyView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  const group = aggregateCells(cells, snapshot.calibration)
  return {
    weights: METHODOLOGY.supplyIndex.weights,
    references: snapshot.references,
    total: {
      index: group.supplyIndex, seats: group.seats, enrolled: group.enrolled, completed: group.completed, placed: group.placed,
      utilizationPct: group.utilizationPct, completionRatePct: group.completionRatePct, placementRatePct: group.placementRatePct, capacityChangePct: group.capacityChangePct,
    },
    rows: cells.map((c) => ({
      key: c.key, stateId: c.stateId, districtId: c.districtId, sectorId: c.sectorId, tradeId: c.tradeId,
      index: c.supply.index, seats: c.supply.seats, enrolled: c.supply.enrolled, completed: c.supply.completed, placed: c.supply.placed,
      latestYear: c.supply.latestYear, outcomesYear: c.supply.outcomesYear,
      utilizationPct: c.supply.utilizationPct, completionRatePct: c.supply.completionRatePct, placementRatePct: c.supply.placementRatePct,
      capacityChangePct: c.supply.capacityChangePct, years: c.supply.years,
    })),
  }
}

/* -------------------------------- Forecasts ------------------------------- */

function forecastBlock(snapshot: Snapshot, cells: CellAnalysis[], horizon: HorizonKey, group: GroupAnalysis) {
  const key = horizon === 'current' ? null : horizon
  const h = group.horizons[horizon]
  // One rule for everything on the Forecasts screen: a pair counts when it has
  // both a demand and a supply figure for this horizon. The total, the chart,
  // the breakdown and the capacity line all cover exactly these pairs.
  const included = cells.filter((c) => c.horizons[horizon].demand !== null && c.horizons[horizon].supply !== null)
  const rho = key ? snapshot.calibration[key].errorCorrelation : 0
  const months = key ? included[0]?.demandForecasts[key].monthly.length ?? 0 : 0
  const monthly = Array.from({ length: months }, (_, i) => {
    const points = included.map((c) => c.demandForecasts[key as '3M'].monthly[i])
    const value = sum(points.map((p) => p.value))
    const half = combineHalfWidths(points.map((p) => p.upper - p.value), rho)
    return { period: points[0].period, value: round(value, 1), lower: round(Math.max(0, value - half), 1), upper: round(value + half, 1) }
  })
  const historyByMonth = new Map<string, { volume: number; cells: number }>()
  for (const c of included) {
    for (const m of c.demand.series) {
      if (m.volume === null) continue
      const entry = historyByMonth.get(m.period) ?? { volume: 0, cells: 0 }
      entry.volume += m.volume
      entry.cells += 1
      historyByMonth.set(m.period, entry)
    }
  }
  const history = [...historyByMonth.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([period, v]) => ({ period, ...v })).slice(-HISTORY_MONTHS)

  const components = key ? included.map((c) => c.demandForecasts[key].components!) : []
  const parts = key ? included.map((c) => c.demandForecasts[key].parts!) : []
  const partSum = (pick: (p: (typeof parts)[number]) => number) => Math.round(sum(parts.map(pick)))
  const breakdown = key && included.length && h.demand !== null
    ? (() => {
        const baseline = partSum((p) => p.baseline)
        const trend = partSum((p) => p.trend)
        const recentGrowth = partSum((p) => p.recentGrowth)
        const floorAdjustment = partSum((p) => p.floorAdjustment)
        // Each pair's forecast is rounded to whole persons before pairs are added,
        // so the parts can differ from the total by a few persons. Shown, not hidden.
        return { baseline, trend, recentGrowth, floorAdjustment, rounding: h.demand - (baseline + trend + recentGrowth + floorAdjustment), total: h.demand }
      })()
    : null
  const halves = key ? included.map((c) => c.demandForecasts[key].interval!) : []
  // The same whole-person half-widths the group total was combined from.
  const shown = included.map((c) => (c.horizons[horizon].demandUpper ?? 0) - (c.horizons[horizon].demand ?? 0))
  const methods: Record<string, number> = {}
  for (const c of cells) methods[c.horizons[horizon].method] = (methods[c.horizons[horizon].method] ?? 0) + 1
  return {
    horizon: horizonInfo(snapshot, cells, horizon),
    history,
    monthly,
    /** Training capacity of the included pairs per month, for comparison with monthly demand. */
    supplyPerMonth: h.supply === null ? null : round(h.supply / h.months, 1),
    totals: {
      demand: h.demand, lower: h.demandLower, upper: h.demandUpper, supply: h.supply,
      gap: h.netGap, gapPercentage: h.netGapPercentage, headline: h.headline, confidence: h.confidence,
      shortageTotal: h.shortageTotal, surplusTotal: h.surplusTotal, balancedNet: h.balancedNet,
      shortagePairs: h.shortagePairs, oversupplyPairs: h.oversupplyPairs,
      cellsIncluded: h.cellsIncluded, cellsExcluded: h.cellsExcluded,
    },
    components: key && included.length
      ? {
          baseline: round(sum(components.map((c) => c.baseline)), 1),
          trendSlope: round(sum(components.map((c) => c.trendSlope)), 2),
          recentSlope: round(sum(components.map((c) => c.recentSlope)), 2),
          monthsUsed: Math.min(...components.map((c) => c.monthsUsed)),
        }
      : null,
    breakdown,
    /** One pair: what its confidence score rests on. A group's confidence follows from its combined interval instead. */
    confidenceBasis: key && included.length === 1 ? included[0].demandForecasts[key].confidenceBasis : null,
    /** How the interval of the total was built from the pairs' intervals. */
    interval: key && included.length && h.halfWidth !== null
      ? {
          pairs: included.length,
          sumOfModelHalfWidths: round(sum(halves.map((x) => x.modelHalfWidth)), 1),
          calibrationFactor: snapshot.calibration[key].factor,
          errorCorrelation: rho,
          measuredCorrelation: snapshot.calibration[key].measuredCorrelation,
          minCorrelation: METHODOLOGY.group.minErrorCorrelation,
          /** Null when the history is too short for the interval to have been checked forward in time. */
          forwardCheck: (() => {
            const b = snapshot.backtest.find((x) => x.horizon === key)
            return b && b.holdoutCoverage !== null ? { coveragePct: b.holdoutCoverage, samples: b.holdoutSamples } : null
          })(),
          ifIndependent: round(combineHalfWidths(shown, 0), 1),
          ifInStep: round(combineHalfWidths(shown, 1), 1),
          halfWidth: h.halfWidth,
          single: included.length === 1 ? included[0].demandForecasts[key].interval : null,
        }
      : null,
    methods,
    excluded: cells
      .filter((c) => !included.includes(c))
      .map((c) => ({ key: c.key, districtId: c.districtId, tradeId: c.tradeId, note: c.horizons[horizon].gap.note, reason: key ? c.demandForecasts[key].reason : null })),
    byHorizon: HORIZON_KEYS.map((k) => {
      const x = group.horizons[k]
      return { horizon: k, months: x.months, demand: x.demand, lower: x.demandLower, upper: x.demandUpper, supply: x.supply, gap: x.netGap, gapPercentage: x.netGapPercentage, headline: x.headline, confidence: x.confidence }
    }),
    model: { demand: METHODOLOGY.forecast.modelVersion, supply: METHODOLOGY.supplyForecast.modelVersion, coverage: METHODOLOGY.forecast.coverage, confidence: METHODOLOGY.forecast.confidence },
    backtest: snapshot.backtest,
  }
}

export function forecastsView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  return forecastBlock(snapshot, cells, f.horizon, aggregateCells(cells, snapshot.calibration))
}

/* ------------------------ Priority, alerts, actions ----------------------- */

export function priorityView(snapshot: Snapshot, f: Filters, groupBy: 'cell' | 'trade' | 'district') {
  const cells = filterCells(snapshot, f)
  const cal = snapshot.calibration
  const rows =
    groupBy === 'cell'
      ? cells.map((c) => ({ id: c.key, districtId: c.districtId as string | null, tradeId: c.tradeId as string | null, sectorId: c.sectorId as string | null, priority: c.priority, ...groupRow(aggregateCells([c], cal), f.horizon) }))
      : [...new Set(cells.map((c) => (groupBy === 'trade' ? c.tradeId : c.districtId)))].map((id) => {
          const members = cells.filter((c) => (groupBy === 'trade' ? c.tradeId : c.districtId) === id)
          const group = aggregateCells(members, cal)
          return {
            id,
            districtId: groupBy === 'district' ? id : null,
            tradeId: groupBy === 'trade' ? id : null,
            sectorId: groupBy === 'trade' ? members[0].sectorId : null,
            /** Breakdown of the group's highest-priority pair. A group has no blended score of its own. */
            priority: group.priority.peak,
            ...groupRow(group, f.horizon),
          }
        })
  return { weights: PRIORITY.weights, bands: PRIORITY.bands, planningHorizon: PRIORITY.planningHorizon, groupBy, rows: rows.sort(bySeverity) }
}

export function alertsView(snapshot: Snapshot, f: Filters, session: Session) {
  const cells = filterCells(snapshot, f)
  const warnings: (Warning & { stateId: string })[] = cells.flatMap((c) => c.warnings.map((w) => ({ ...w, stateId: c.stateId })))
  warnings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id))
  const counts: Record<string, number> = {}
  for (const w of warnings) counts[w.type] = (counts[w.type] ?? 0) + 1
  return { lookaheadHorizon: ALERTS.lookaheadHorizon, rules: METHODOLOGY.alerts, counts, warnings: warningsFor(warnings, session) }
}

export function recommendationsView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  const sources = evidenceSources(snapshot)
  const items = cells
    .map((c) => ({
      ...c.recommendation,
      stateId: c.stateId,
      warnings: c.warnings,
      priority: c.priority,
      row: cellRow(c, PRIORITY.planningHorizon),
      lookahead: cellRow(c, ALERTS.lookaheadHorizon),
      coverage: { monthsObserved: c.demand.monthsObserved, latestTrainingYear: c.supply.latestYear },
    }))
    .sort((a, b) => Number(a.action === 'maintain') - Number(b.action === 'maintain') || byPriority(a, b))
  return {
    planningHorizon: PRIORITY.planningHorizon,
    actionable: items.filter((i) => i.action !== 'maintain').length,
    items,
    sources,
    dataQuality: qualityView(snapshot),
    freshness: snapshot.meta.updatedAt,
  }
}

function evidenceSources(snapshot: Snapshot) {
  const used = snapshot.dataset.dataSources.filter((s) => s.status !== 'planned')
  return {
    demand: used.filter((s) => s.sourceType === 'demand').map((s) => ({ id: s.id, name: s.name, status: s.status, lastUpdated: s.lastUpdated })),
    supply: used.filter((s) => s.sourceType === 'supply').map((s) => ({ id: s.id, name: s.name, status: s.status, lastUpdated: s.lastUpdated })),
  }
}

/* --------------------------- Trade and district --------------------------- */

export function tradeView(snapshot: Snapshot, tradeId: string, f: Filters, session: Session) {
  const trade = snapshot.dataset.trades.find((t) => t.id === tradeId)
  if (!trade) return null
  const cells = filterCells(snapshot, { ...f, sectorId: null, tradeId })
  const group = aggregateCells(cells, snapshot.calibration)
  const single = cells.length === 1 ? cells[0] : null
  return {
    trade,
    aliases: TRADE_ALIASES[trade.id] ?? [],
    scope: { stateId: f.stateId, districtId: f.districtId, cells: cells.length },
    demand: {
      index: group.demandIndex,
      monthlyRunRate: group.monthlyRunRate,
      trendPct: group.demandTrendPct,
      monthsObserved: single ? single.demand.monthsObserved : null,
      latestMonth: single ? single.demand.series[single.demand.series.length - 1] ?? null : null,
    },
    supply: {
      index: group.supplyIndex,
      seats: group.seats, enrolled: group.enrolled, completed: group.completed, placed: group.placed,
      utilizationPct: group.utilizationPct, completionRatePct: group.completionRatePct, placementRatePct: group.placementRatePct,
      capacityChangePct: group.capacityChangePct,
      latestYear: single?.supply.latestYear ?? snapshot.meta.currentTrainingYear,
      outcomesYear: single?.supply.outcomesYear ?? null,
      years: single ? single.supply.years : [],
    },
    /**
     * One pair: that pair's score. Several pairs: the breakdown of the
     * highest-scoring pair, named in `peak`, plus how many pairs fall in each band.
     */
    priority: {
      result: group.priority.peak,
      peak: single || !group.priority.peakKey ? null : { districtId: group.priority.peakDistrictId as string, tradeId: group.priority.peakTradeId as string },
      highPairs: group.priority.highPairs, mediumPairs: group.priority.mediumPairs, lowPairs: group.priority.lowPairs, unscoredPairs: group.priority.unscoredPairs,
      bands: PRIORITY.bands,
    },
    forecast: forecastBlock(snapshot, cells, f.horizon, group),
    byDistrict: cells.map((c) => cellRow(c, f.horizon)).sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)),
    warnings: warningsFor(cells.flatMap((c) => c.warnings).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]), session),
    /** Null when the session's role does not include planner recommendations. */
    recommendations: can(session, 'recommendations') ? cells.map((c) => c.recommendation).sort(byPriority) : null,
    sources: evidenceSources(snapshot),
    references: snapshot.references,
    recentWindowMonths: METHODOLOGY.demandIndex.smoothingMonths,
    weights: { demand: METHODOLOGY.demandIndex.weights, supply: METHODOLOGY.supplyIndex.weights, priority: PRIORITY.weights },
    freshness: snapshot.meta.updatedAt,
  }
}

export function districtView(snapshot: Snapshot, districtId: string, f: Filters, session: Session) {
  const d = snapshot.dataset
  const district = d.districts.find((x) => x.id === districtId)
  if (!district) return null
  const cal = snapshot.calibration
  const cells = filterCells(snapshot, { stateId: null, districtId, sectorId: f.sectorId, tradeId: f.tradeId, districtIds: f.districtIds })
  const group = aggregateCells(cells, cal)
  const centres = d.trainingCentres.filter((c) => c.districtId === districtId)
  return {
    district,
    state: d.states.find((s) => s.id === district.stateId) ?? null,
    horizon: horizonInfo(snapshot, cells, f.horizon),
    total: groupRow(group, f.horizon),
    priority: group.priority,
    sectors: [...new Set(cells.map((c) => c.sectorId))]
      .map((id) => ({ sectorId: id, ...groupRow(aggregateCells(cells.filter((c) => c.sectorId === id), cal), f.horizon) }))
      .sort(bySeverity),
    trades: cells.map((c) => cellRow(c, f.horizon)).sort(byPriority),
    trainingCentres: { active: centres.filter((c) => c.status === 'active').length, total: centres.length, capacity: sum(centres.filter((c) => c.status === 'active').map((c) => c.capacity)), list: centres },
    warnings: warningsFor(cells.flatMap((c) => c.warnings).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]), session),
  }
}

/* ------------------------------ Load history ------------------------------ */

/**
 * One load, with as much detail as the role should have.
 *   everyone        which source, when, how many rows and how much volume was mapped
 *   planners        also the file name
 *   administrators  also who loaded it and the rejected and loosely matched values,
 *                   which can quote employer names or other text from the file
 */
export function runView(run: IngestionRun, session: Session) {
  const planner = can(session, 'recommendations')
  const admin = can(session, 'ingest')
  return {
    id: run.id, sourceId: run.sourceId, loadedAt: run.loadedAt, mode: run.mode, synthetic: run.synthetic,
    rowsRead: run.rowsRead, rowsMapped: run.rowsMapped, rowsRejected: run.rowsRejected, rowsLooselyMatched: run.rowsLooselyMatched, rowsHeld: run.rowsHeld,
    looseMatches: run.looseMatches, valueRead: run.valueRead, valueMapped: run.valueMapped, periodMin: run.periodMin, periodMax: run.periodMax,
    rejectKinds: run.rejectKinds, looseKinds: run.looseKinds,
    fileName: planner ? run.fileName : null,
    loadedBy: admin ? run.loadedBy : null,
    rejects: admin ? run.rejects : null,
    looseMatchList: admin ? run.looseMatchList : null,
  }
}
export type RunView = ReturnType<typeof runView>

/* -------------------------------- Evidence -------------------------------- */

/**
 * Everything behind one district–trade pair: the stored rows exactly as they
 * are in the database, which load of which file each value came from, which
 * months each calculation used, and every intermediate figure. A reader can
 * redo the arithmetic from this one response.
 */
export function evidenceView(snapshot: Snapshot, districtId: string, tradeId: string, session: Session) {
  const cell = snapshot.cells.find((c) => c.districtId === districtId && c.tradeId === tradeId)
  if (!cell) return null
  const d = snapshot.dataset
  const asOf = monthIndex(snapshot.meta.asOfPeriod)
  const f = METHODOLOGY.forecast
  const stored = d.labourDemand.filter((r) => r.districtId === districtId && r.tradeId === tradeId).sort((a, b) => a.period.localeCompare(b.period))
  const observed = stored
    .map((r) => ({ t: monthIndex(r.period), period: r.period, complete: r.jobPostings !== null && r.employmentRegistrations !== null }))
    .filter((r) => r.complete && r.t <= asOf)
  const inTrend = new Set(observed.filter((r) => r.t > asOf - f.trendWindow).map((r) => r.period))
  const inBaseline = new Set(recentWindow(observed, asOf).map((r) => r.period))
  const runIds = new Set<number>()
  const demandRows = stored.slice(-HISTORY_MONTHS).map((r) => {
    for (const id of Object.values(r.lineage ?? {})) runIds.add(id as number)
    return {
      period: r.period,
      jobPostings: r.jobPostings, employmentRegistrations: r.employmentRegistrations,
      volume: r.jobPostings === null || r.employmentRegistrations === null ? null : r.jobPostings + r.employmentRegistrations,
      hiringSignal: r.hiringSignal, industryDemandSignal: r.industryDemandSignal,
      lineage: r.lineage ?? {},
      usedForBaseline: inBaseline.has(r.period),
      usedForTrend: inTrend.has(r.period),
    }
  })
  const trainingRows = d.trainingCapacity
    .filter((r) => r.districtId === districtId && r.tradeId === tradeId)
    .sort((a, b) => a.year - b.year)
    .map((r) => {
      if (r.runId) runIds.add(r.runId)
      return { year: r.year, allocatedSeats: r.allocatedSeats, enrolled: r.enrolled, completed: r.completed, placed: r.placed, runId: r.runId ?? null }
    })
  const sourceName = new Map(d.dataSources.map((s) => [s.id, s]))
  const planning = cell.demandForecasts[PRIORITY.planningHorizon]
  return {
    key: cell.key,
    stateId: cell.stateId, districtId, sectorId: cell.sectorId, tradeId,
    asOfPeriod: snapshot.meta.asOfPeriod,
    demandRows,
    trainingRows,
    /** Which source feeds which demand signal. */
    signals: SOURCE_SPECS.filter((s) => s.kind === 'demand').map((s) => ({
      metric: (s as Extract<typeof s, { kind: 'demand' }>).metric, sourceId: s.id,
      sourceName: sourceName.get(s.id)?.name ?? s.id, status: sourceName.get(s.id)?.status ?? 'planned',
    })),
    runs: d.ingestionRuns
      .filter((r) => runIds.has(r.id))
      .map((r) => ({ ...runView(r, session), sourceName: sourceName.get(r.sourceId)?.name ?? r.sourceId })),
    windows: { recentMonths: f.baselineWindow, trendMonths: f.trendWindow, staleAfterMonths: f.staleAfterMonths },
    forecast: {
      horizon: PRIORITY.planningHorizon, method: planning.method, reason: planning.reason,
      components: planning.components, parts: planning.parts, interval: planning.interval,
      predictedDemand: planning.predictedDemand, lowerBound: planning.lowerBound, upperBound: planning.upperBound, confidence: planning.confidence,
      weights: { trend: f.trendWeight, recentGrowth: round(1 - f.trendWeight, 2), damping: f.growthDamping, extrapolationUncertainty: f.extrapolationUncertainty, coverage: f.coverage },
    },
    supplyForecast: cell.supplyForecasts[PRIORITY.planningHorizon],
    gap: cell.horizons[PRIORITY.planningHorizon].gap,
    thresholds: METHODOLOGY.gapThresholds,
    priority: cell.priority,
    warnings: warningsFor(cell.warnings, session),
  }
}

/* -------------------------- Methodology, sources -------------------------- */

export function methodologyView(snapshot: Snapshot) {
  const d = snapshot.dataset
  const months = new Set(d.labourDemand.map((r) => r.period))
  return {
    methodology: METHODOLOGY,
    /** Matching thresholds used when a file is loaded. */
    matching: MATCHING,
    /** What the loaded dataset covers, counted from it. */
    coverage: { states: d.states.length, districts: d.districts.length, sectors: d.sectors.length, trades: d.trades.length, pairs: snapshot.cells.length, months: months.size },
    references: snapshot.references,
    backtest: snapshot.backtest,
    calibration: snapshot.calibration,
    dataQuality: qualityView(snapshot),
    dataset: snapshot.meta,
  }
}

/** How a source's data gets into the system. Nothing here is a live connection, and nothing is described as one. */
const integrationOf = (status: string): 'file_load' | 'code_table' | 'planned' =>
  status === 'planned' ? 'planned' : status === 'prototype_reference' ? 'code_table' : 'file_load'

export function sourcesView(snapshot: Snapshot, session: Session) {
  const latest = new Map<string, Snapshot['dataset']['ingestionRuns'][number]>()
  for (const run of snapshot.dataset.ingestionRuns) if (!latest.has(run.sourceId) || run.id > (latest.get(run.sourceId)?.id ?? 0)) latest.set(run.sourceId, run)
  const quality = qualityView(snapshot)
  const read = sum(quality.sources.map((s) => s.rowsRead))
  const mapped = sum(quality.sources.map((s) => s.rowsMapped))
  return {
    dataset: snapshot.meta,
    mode: dataMode(),
    /** Sources with a live connection. There are none: every loaded source is a file. */
    connected: 0,
    /** Records over every load still in the dataset: read, accepted, refused, and the share accepted. */
    quality: { ...quality, recordsProcessed: read, recordsValid: mapped, recordsRejected: read - mapped, completenessPct: read ? round((mapped / read) * 100, 1) : null },
    sources: snapshot.dataset.dataSources.map((source) => ({
      ...source,
      integration: integrationOf(source.status),
      latestRun: latest.has(source.id) ? runView(latest.get(source.id) as IngestionRun, session) : null,
    })),
  }
}
