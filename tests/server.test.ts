import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Dataset, Snapshot } from '@/lib/domain/types'
import { aggregateCells } from '@/lib/intelligence/aggregate'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { computeGap } from '@/lib/intelligence/gap'
import { sum } from '@/lib/intelligence/math'

const snapshotGap = (demand: number, supply: number) => computeGap(demand, supply).status
import { tablesToDataset, type Row } from '@/lib/repository/map'
import { SupabaseRestRepository } from '@/lib/repository/supabase-rest'
import { AccessError, can, scopeOf, type GeoScope } from '@/lib/server/access'
import { derivedRows } from '@/lib/server/derived'
import { exportRows, toCsv } from '@/lib/server/export'
import { filterCells, parseFilters, ValidationError } from '@/lib/server/filters'
import type { Session } from '@/lib/server/session'
import { alertsView, demandView, districtView, drilldownView, evidenceView, forecastsView, gapsView, methodologyView, priorityView, recommendationsView, runView, sourcesView, summaryView, supplyView, tradeView } from '@/lib/server/views'

let snapshot: Snapshot
const session = (over: Partial<Session>): Session => ({ userId: 'u', name: 'n', email: null, role: 'national_planner', stateId: null, districtId: null, approved: true, demo: false, evaluator: false, ...over })
const adminSession = session({ role: 'admin' })
const employerSession = session({ role: 'employer' })
const open: GeoScope = { stateId: null, districtId: null, districtIds: null }
const filters = (query: string, scope: GeoScope = open) => parseFilters(new URLSearchParams(query), snapshot, scope)

beforeAll(() => {
  snapshot = buildSnapshot(JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset)
})

describe('filters', () => {
  it('defaults to the 12-month horizon and no restriction', () => {
    expect(filters('')).toEqual({ stateId: null, districtId: null, sectorId: null, tradeId: null, horizon: '12M', status: null, districtIds: null })
  })

  it('derives the state from a district', () => {
    expect(filters('districtId=warangal')).toMatchObject({ stateId: 'TG', districtId: 'warangal' })
  })

  it('rejects unknown ids and inconsistent combinations', () => {
    expect(() => filters('stateId=XX')).toThrow(ValidationError)
    expect(() => filters('tradeId=astrologer')).toThrow(ValidationError)
    expect(() => filters('horizon=24M')).toThrow(ValidationError)
    expect(() => filters('stateId=KA&districtId=warangal')).toThrow(ValidationError)
  })
})

describe('role-based access', () => {
  it('gives each role exactly its permissions', () => {
    for (const role of ['admin', 'national_planner', 'state_planner', 'district_planner'] as const) {
      expect(can(session({ role }), 'view')).toBe(true)
      expect(can(session({ role }), 'recommendations')).toBe(true)
      expect(can(session({ role }), 'ingest')).toBe(role === 'admin')
    }
    expect(can(session({ role: 'employer' }), 'view')).toBe(true)
    expect(can(session({ role: 'employer' }), 'recommendations')).toBe(false)
    expect(can(session({ role: 'employer' }), 'ingest')).toBe(false)
  })

  it('gives an account that has not been approved nothing at all', () => {
    for (const role of ['admin', 'national_planner', 'employer'] as const) {
      const pending = session({ role, approved: false })
      expect(can(pending, 'view')).toBe(false)
      expect(can(pending, 'recommendations')).toBe(false)
      expect(() => scopeOf(pending, snapshot)).toThrow(AccessError)
    }
  })

  it('refuses a role it does not know', () => {
    expect(() => scopeOf(session({ role: 'superuser' as never }), snapshot)).toThrow(AccessError)
    expect(can(session({ role: 'superuser' as never }), 'view')).toBe(false)
  })

  it('lets the database narrow the scope, and refuses when the two disagree', () => {
    // The database says this state planner can read only two of Telangana's three districts.
    const visible = new Set(['hyderabad', 'warangal'])
    const scope = scopeOf(session({ role: 'state_planner', stateId: 'TG' }), snapshot, visible)
    const rows = gapsView(snapshot, filters('', scope)).rows
    expect(new Set(rows.map((r) => r.districtId))).toEqual(visible)
    expect(() => filters('districtId=rangareddy', scope)).toThrow(AccessError)
    // A national role the database shows nothing to sees nothing.
    const none = scopeOf(session({ role: 'national_planner' }), snapshot, new Set())
    expect(gapsView(snapshot, filters('', none)).rows).toHaveLength(0)
    expect(() => filters('stateId=TG', none)).toThrow(AccessError)
    // A district planner whose district the database does not grant is refused outright.
    expect(() => scopeOf(session({ role: 'district_planner', districtId: 'warangal' }), snapshot, new Set(['pune']))).toThrow(AccessError)
  })

  it('limits a state planner to their state', () => {
    const scope = scopeOf(session({ role: 'state_planner', stateId: 'TG' }), snapshot)
    expect(scope).toEqual({ stateId: 'TG', districtId: null, districtIds: null })
    const f = filters('', scope)
    expect(f.stateId).toBe('TG')
    expect(new Set(gapsView(snapshot, f).rows.map((r) => r.stateId))).toEqual(new Set(['TG']))
    expect(() => filters('stateId=KA', scope)).toThrow(AccessError)
    expect(() => filters('districtId=pune', scope)).toThrow(AccessError)
  })

  it('limits a district planner to their district', () => {
    const scope = scopeOf(session({ role: 'district_planner', districtId: 'warangal' }), snapshot)
    expect(scope).toEqual({ stateId: 'TG', districtId: 'warangal', districtIds: null })
    const rows = gapsView(snapshot, filters('', scope)).rows
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.districtId === 'warangal')).toBe(true)
    expect(() => filters('districtId=hyderabad', scope)).toThrow(AccessError)
  })

  it('gives national roles the whole pilot', () => {
    expect(scopeOf(session({ role: 'national_planner' }), snapshot)).toEqual(open)
    expect(scopeOf(session({ role: 'admin' }), snapshot)).toEqual(open)
  })

  it('gives a planner with no area assigned nothing rather than everything', () => {
    expect(() => scopeOf(session({ role: 'state_planner', stateId: null }), snapshot)).toThrow(AccessError)
    expect(() => scopeOf(session({ role: 'district_planner', districtId: null }), snapshot)).toThrow(AccessError)
    expect(() => scopeOf(session({ role: 'district_planner', districtId: 'atlantis' }), snapshot)).toThrow(AccessError)
  })
})

describe('one source of truth across screens', () => {
  const QUERIES = ['', 'stateId=TG', 'districtId=pune', 'districtId=warangal', 'districtId=mysuru', 'sectorId=renewable-energy', 'stateId=KA&sectorId=it-digital', 'tradeId=solar-technician&horizon=6M', 'horizon=current', 'horizon=3M&stateId=MH', 'horizon=6M']
  const demo = () => snapshot.cells.find((c) => c.key === 'warangal|solar-technician')!

  it('the dashboard, the gap table and the drill-down agree on every total', () => {
    for (const query of QUERIES) {
      const f = filters(query)
      const summary = summaryView(snapshot, f)
      const gaps = gapsView(snapshot, f)
      const drill = drilldownView(snapshot, f, open)
      const known = gaps.rows.filter((r) => r.demand !== null && r.supply !== null)
      expect(summary.totals.demand ?? 0, query).toBe(sum(known.map((r) => r.demand as number)))
      expect(summary.totals.supply ?? 0, query).toBe(sum(known.map((r) => r.supply as number)))
      expect(summary.totals.gap ?? 0, query).toBe(sum(known.map((r) => r.gap as number)))
      expect(drill.total.demand, query).toBe(summary.totals.demand)
      expect(drill.total.gap, query).toBe(summary.totals.gap)
      expect(drill.total.headline, query).toBe(summary.totals.headline)
      if (drill.children.length) {
        expect(sum(drill.children.map((c) => c.demand ?? 0)), query).toBe(summary.totals.demand ?? 0)
        expect(sum(drill.children.map((c) => c.shortageTotal)), query).toBe(summary.totals.shortageTotal)
        expect(sum(drill.children.map((c) => c.surplusTotal)), query).toBe(summary.totals.surplusTotal)
      }
      expect(sum(Object.values(summary.statusCounts)), query).toBe(gaps.rows.length)
      // The figures the dashboard explains are the figures it shows.
      const shortRows = known.filter((r) => r.status === 'shortage' || r.status === 'severe_shortage')
      expect(summary.totals.shortageTotal, query).toBe(sum(shortRows.map((r) => r.gap as number)))
      expect(summary.totals.shortagePairs, query).toBe(shortRows.length)
      expect(summary.explain.shortage.every((r) => r.status === 'shortage' || r.status === 'severe_shortage'), query).toBe(true)
      expect(summary.explain.excluded.length, query).toBe(summary.totals.cellsExcluded)
    }
  })

  it('the forecast screen adds up: breakdown, chart, capacity line and total cover the same pairs', () => {
    for (const query of QUERIES.filter((q) => !q.includes('current'))) {
      const f = filters(query)
      const view = forecastsView(snapshot, f)
      const b = view.breakdown!
      expect(b.total, query).toBe(view.totals.demand)
      expect(b.baseline + b.trend + b.recentGrowth + b.floorAdjustment + b.rounding, query).toBe(view.totals.demand)
      // Rounding is the only slack, and it is small: under one person per pair.
      expect(Math.abs(b.rounding), query).toBeLessThanOrEqual(view.totals.cellsIncluded)
      expect(Math.abs(sum(view.monthly.map((m) => m.value)) - (view.totals.demand as number)), query).toBeLessThanOrEqual(view.totals.cellsIncluded)
      expect(view.supplyPerMonth as number, query).toBeCloseTo((view.totals.supply as number) / view.horizon.months, 1)
      expect(view.totals.cellsIncluded + view.excluded.length, query).toBe(filterCells(snapshot, f).length)
      expect(view.interval!.halfWidth, query).toBeGreaterThanOrEqual(view.interval!.ifIndependent - 0.1)
      expect(view.interval!.halfWidth, query).toBeLessThanOrEqual(view.interval!.ifInStep + 0.1)
    }
    const current = forecastsView(snapshot, filters('horizon=current'))
    expect(current.breakdown).toBeNull()
    expect(current.monthly).toEqual([])
  })

  it('drills from national to state, district, sector and trade', () => {
    expect(drilldownView(snapshot, filters(''), open).level).toBe('state')
    expect(drilldownView(snapshot, filters('stateId=TG'), open).level).toBe('district')
    expect(drilldownView(snapshot, filters('districtId=warangal'), open).level).toBe('sector')
    const trades = drilldownView(snapshot, filters('districtId=warangal&sectorId=renewable-energy'), open)
    expect(trades.level).toBe('trade')
    expect(trades.children.map((c) => c.id)).toEqual(['solar-technician'])
    const leaf = drilldownView(snapshot, filters('districtId=warangal&sectorId=renewable-energy&tradeId=solar-technician'), open)
    expect(leaf.level).toBe('cell')
    const h = demo().horizons['12M']
    expect(leaf.leaf[0]).toMatchObject({ demand: h.demand, supply: h.supply, gap: h.gap.gap, status: h.gap.status })
  })

  it('ranks groups by high-priority pairs, then highest pair score, then seats short', () => {
    const view = drilldownView(snapshot, filters(''), open)
    const rows = [...view.children]
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]]
      const ordered = a.highPriorityPairs > b.highPriorityPairs
        || (a.highPriorityPairs === b.highPriorityPairs && ((a.priorityScore ?? -1) > (b.priorityScore ?? -1)
          || ((a.priorityScore ?? -1) === (b.priorityScore ?? -1) && a.shortageTotal >= b.shortageTotal)))
      expect(ordered, `${a.id} before ${b.id}`).toBe(true)
    }
    expect(view.ranking.length).toBeGreaterThan(0)
    expect(view.ranking[0].highPriorityPairs).toBe(Math.max(...view.ranking.map((r) => r.highPriorityPairs)))
  })

  it('puts the largest mismatch first in the gap table and data-less pairs last', () => {
    const rows = gapsView(snapshot, filters('')).rows
    const lastWithGap = rows.map((r) => r.gap !== null).lastIndexOf(true)
    expect(rows.slice(lastWithGap + 1).every((r) => r.gap === null)).toBe(true)
    expect(rows.slice(0, lastWithGap + 1).every((r) => r.gap !== null)).toBe(true)
    const pcts = rows.filter((r) => r.gapPercentage !== null).map((r) => Math.abs(r.gapPercentage as number))
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a))
  })

  it('shows the same trade figures on the trade endpoint as in the gap table', () => {
    const c = demo()
    const h = c.horizons['12M']
    const view = tradeView(snapshot, 'solar-technician', filters('districtId=warangal'), adminSession)!
    expect(view.forecast.totals).toMatchObject({ demand: h.demand, supply: h.supply, gap: h.gap.gap, gapPercentage: h.gap.gapPercentage, headline: h.gap.status })
    expect(view.priority.result).toEqual(c.priority)
    expect(view.priority.peak).toBeNull() // one pair: the score is its own, there is no "highest pair"
    expect(view.warnings.map((w) => w.type)).toContain('upcoming_shortage')
    expect(view.recommendations?.[0].action).toBe('increase_capacity')
    expect(view.sources.demand.length).toBeGreaterThan(0)
    expect(view.forecast.monthly).toHaveLength(12)
    expect(view.forecast.interval?.single).toEqual(c.demandForecasts['12M'].interval)
    expect(tradeView(snapshot, 'unknown', filters(''), adminSession)).toBeNull()
  })

  it('names the highest-priority pair when a trade is viewed across districts', () => {
    const view = tradeView(snapshot, 'solar-technician', filters(''), adminSession)!
    const cells = snapshot.cells.filter((c) => c.tradeId === 'solar-technician')
    const top = Math.max(...cells.map((c) => c.priority.score ?? -1))
    expect(view.priority.result?.score).toBe(top)
    expect(cells.find((c) => c.districtId === view.priority.peak?.districtId)?.priority.score).toBe(top)
    expect(view.priority.highPairs).toBe(cells.filter((c) => c.priority.band === 'high').length)
  })

  it('leaves recommendations out of the trade view for a role without them', () => {
    const view = tradeView(snapshot, 'solar-technician', filters('districtId=warangal'), employerSession)!
    expect(view.recommendations).toBeNull()
    expect(JSON.stringify(view)).not.toContain('increase_capacity')
    // The warnings stay (they are findings); the suggested action on each does not.
    expect(view.warnings.length).toBeGreaterThan(0)
    expect(view.warnings.every((w) => w.recommendedAction === null)).toBe(true)
  })

  it('gives findings to every role and advice only to planners, on every view that carries warnings', () => {
    const f = filters('districtId=warangal')
    const views = (s: Session) => [alertsView(snapshot, f, s).warnings, districtView(snapshot, 'warangal', filters(''), s)!.warnings, evidenceView(snapshot, 'warangal', 'solar-technician', s)!.warnings]
    for (const warnings of views(employerSession)) {
      expect(warnings.length).toBeGreaterThan(0)
      expect(JSON.stringify(warnings)).not.toContain('warning.action.')
    }
    for (const warnings of views(adminSession)) expect(warnings.every((w) => typeof w.recommendedAction === 'string')).toBe(true)
    expect(Object.keys(exportRows(snapshot, 'alerts', f, { advice: false })[0])).not.toContain('recommended_action')
    expect(Object.keys(exportRows(snapshot, 'alerts', f, { advice: true })[0])).toContain('recommended_action')
  })

  it('shows load history in as much detail as the role should have', () => {
    const run = snapshot.dataset.ingestionRuns.find((r) => r.sourceId === 'job-portals')!
    expect(run.rejects.length).toBeGreaterThan(0)
    const forEmployer = runView(run, employerSession)
    expect(forEmployer).toMatchObject({ fileName: null, loadedBy: null, rejects: null, looseMatchList: null, rowsRead: run.rowsRead, valueMapped: run.valueMapped })
    const forPlanner = runView(run, session({ role: 'state_planner', stateId: 'TG' }))
    expect(forPlanner).toMatchObject({ fileName: run.fileName, loadedBy: null, rejects: null })
    expect(runView(run, adminSession).rejects).toEqual(run.rejects)
    // The same rule wherever a run appears.
    expect(JSON.stringify(sourcesView(snapshot, employerSession))).not.toContain('Java Developer')
    expect(JSON.stringify(evidenceView(snapshot, 'warangal', 'solar-technician', employerSession))).not.toContain(run.fileName)
  })

  it('limits the map to the session\'s own area', () => {
    const district = scopeOf(session({ role: 'district_planner', districtId: 'warangal' }), snapshot)
    const view = drilldownView(snapshot, filters('', district), district)
    expect(view.states.map((s) => s.stateId)).toEqual(['TG'])
    const own = aggregateCells(snapshot.cells.filter((c) => c.districtId === 'warangal'), snapshot.calibration).horizons['12M']
    expect(view.states[0]).toMatchObject({ demand: own.demand, supply: own.supply, cells: snapshot.cells.filter((c) => c.districtId === 'warangal').length })
    expect(view.mapScope).toEqual({ stateId: 'TG', districtId: 'warangal' })
    const state = scopeOf(session({ role: 'state_planner', stateId: 'KA' }), snapshot)
    expect(drilldownView(snapshot, filters('', state), state).states.map((s) => s.stateId)).toEqual(['KA'])
    expect(drilldownView(snapshot, filters(''), open).states.map((s) => s.stateId).sort()).toEqual(['KA', 'MH', 'TG'])
  })

  it('filters the gap table by status and by status group', () => {
    const severe = gapsView(snapshot, filters('status=severe_shortage')).rows
    expect(severe.every((r) => r.status === 'severe_shortage')).toBe(true)
    const anyShortage = gapsView(snapshot, filters('status=any_shortage')).rows
    expect(anyShortage.length).toBe(severe.length + gapsView(snapshot, filters('status=shortage')).rows.length)
    const noData = snapshot.cells.filter((c) => c.horizons['12M'].gap.status === 'insufficient_data').length
    expect(noData).toBeGreaterThan(0)
    expect(gapsView(snapshot, filters('status=insufficient_data')).rows).toHaveLength(noData)
  })

  it('counts warnings and recommendations from the same pairs', () => {
    const f = filters('stateId=TG')
    const summary = summaryView(snapshot, f)
    const alerts = alertsView(snapshot, f, adminSession)
    expect(alerts.warnings.length).toBe(summary.counts.warnings)
    expect(alerts.warnings.every((w) => w.stateId === 'TG')).toBe(true)
    const recs = recommendationsView(snapshot, f)
    expect(recs.items.length).toBe(summary.totals.cells)
    expect(recs.items.filter((i) => i.action !== 'maintain').length).toBe(recs.actionable)
  })

  it('profiles a district', () => {
    const view = districtView(snapshot, 'warangal', filters(''), adminSession)!
    expect(view.state?.id).toBe('TG')
    expect(sum(view.sectors.map((s) => s.demand ?? 0))).toBe(view.total.demand)
    expect(view.trainingCentres.total).toBe(7)
  })
})

describe('export', () => {
  it('writes one labelled row per pair', () => {
    const rows = exportRows(snapshot, 'gaps', filters('districtId=warangal'), { advice: true })
    expect(rows.length).toBe(snapshot.cells.filter((c) => c.districtId === 'warangal').length)
    const solar = rows.find((r) => r.trade === 'Solar Technician')!
    const h = snapshot.cells.find((c) => c.key === 'warangal|solar-technician')!.horizons['12M']
    expect(solar).toMatchObject({ state: 'Telangana', district: 'Warangal', demand: h.demand, supply: h.supply, gap: h.gap.gap, gap_percentage: h.gap.gapPercentage, status: h.gap.status, data_label: 'Prototype synthetic pilot data' })
    const csv = toCsv(rows)
    expect(csv.split('\n')[0]).toContain('state,state_code,district')
    expect(csv.trim().split('\n')).toHaveLength(rows.length + 1)
  })

  it('exports forecasts, priority, alerts and recommendations', () => {
    const f = filters('tradeId=solar-technician&districtId=warangal')
    expect(exportRows(snapshot, 'forecasts', f, { advice: true }).map((r) => r.horizon)).toEqual(['12M']) // the selected horizon, like the screen
    expect(exportRows(snapshot, 'forecasts', filters('tradeId=solar-technician&districtId=warangal&horizon=3M'), { advice: true })[0]).toMatchObject({ horizon: '3M' })
    expect(exportRows(snapshot, 'forecasts', filters('tradeId=solar-technician&districtId=warangal&horizon=current'), { advice: true })).toHaveLength(3) // no single forecast horizon chosen: all three
    expect(exportRows(snapshot, 'priority', f, { advice: true })[0].priority_band).toBe('high')
    expect(exportRows(snapshot, 'alerts', f, { advice: true }).map((r) => r.type)).toContain('upcoming_shortage')
    expect(String(exportRows(snapshot, 'recommendations', f, { advice: true })[0].recommendation)).toContain('Increase Solar Technician training capacity in Warangal')
  })

  it('escapes commas and quotes in CSV', () => {
    expect(toCsv([{ a: 'x, y', b: 'say "hi"', c: null }])).toBe('a,b,c\n"x, y","say ""hi""",\n')
    // Text that looks like a spreadsheet formula is neutralised; negative numbers are untouched.
    expect(toCsv([{ a: '=SUM(A1)', b: -450, c: '+1' }])).toBe("a,b,c\n'=SUM(A1),-450,'+1\n")
  })
})

describe('evidence for one pair', () => {
  it('returns the stored rows unchanged, with the months each calculation used', () => {
    const view = evidenceView(snapshot, 'warangal', 'solar-technician', adminSession)!
    const stored = snapshot.dataset.labourDemand.filter((r) => r.districtId === 'warangal' && r.tradeId === 'solar-technician').sort((a, b) => a.period.localeCompare(b.period))
    expect(view.demandRows.map((r) => [r.period, r.jobPostings, r.employmentRegistrations, r.hiringSignal, r.industryDemandSignal])).toEqual(
      stored.map((r) => [r.period, r.jobPostings, r.employmentRegistrations, r.hiringSignal, r.industryDemandSignal]),
    )
    expect(view.demandRows.filter((r) => r.usedForBaseline).map((r) => r.period)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(view.demandRows.filter((r) => r.usedForTrend)).toHaveLength(12)
    // The baseline shown is the mean of exactly the shaded rows.
    const shaded = view.demandRows.filter((r) => r.usedForBaseline).map((r) => r.volume as number)
    expect(view.forecast.components?.baseline).toBeCloseTo(sum(shaded) / shaded.length, 2)
    expect(view.trainingRows.map((r) => r.year)).toEqual([2023, 2024, 2025, 2026])
  })

  it('names the file load behind every value', () => {
    const view = evidenceView(snapshot, 'warangal', 'solar-technician', adminSession)!
    expect(view.runs.map((r) => r.sourceId).sort()).toEqual(['employment-exchange', 'industry-hiring', 'industry-survey', 'job-portals', 'training-capacity'])
    const runIds = new Set(view.runs.map((r) => r.id))
    for (const row of view.demandRows) for (const id of Object.values(row.lineage)) expect(runIds.has(id as number)).toBe(true)
    expect(view.signals.map((s) => s.metric).sort()).toEqual(['employmentRegistrations', 'hiringSignal', 'industryDemandSignal', 'jobPostings'])
    expect(evidenceView(snapshot, 'warangal', 'wind-turbine-technician', adminSession)).toBeNull() // no such pair in the pilot
  })
})

describe('derived tables', () => {
  it('carries the priority score only on the planning-horizon row', () => {
    const { columns, rows } = derivedRows(snapshot).gap_analysis
    const [horizon, score] = [columns.indexOf('horizon'), columns.indexOf('priority_score')]
    expect(rows.filter((r) => r[horizon] !== '12M').every((r) => r[score] === null)).toBe(true)
    expect(rows.some((r) => r[horizon] === '12M' && r[score] !== null)).toBe(true)
  })


  it('produces one row per pair and horizon', () => {
    const derived = derivedRows(snapshot)
    expect(derived.demand_forecasts.rows).toHaveLength(snapshot.cells.length * 3)
    expect(derived.supply_forecasts.rows).toHaveLength(snapshot.cells.length * 3)
    expect(derived.gap_analysis.rows).toHaveLength(snapshot.cells.length * 4)
    expect(derived.gap_analysis.rows[0]).toHaveLength(derived.gap_analysis.columns.length)
  })
})

describe('repositories', () => {
  const tables = () => ({
    dataset_meta: [{ label: 'x', synthetic: true, as_of_period: new Date(2026, 8, 1), updated_at: '2026-09-28', current_training_year: 2026 }],
    states: [{ id: 'TG', name: 'Telangana', name_hi: null, code: 'TG' }],
    districts: [], sectors: [], trades: [], training_centres: [], data_sources: [], ingestion_runs: [],
    training_capacity: [{ district_id: 'd', sector_id: 's', trade_id: 't', year: 2026, allocated_seats: 800, enrolled: 752, completed: null, placed: null }],
    labour_demand: [{ district_id: 'd', sector_id: 's', trade_id: 't', period: '2026-09-01', job_postings: 57, hiring_signal: '92.5', employment_registrations: 30, industry_demand_signal: null, source: 'x' }],
  })

  it('maps database rows whether dates arrive as text or Date and numerics as text or number', () => {
    const d = tablesToDataset(tables())
    expect(d.meta.asOfPeriod).toBe('2026-09')
    expect(d.states[0].nameHi).toBe('Telangana') // falls back to the English name
    expect(d.labourDemand[0]).toMatchObject({ period: '2026-09', hiringSignal: 92.5, industryDemandSignal: null })
    expect(d.trainingCapacity[0]).toMatchObject({ allocatedSeats: 800, completed: null })
  })

  it('refuses to run on an unseeded database', () => {
    expect(() => tablesToDataset({ ...tables(), dataset_meta: [] })).toThrow(/seed/)
  })

  it('reads every page from the Supabase REST API', async () => {
    const big: Row[] = Array.from({ length: 2300 }, (_, i) => ({ district_id: 'd', sector_id: 's', trade_id: 't', period: '2026-09-01', job_postings: i, source: 'x' }))
    const calls: string[] = []
    const fake = {
      from: (table: string) => ({
        select: () => ({
          order: () => ({
            range: async (from: number, to: number) => {
              calls.push(`${table}:${from}-${to}`)
              const all = table === 'labour_demand' ? big : ((tables() as Record<string, Row[]>)[table] ?? [])
              return { data: all.slice(from, to + 1), error: null }
            },
          }),
        }),
      }),
    }
    const dataset = await new SupabaseRestRepository(fake as never).loadDataset()
    expect(dataset.labourDemand).toHaveLength(2300)
    expect(calls.filter((c) => c.startsWith('labour_demand'))).toEqual(['labour_demand:0-999', 'labour_demand:1000-1999', 'labour_demand:2000-2999'])
  })

  it('surfaces a Supabase error instead of returning partial data', async () => {
    const failing = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'permission denied' } }) }) }) }) }
    await expect(new SupabaseRestRepository(failing as never).loadDataset()).rejects.toThrow(/permission denied/)
  })
})

describe('filter consistency: every view answers the same question for the same filters', () => {
  const COMBINATIONS = [
    '', 'stateId=TG', 'stateId=KA&sectorId=it-digital', 'districtId=pune', 'districtId=mysuru&sectorId=healthcare', 'sectorId=renewable-energy',
    'tradeId=solar-technician', 'stateId=MH&tradeId=cnc-operator', 'districtId=warangal&tradeId=solar-technician',
    'horizon=current', 'horizon=3M&stateId=TG', 'horizon=6M&sectorId=manufacturing', 'horizon=6M&districtId=nagpur',
  ]

  it.each(COMBINATIONS)('%s', (query) => {
    const f = filters(query)
    const cells = filterCells(snapshot, f)
    const keys = cells.map((c) => c.key).sort()
    const inFilter = (row: { stateId?: string | null; districtId?: string | null; sectorId?: string | null; tradeId?: string | null }) =>
      (!f.stateId || !row.stateId || row.stateId === f.stateId) && (!f.districtId || !row.districtId || row.districtId === f.districtId)
      && (!f.sectorId || !row.sectorId || row.sectorId === f.sectorId) && (!f.tradeId || !row.tradeId || row.tradeId === f.tradeId)

    const summary = summaryView(snapshot, f)
    const gaps = gapsView(snapshot, f)
    const drill = drilldownView(snapshot, f, open)
    const forecast = forecastsView(snapshot, f)
    const alerts = alertsView(snapshot, f, adminSession)
    const recs = recommendationsView(snapshot, f)
    const priority = priorityView(snapshot, f, 'cell')
    const demand = demandView(snapshot, f)
    const supply = supplyView(snapshot, f)

    // Cards, table, drill-down and forecast: one set of pairs, one set of totals.
    expect(summary.totals.cells).toBe(cells.length)
    expect(gaps.rows.map((r) => r.key).sort()).toEqual(keys)
    expect(priority.rows.map((r) => r.id).sort()).toEqual(keys)
    expect(demand.rows.map((r) => r.key).sort()).toEqual(keys)
    expect(supply.rows.map((r) => r.key).sort()).toEqual(keys)
    expect(recs.items.map((r) => `${r.districtId}|${r.tradeId}`).sort()).toEqual(keys)
    const both = gaps.rows.filter((r) => r.demand !== null && r.supply !== null)
    const totals = { demand: both.length ? sum(both.map((r) => r.demand as number)) : null, supply: both.length ? sum(both.map((r) => r.supply as number)) : null }
    expect({ demand: summary.totals.demand, supply: summary.totals.supply }).toEqual(totals)
    expect({ demand: gaps.total.demand, supply: gaps.total.supply }).toEqual(totals)
    expect({ demand: drill.total.demand, supply: drill.total.supply }).toEqual(totals)
    expect({ demand: forecast.totals.demand, supply: forecast.totals.supply }).toEqual(totals)
    expect(summary.totals.headline).toBe(gaps.total.headline)
    expect(summary.totals.headline).toBe(drill.total.headline)
    expect(forecast.totals.headline).toBe(summary.totals.headline)
    // Seats short and spare are the sums of the rows classified that way, wherever they are shown.
    const short = sum(gaps.rows.filter((r) => ['shortage', 'severe_shortage'].includes(r.status)).map((r) => r.gap as number))
    const spare = sum(gaps.rows.filter((r) => ['oversupply', 'severe_oversupply'].includes(r.status)).map((r) => r.gap as number))
    for (const t of [summary.totals, gaps.total, drill.total, forecast.totals]) expect([t.shortageTotal, t.surplusTotal]).toEqual([short, spare])
    // Status counts on the dashboard are the counts of the table's rows.
    for (const status of Object.keys(summary.statusCounts) as (keyof typeof summary.statusCounts)[]) {
      expect(summary.statusCounts[status], status).toBe(gaps.rows.filter((r) => r.status === status).length)
    }
    // Drill-down children partition the pairs: their totals add up to the parent's.
    if (drill.children.length) {
      expect(sum(drill.children.map((c) => c.cells))).toBe(cells.length)
      expect(sum(drill.children.map((c) => c.demand ?? 0))).toBe(drill.total.demand ?? 0)
      expect(sum(drill.children.map((c) => c.shortageTotal))).toBe(drill.total.shortageTotal)
    }
    // Rankings: only trades present in the filtered pairs, and each ranked trade's figures are those pairs'.
    for (const ranked of drill.ranking) {
      const own = cells.filter((c) => c.tradeId === ranked.tradeId)
      expect(own.length).toBe(ranked.cells)
      expect(inFilter(ranked)).toBe(true)
    }
    // Warnings and recommendations come from the same pairs and nothing else.
    expect(alerts.warnings.length).toBe(sum(cells.map((c) => c.warnings.length)))
    expect(alerts.warnings.length).toBe(summary.counts.warnings)
    expect(alerts.warnings.every(inFilter)).toBe(true)
    expect(recs.items.every(inFilter)).toBe(true)
    expect(summary.signals.every(inFilter)).toBe(true)
    expect(summary.radar.every(inFilter)).toBe(true)
    // High-priority count on the dashboard is the count in the priority view.
    expect(summary.counts.highPriorityCells).toBe(priority.rows.filter((r) => r.priority?.band === 'high').length)
    // Exports carry the same rows as the screens.
    expect(exportRows(snapshot, 'gaps', f, { advice: true }).length).toBe(gaps.rows.length)
    expect(exportRows(snapshot, 'alerts', f, { advice: true }).length).toBe(alerts.warnings.length)
    expect(exportRows(snapshot, 'recommendations', f, { advice: true }).length).toBe(recs.items.length)
  })

  it('priority and recommendations do not change with the selected time window; totals do', () => {
    const [short, long] = [filters('horizon=3M&stateId=TG'), filters('horizon=12M&stateId=TG')]
    expect(recommendationsView(snapshot, short).items.map((i) => [i.id, i.action, i.priorityScore])).toEqual(recommendationsView(snapshot, long).items.map((i) => [i.id, i.action, i.priorityScore]))
    expect(alertsView(snapshot, short, adminSession).warnings.map((w) => w.id)).toEqual(alertsView(snapshot, long, adminSession).warnings.map((w) => w.id))
    expect(summaryView(snapshot, short).totals.demand).not.toBe(summaryView(snapshot, long).totals.demand)
  })
})

describe('explanations: what a screen says a number is made of adds up to that number', () => {
  it('confidence is the score its interval gives, lowered only by a stated short-history cap', () => {
    for (const c of snapshot.cells) {
      for (const key of ['3M', '6M', '12M'] as const) {
        const f = c.demandForecasts[key]
        if (!f.confidence || !f.confidenceBasis || !f.interval) { expect(f.confidenceBasis, c.key).toBeNull(); continue }
        const b = f.confidenceBasis
        expect(f.confidence.score, `${c.key} ${key}`).toBe(b.cap === null ? b.scoreFromInterval : Math.min(b.scoreFromInterval, b.cap))
        expect(b.cap === null, `${c.key} ${key}`).toBe(f.method === 'full')
        expect(b.monthsObserved).toBeLessThanOrEqual(b.monthsInWindow)
        expect(b.monthsObserved === b.monthsInWindow).toBe(f.method === 'full')
        // The relative half-width is the half-width over the forecast, and the score follows from it by the documented rule.
        expect(Math.abs(b.relativeHalfWidthPct - (f.interval.halfWidth / (f.predictedDemand as number)) * 100), `${c.key} ${key}`).toBeLessThan(0.6)
      }
    }
  })

  it('weaker evidence gives lower confidence: fewer months, or a noisier series, never scores higher for it', () => {
    const scores = (method: string) => snapshot.cells.filter((c) => c.horizons['12M'].method === method).map((c) => c.horizons['12M'].confidence!.score)
    expect(Math.max(...scores('baseline_estimate'))).toBeLessThanOrEqual(35)
    expect(Math.max(...scores('limited_history'))).toBeLessThanOrEqual(60)
    expect(Math.max(...scores('full'))).toBeGreaterThan(60)
    // Among full-method pairs, confidence falls as the interval widens relative to the forecast.
    const full = snapshot.cells.filter((c) => c.horizons['12M'].method === 'full').map((c) => c.demandForecasts['12M']).sort((a, b) => a.confidenceBasis!.relativeHalfWidthPct - b.confidenceBasis!.relativeHalfWidthPct)
    for (let i = 1; i < full.length; i++) expect(full[i].confidence!.score).toBeLessThanOrEqual(full[i - 1].confidence!.score)
  })

  it('the trade page shows the basis for one pair and none for a group', () => {
    expect(tradeView(snapshot, 'solar-technician', filters('districtId=warangal'), adminSession)!.forecast.confidenceBasis).toEqual(snapshot.cells.find((c) => c.key === 'warangal|solar-technician')!.demandForecasts['12M'].confidenceBasis)
    expect(tradeView(snapshot, 'solar-technician', filters(''), adminSession)!.forecast.confidenceBasis).toBeNull()
  })

  it('every recommendation carries its problem, evidence, action, expected effect and confidence from the same pair', () => {
    for (const item of recommendationsView(snapshot, filters('')).items) {
      const cell = snapshot.cells.find((c) => c.key === `${item.districtId}|${item.tradeId}`)!
      const h = cell.horizons['12M']
      expect(item.status).toBe(h.gap.status)
      expect(item.row).toMatchObject({ demand: h.demand, supply: h.supply, gap: h.gap.gap })
      expect(item.confidence).toEqual(h.confidence)
      expect(item.evidence.find((e) => e.key === 'ev.gap')?.value).toBe(h.gap.gap)
      if (item.effect?.kind === 'add_seats' || item.effect?.kind === 'release_seats') {
        const sign = item.effect.kind === 'add_seats' ? 1 : -1
        const next = (h.supply as number) + sign * item.effect.seats
        expect(next, item.id).toBeGreaterThanOrEqual(0)
        expect(snapshotGap(h.demand as number, next), item.id).toBe('balanced')
        expect(snapshotGap(h.demand as number, next - sign), `${item.id} with one seat less`).not.toBe('balanced')
        // The percentage printed beside it is strictly inside the band, at the two decimals it is printed with.
        expect(Math.abs(item.effect.resultingGapPct as number), item.id).toBeLessThan(15)
      }
      expect(item.effect === null).toBe(['maintain', 'collect_data'].includes(item.action) || (item.action === 'fill_seats_first' && (cell.supply.seats ?? 0) <= (cell.supply.enrolled ?? 0)))
    }
  })

  it('every warning says over what period it holds and how sure the forecast behind it is', () => {
    for (const w of alertsView(snapshot, filters(''), adminSession).warnings) {
      const cell = snapshot.cells.find((c) => c.districtId === w.districtId && c.tradeId === w.tradeId)!
      expect(['current', '6M', '12M']).toContain(w.horizon)
      expect(w.confidence).toEqual(w.basis === 'forecast' ? cell.horizons[w.horizon].confidence : null)
      expect(w.basis).toBe(w.type === 'oversupply_risk' ? 'trend' : ['acute_shortage', 'saturation'].includes(w.type) ? 'current' : 'forecast')
      expect(w.evidence.some((e) => e.value !== null)).toBe(true)
    }
  })
})

describe('data sources view', () => {
  it('claims no live connection, and separates pilot data from planned integrations', () => {
    const view = sourcesView(snapshot, adminSession)
    expect(view.connected).toBe(0)
    const planned = view.sources.filter((s) => s.status === 'planned')
    expect(planned.map((s) => s.id).sort()).toEqual(['e-shram', 'ncs', 'plfs', 'scheme-mis'])
    for (const s of planned) expect(s).toMatchObject({ integration: 'planned', latestRun: null, recordsIn: null })
    for (const s of view.sources.filter((x) => x.status === 'prototype_synthetic')) {
      expect(s.integration).toBe('file_load')
      expect(s.latestRun?.synthetic).toBe(true)
    }
    expect(view.dataset).toMatchObject({ synthetic: true, label: 'Prototype synthetic pilot data' })
  })

  it('totals data quality from the recorded loads', () => {
    const view = sourcesView(snapshot, adminSession)
    const runs = snapshot.dataset.ingestionRuns
    // The pilot has one load per source, so "every load still in the dataset" is every load. (A source that is replaced drops its earlier loads: tested in tests/pilot.test.ts.)
    expect(new Set(runs.map((r) => r.sourceId)).size).toBe(runs.length)
    expect(view.quality.recordsProcessed).toBe(sum(runs.map((r) => r.rowsRead)))
    expect(view.quality.recordsValid).toBe(sum(runs.map((r) => r.rowsMapped)))
    expect(view.quality.recordsRejected).toBe(sum(runs.map((r) => r.rowsRejected)))
    expect(view.quality.completenessPct).toBeCloseTo((view.quality.recordsValid / view.quality.recordsProcessed) * 100, 1)
  })

  it('reports what the methodology page needs from the data, not from typed text', () => {
    const view = methodologyView(snapshot)
    expect(view.coverage).toEqual({ states: 3, districts: 7, sectors: 7, trades: 14, pairs: snapshot.cells.length, months: 24 })
    expect(view.matching.fuzzyThreshold).toBeGreaterThan(view.matching.wordThreshold)
  })
})

describe('export for planning', () => {
  it('has every field a planner needs on one row, computed, and nothing for show', () => {
    const rows = exportRows(snapshot, 'gaps', filters(''), { advice: true })
    for (const column of ['state', 'district', 'sector', 'trade', 'horizon', 'demand', 'demand_lower', 'demand_upper', 'supply', 'gap', 'gap_percentage', 'status', 'confidence_score', 'confidence', 'priority_score', 'priority_band', 'recommended_action', 'recommendation', 'effect_seats', 'tentative', 'data_label', 'methodology_version']) {
      expect(Object.keys(rows[0]), column).toContain(column)
    }
    for (const row of rows) {
      const cell = snapshot.cells.find((c) => c.districtId === snapshot.dataset.districts.find((d) => d.name === row.district)!.id && c.tradeId === snapshot.dataset.trades.find((t) => t.name === row.trade)!.id)!
      const h = cell.horizons['12M']
      expect(row).toMatchObject({ demand: h.demand, supply: h.supply, gap: h.gap.gap, status: h.gap.status, priority_score: cell.priority.score, recommended_action: cell.recommendation.action, effect_seats: cell.recommendation.effect?.seats ?? null })
    }
    // A role without planner advice gets the figures and not the advice.
    const forEmployer = exportRows(snapshot, 'gaps', filters(''), { advice: false })
    for (const column of ['recommended_action', 'recommendation', 'recommendation_horizon', 'effect_seats', 'tentative']) expect(Object.keys(forEmployer[0]), column).not.toContain(column)
    expect(JSON.stringify(forEmployer)).not.toMatch(/increase_capacity|review_allocation|reduce_or_redirect|fill_seats_first/)
    expect(forEmployer[0].demand).toBe(rows[0].demand)
  })
})
