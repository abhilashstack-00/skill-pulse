import { PRIORITY } from '@/lib/config/methodology'
import type { CellAnalysis, GapStatus, Snapshot } from '@/lib/domain/types'
import { recommendationText, warningText, namesFrom } from '@/lib/i18n/render'
import { translator } from '@/lib/i18n/translate'
import { FORECAST_HORIZONS, HORIZON_KEYS } from '@/lib/intelligence/engine'
import { matchesStatus } from '@/lib/intelligence/gap'
import { filterCells, type Filters } from './filters'

export const EXPORT_DATASETS = ['gaps', 'forecasts', 'priority', 'alerts', 'recommendations', 'demand', 'supply'] as const
export type ExportDataset = (typeof EXPORT_DATASETS)[number]
type Row = Record<string, string | number | null>

/**
 * Flat rows for planners' own tools. Every row carries the data label, so an
 * exported file cannot be mistaken for official statistics.
 */
export function exportRows(snapshot: Snapshot, dataset: ExportDataset, f: Filters, options: { advice: boolean }): Row[] {
  const d = snapshot.dataset
  const t = translator('en')
  const names = namesFrom(d, 'en')
  const stateCode = new Map(d.states.map((s) => [s.id, s.code]))
  const districtCode = new Map(d.districts.map((x) => [x.id, x.code]))
  const trade = new Map(d.trades.map((x) => [x.id, x]))
  const cells = filterCells(snapshot, f)

  const place = (c: CellAnalysis): Row => ({
    state: names.state(c.stateId),
    state_code: stateCode.get(c.stateId) ?? '',
    district: names.district(c.districtId),
    district_code: districtCode.get(c.districtId) ?? '',
    sector: names.sector(c.sectorId),
    trade: names.trade(c.tradeId),
    nco_code: trade.get(c.tradeId)?.ncoCode ?? '',
    nsqf_level: trade.get(c.tradeId)?.nsqfLevel ?? null,
  })
  const stamp: Row = { data_label: snapshot.meta.label, data_as_of: snapshot.meta.asOfPeriod, methodology_version: snapshot.methodologyVersion }

  const advice = (c: CellAnalysis): Row => {
    const r = c.recommendation
    const text = recommendationText(t, names, r)
    return { recommended_action: r.action, recommendation: text.text, recommendation_horizon: PRIORITY.planningHorizon, effect_seats: r.effect?.seats ?? null, tentative: r.tentative ? 'yes' : 'no' }
  }

  switch (dataset) {
    case 'gaps':
      return cells.flatMap((c) =>
        HORIZON_KEYS.filter((h) => h === f.horizon).map((h) => {
          const x = c.horizons[h]
          return {
            ...place(c), horizon: h, period_start: x.periodStart, period_end: x.periodEnd,
            demand: x.demand, supply: x.supply, gap: x.gap.gap, gap_percentage: x.gap.gapPercentage, status: x.gap.status, holds_across_interval: x.firm === null ? null : x.firm ? 'yes' : 'no',
            priority_score: c.priority.score, priority_band: c.priority.band, confidence_score: x.confidence?.score ?? null, confidence: x.confidence?.label ?? null, forecast_method: x.method,
            demand_lower: x.demandLower, demand_upper: x.demandUpper, warnings: c.warnings.map((w) => w.type).join(' ') || null,
            // The planner recommendation rests on the planning horizon whichever horizon is exported; roles without advice do not get it.
            ...(options.advice ? advice(c) : {}), ...stamp,
          }
        }),
      ).filter((r) => matchesStatus(r.status as GapStatus, f.status))
    case 'forecasts':
      // The selected horizon, like the screen; with "current" selected there is no single forecast horizon, so all three.
      return cells.flatMap((c) =>
        FORECAST_HORIZONS.filter((h) => f.horizon === 'current' || h === f.horizon)
          .filter((h) => matchesStatus(c.horizons[h].gap.status, f.status))
          .map((h) => {
            const dem = c.demandForecasts[h]
            const sup = c.supplyForecasts[h]
            return {
              ...place(c), horizon: h, period_start: dem.periodStart, period_end: dem.periodEnd,
              predicted_demand: dem.predictedDemand, lower_bound: dem.lowerBound, upper_bound: dem.upperBound,
              baseline_part: dem.parts?.baseline ?? null, trend_part: dem.parts?.trend ?? null, recent_growth_part: dem.parts?.recentGrowth ?? null, held_at_zero_part: dem.parts?.floorAdjustment ?? null,
              model_half_width: dem.interval?.modelHalfWidth ?? null, calibration_factor: dem.interval?.calibrationFactor ?? null,
              demand_method: dem.method, confidence_score: dem.confidence?.score ?? null, confidence: dem.confidence?.label ?? null, demand_model_version: dem.modelVersion,
              predicted_supply: sup.predictedSupply, supply_method: sup.method, supply_model_version: sup.modelVersion,
              gap: c.horizons[h].gap.gap, gap_percentage: c.horizons[h].gap.gapPercentage, status: c.horizons[h].gap.status, ...stamp,
            }
          }),
      )
    case 'priority':
      return cells.map((c) => ({
        ...place(c), planning_horizon: PRIORITY.planningHorizon, priority_score: c.priority.score, priority_band: c.priority.band, direction: c.priority.direction,
        ...Object.fromEntries(c.priority.components.flatMap((p) => [[`${p.key}_input`, p.raw], [`${p.key}_value`, p.value], [`${p.key}_contribution`, p.contribution]])),
        missing_inputs: c.priority.missing.join(' ') || null, ...stamp,
      })).sort((a, b) => ((b.priority_score as number | null) ?? -1) - ((a.priority_score as number | null) ?? -1))
    case 'alerts':
      return cells.flatMap((c) =>
        c.warnings.map((w) => {
          const text = warningText(t, w)
          return { ...place(c), type: w.type, severity: w.severity, title: text.title, reason: text.reason, basis: w.basis, horizon: w.horizon, horizon_months: w.horizonMonths, confidence_score: w.confidence?.score ?? null, confidence: w.confidence?.label ?? null, ...(options.advice ? { recommended_action: text.action } : {}), evidence: w.evidence.map((e) => `${t(e.key)}=${e.value ?? 'n/a'}`).join('; '), ...stamp }
        }),
      )
    case 'recommendations':
      return cells.map((c) => {
        const r = c.recommendation
        const text = recommendationText(t, names, r)
        return { ...place(c), action: r.action, title: text.title, recommendation: text.text, expected_effect: text.effect, effect_kind: r.effect?.kind ?? null, effect_seats: r.effect?.seats ?? null, gap_pct_after: r.effect?.resultingGapPct ?? null, note: text.secondary, caution: text.caution, tentative: text.tentative, confidence_score: r.confidence?.score ?? null, confidence: r.confidence?.label ?? null, status: r.status, priority_score: r.priorityScore, evidence: r.evidence.map((e) => `${t(e.key)}=${e.value ?? 'n/a'}`).join('; '), ...stamp }
      })
        // Same order as the Action Center: actions first, "maintain" last, highest priority first within each.
        .sort((a, b) => Number(a.action === 'maintain') - Number(b.action === 'maintain') || ((b.priority_score as number | null) ?? -1) - ((a.priority_score as number | null) ?? -1))
    case 'demand':
      return cells.map((c) => ({
        ...place(c), demand_index: c.demand.index.value,
        ...Object.fromEntries(c.demand.index.components.flatMap((p) => [[`${p.key}_raw`, p.raw], [`${p.key}_normalized`, p.normalized]])),
        monthly_run_rate: c.demand.monthlyRunRate, demand_trend_pct: c.demand.trendPct, months_observed: c.demand.monthsObserved, ...stamp,
      }))
    case 'supply':
      return cells.map((c) => ({
        ...place(c), supply_index: c.supply.index.value, training_year: c.supply.latestYear, allocated_seats: c.supply.seats, enrolled: c.supply.enrolled,
        outcomes_year: c.supply.outcomesYear, completed: c.supply.completed, placed: c.supply.placed,
        utilization_pct: c.supply.utilizationPct, completion_rate_pct: c.supply.completionRatePct, placement_rate_pct: c.supply.placementRatePct,
        capacity_change_pct: c.supply.capacityChangePct, ...stamp,
      }))
  }
}

export function toCsv(rows: Row[]): string {
  if (!rows.length) return 'no rows match the selected filters\n'
  const header = Object.keys(rows[0])
  const cell = (value: string | number | null) => {
    let text = value === null || value === undefined ? '' : String(value)
    // Text that a spreadsheet would run as a formula is neutralised; numbers are left alone.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [header.join(','), ...rows.map((row) => header.map((key) => cell(row[key])).join(','))].join('\n') + '\n'
}
