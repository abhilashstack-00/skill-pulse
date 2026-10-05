import { ALERTS, METHODOLOGY, PRIORITY } from '@/lib/config/methodology'
import type { CellAnalysis, GapStatus, HorizonKey, Snapshot, Warning, WarningType } from '@/lib/domain/types'
import { aggregateCells, type GroupAnalysis } from '@/lib/intelligence/aggregate'
import { OVERSUPPLY_WARNINGS, SHORTAGE_WARNINGS } from '@/lib/intelligence/alerts'
import { matchesStatus } from '@/lib/intelligence/gap'
import { round, sum } from '@/lib/intelligence/math'
import { TRADE_ALIASES } from '@/lib/intelligence/normalization/mappings'
import { can, type GeoScope } from './access'
import { filterCells, type Filters } from './filters'
import type { Session } from './session'
import { dataMode } from './snapshot'

/**
 * View models: the shapes the API returns. Everything here is selected or
 * summed from the snapshot; nothing is calculated differently per screen.
 */

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const

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
    gap: h.gap.gap,
    gapPercentage: h.gap.gapPercentage,
    status: h.gap.status,
    shortageTotal: h.shortageTotal,
    surplusTotal: h.surplusTotal,
    statusCounts: h.statusCounts,
    priorityScore: group.priority.score,
    priorityBand: group.priority.band,
    demandIndex: group.demandIndex.value,
    supplyIndex: group.supplyIndex.value,
    demandTrendPct: group.demandTrendPct,
    capacityChangePct: group.capacityChangePct,
  }
}

const byPriority = (a: { priorityScore: number | null }, b: { priorityScore: number | null }) => (b.priorityScore ?? -1) - (a.priorityScore ?? -1)
const hasAny = (c: CellAnalysis, types: WarningType[]) => c.warnings.some((w) => types.includes(w.type))

function horizonInfo(snapshot: Snapshot, cells: CellAnalysis[], horizon: HorizonKey) {
  const sample = cells[0]?.horizons[horizon] ?? snapshot.cells[0]?.horizons[horizon]
  return { key: horizon, months: sample?.months ?? 12, periodStart: sample?.periodStart ?? null, periodEnd: sample?.periodEnd ?? null }
}

/* --------------------------------- Meta ----------------------------------- */

export function metaView(snapshot: Snapshot, session: Session, scope: GeoScope) {
  const d = snapshot.dataset
  const districts = d.districts.filter((x) => (!scope.stateId || x.stateId === scope.stateId) && (!scope.districtId || x.id === scope.districtId))
  const visible = filterCells(snapshot, { stateId: scope.stateId, districtId: scope.districtId, sectorId: null, tradeId: null })
  const cellIndex = visible.map((c) => ({ districtId: c.districtId, stateId: c.stateId, sectorId: c.sectorId, tradeId: c.tradeId }))
  return {
    dataset: { ...snapshot.meta, mode: dataMode(), methodologyVersion: snapshot.methodologyVersion },
    session: {
      name: session.name, email: session.email, role: session.role, demo: session.demo,
      stateId: scope.stateId, districtId: scope.districtId,
      permissions: { recommendations: can(session, 'recommendations'), export: can(session, 'export') },
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
  const group = aggregateCells(cells)
  const h = group.horizons[f.horizon]
  const highPriority = cells.filter((c) => c.priority.band === 'high')
  const radar = cells
    .filter((c) => c.horizons[f.horizon].gap.gap !== null && c.demand.trendPct !== null && c.supply.capacityChangePct !== null)
    .sort((a, b) => Math.abs(b.horizons[f.horizon].gap.gap as number) - Math.abs(a.horizons[f.horizon].gap.gap as number))
    .slice(0, 6)
  return {
    horizon: horizonInfo(snapshot, cells, f.horizon),
    totals: {
      demand: h.demand, supply: h.supply, gap: h.gap.gap, gapPercentage: h.gap.gapPercentage, status: h.gap.status,
      shortageTotal: h.shortageTotal, surplusTotal: h.surplusTotal,
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
    indices: { demand: group.demandIndex.value, supply: group.supplyIndex.value },
    signals: cells.map((c) => cellRow(c, f.horizon)).filter((r) => r.priorityScore !== null).sort(byPriority).slice(0, 3),
    radar: radar.map((c) => cellRow(c, f.horizon)),
    planningHorizon: PRIORITY.planningHorizon,
  }
}

/* ------------------------------- Drill-down ------------------------------- */

type Level = 'state' | 'district' | 'sector' | 'trade'

export function drilldownView(snapshot: Snapshot, f: Filters) {
  const d = snapshot.dataset
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
          .map((id) => ({ id, level, ...groupRow(aggregateCells(cells.filter((c) => keyOf[level](c) === id)), f.horizon) }))
          .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0))

  // Map: every state in scope, ignoring the district filter so neighbours stay visible.
  const mapCells = filterCells(snapshot, { stateId: null, districtId: null, sectorId: f.sectorId, tradeId: f.tradeId })
  const states = d.states.map((state) => {
    const inState = mapCells.filter((c) => c.stateId === state.id)
    return { stateId: state.id, ...groupRow(aggregateCells(inState), f.horizon) }
  })

  const trades = [...new Set(cells.map((c) => c.tradeId))]
    .map((id) => ({ tradeId: id, sectorId: d.trades.find((t) => t.id === id)?.sectorId ?? '', ...groupRow(aggregateCells(cells.filter((c) => c.tradeId === id)), f.horizon) }))
    .sort(byPriority)

  return {
    horizon: horizonInfo(snapshot, cells, f.horizon),
    level,
    path: { stateId: f.stateId, districtId: f.districtId, sectorId: f.sectorId, tradeId: f.tradeId },
    total: groupRow(aggregateCells(cells), f.horizon),
    children,
    states,
    ranking: trades.slice(0, 5),
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
    .sort((a, b) => Math.abs(b.gapPercentage ?? -1) - Math.abs(a.gapPercentage ?? -1) || Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0))
  return {
    horizon: horizonInfo(snapshot, cells, f.horizon),
    total: groupRow(aggregateCells(cells), f.horizon),
    thresholds: METHODOLOGY.gapThresholds,
    rows,
  }
}

/* ----------------------------- Demand / supply ---------------------------- */

export function demandView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  const group = aggregateCells(cells)
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
  const group = aggregateCells(cells)
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
  const included = key ? cells.filter((c) => c.demandForecasts[key].predictedDemand !== null) : []
  const months = key ? included[0]?.demandForecasts[key].monthly.length ?? 0 : 0
  const monthly = Array.from({ length: months }, (_, i) => {
    const points = included.map((c) => c.demandForecasts[key as '3M'].monthly[i])
    const value = sum(points.map((p) => p.value))
    const half = Math.sqrt(sum(points.map((p) => (p.upper - p.value) ** 2)))
    return { period: points[0].period, value: round(value, 1), lower: round(Math.max(0, value - half), 1), upper: round(value + half, 1) }
  })
  const supplyKnown = key ? cells.filter((c) => c.supplyForecasts[key].predictedSupply !== null) : cells.filter((c) => c.supply.seats !== null)
  const supplyTotal = key ? sum(supplyKnown.map((c) => c.supplyForecasts[key].predictedSupply as number)) : sum(supplyKnown.map((c) => c.supply.seats as number))
  const h = group.horizons[horizon]
  const components = included.map((c) => c.demandForecasts[key as '3M'].components!)
  const parts = included.map((c) => c.demandForecasts[key as '3M'].parts!)
  const methods: Record<string, number> = {}
  for (const c of cells) methods[c.horizons[horizon].method] = (methods[c.horizons[horizon].method] ?? 0) + 1
  return {
    horizon: horizonInfo(snapshot, cells, horizon),
    history: group.series.slice(-24),
    monthly,
    /** Training capacity expressed per month, for comparison with monthly demand. */
    supplyPerMonth: supplyKnown.length ? round(supplyTotal / h.months, 1) : null,
    totals: {
      demand: h.demand, lower: h.demandLower, upper: h.demandUpper, supply: h.supply,
      gap: h.gap.gap, gapPercentage: h.gap.gapPercentage, status: h.gap.status, confidence: h.confidence,
      cellsIncluded: h.cellsIncluded, cellsExcluded: h.cellsExcluded,
    },
    components: included.length
      ? {
          baseline: round(sum(components.map((c) => c.baseline)), 1),
          trendSlope: round(sum(components.map((c) => c.trendSlope)), 2),
          recentSlope: round(sum(components.map((c) => c.recentSlope)), 2),
          monthsUsed: Math.min(...components.map((c) => c.monthsUsed)),
          parts: {
            baseline: round(sum(parts.map((p) => p.baseline)), 0),
            trend: round(sum(parts.map((p) => p.trend)), 0),
            recentGrowth: round(sum(parts.map((p) => p.recentGrowth)), 0),
          },
        }
      : null,
    methods,
    excluded: cells
      .filter((c) => c.horizons[horizon].demand === null || c.horizons[horizon].supply === null)
      .map((c) => ({ key: c.key, districtId: c.districtId, tradeId: c.tradeId, note: c.horizons[horizon].gap.note, reason: key ? c.demandForecasts[key].reason : null })),
    byHorizon: (['current', '3M', '6M', '12M'] as HorizonKey[]).map((k) => {
      const x = group.horizons[k]
      return { horizon: k, months: x.months, demand: x.demand, lower: x.demandLower, upper: x.demandUpper, supply: x.supply, gap: x.gap.gap, gapPercentage: x.gap.gapPercentage, status: x.gap.status, confidence: x.confidence }
    }),
    model: { demand: METHODOLOGY.forecast.modelVersion, supply: METHODOLOGY.supplyForecast.modelVersion, params: METHODOLOGY.forecast },
    backtest: snapshot.backtest,
    intervalCalibration: snapshot.intervalCalibration,
  }
}

export function forecastsView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  return forecastBlock(snapshot, cells, f.horizon, aggregateCells(cells))
}

/* ------------------------ Priority, alerts, actions ----------------------- */

export function priorityView(snapshot: Snapshot, f: Filters, groupBy: 'cell' | 'trade' | 'district') {
  const cells = filterCells(snapshot, f)
  const rows =
    groupBy === 'cell'
      ? cells.map((c) => ({ id: c.key, districtId: c.districtId as string | null, tradeId: c.tradeId as string | null, sectorId: c.sectorId as string | null, priority: c.priority, ...groupRow(aggregateCells([c]), f.horizon) }))
      : [...new Set(cells.map((c) => (groupBy === 'trade' ? c.tradeId : c.districtId)))].map((id) => {
          const members = cells.filter((c) => (groupBy === 'trade' ? c.tradeId : c.districtId) === id)
          const group = aggregateCells(members)
          return {
            id,
            districtId: groupBy === 'district' ? id : null,
            tradeId: groupBy === 'trade' ? id : null,
            sectorId: groupBy === 'trade' ? members[0].sectorId : null,
            priority: group.priority,
            ...groupRow(group, f.horizon),
          }
        })
  return { weights: PRIORITY.weights, bands: PRIORITY.bands, planningHorizon: PRIORITY.planningHorizon, groupBy, rows: rows.sort(byPriority) }
}

export function alertsView(snapshot: Snapshot, f: Filters) {
  const cells = filterCells(snapshot, f)
  const warnings: (Warning & { stateId: string })[] = cells.flatMap((c) => c.warnings.map((w) => ({ ...w, stateId: c.stateId })))
  warnings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id))
  const counts: Record<string, number> = {}
  for (const w of warnings) counts[w.type] = (counts[w.type] ?? 0) + 1
  return { lookaheadHorizon: ALERTS.lookaheadHorizon, rules: METHODOLOGY.alerts, counts, warnings }
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

export function tradeView(snapshot: Snapshot, tradeId: string, f: Filters) {
  const trade = snapshot.dataset.trades.find((t) => t.id === tradeId)
  if (!trade) return null
  const cells = filterCells(snapshot, { ...f, sectorId: null, tradeId })
  const group = aggregateCells(cells)
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
    priority: group.priority,
    forecast: forecastBlock(snapshot, cells, f.horizon, group),
    byDistrict: cells.map((c) => cellRow(c, f.horizon)).sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)),
    warnings: cells.flatMap((c) => c.warnings).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    recommendations: cells.map((c) => c.recommendation).sort(byPriority),
    sources: evidenceSources(snapshot),
    references: snapshot.references,
    freshness: snapshot.meta.updatedAt,
  }
}

export function districtView(snapshot: Snapshot, districtId: string, f: Filters) {
  const d = snapshot.dataset
  const district = d.districts.find((x) => x.id === districtId)
  if (!district) return null
  const cells = filterCells(snapshot, { stateId: null, districtId, sectorId: f.sectorId, tradeId: f.tradeId })
  const group = aggregateCells(cells)
  const centres = d.trainingCentres.filter((c) => c.districtId === districtId)
  return {
    district,
    state: d.states.find((s) => s.id === district.stateId) ?? null,
    horizon: horizonInfo(snapshot, cells, f.horizon),
    total: groupRow(group, f.horizon),
    priority: group.priority,
    sectors: [...new Set(cells.map((c) => c.sectorId))]
      .map((id) => ({ sectorId: id, ...groupRow(aggregateCells(cells.filter((c) => c.sectorId === id)), f.horizon) }))
      .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)),
    trades: cells.map((c) => cellRow(c, f.horizon)).sort(byPriority),
    trainingCentres: { active: centres.filter((c) => c.status === 'active').length, total: centres.length, capacity: sum(centres.filter((c) => c.status === 'active').map((c) => c.capacity)), list: centres },
    warnings: cells.flatMap((c) => c.warnings).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
  }
}

/* -------------------------- Methodology, sources -------------------------- */

export function methodologyView(snapshot: Snapshot) {
  return {
    methodology: METHODOLOGY,
    references: snapshot.references,
    backtest: snapshot.backtest,
    intervalCalibration: snapshot.intervalCalibration,
    dataset: snapshot.meta,
  }
}

export function sourcesView(snapshot: Snapshot) {
  return { dataset: snapshot.meta, mode: dataMode(), sources: snapshot.dataset.dataSources }
}

export const STATUS_VALUES: GapStatus[] = ['severe_shortage', 'shortage', 'balanced', 'oversupply', 'severe_oversupply', 'insufficient_data']
