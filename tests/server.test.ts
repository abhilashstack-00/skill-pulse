import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Dataset, Snapshot } from '@/lib/domain/types'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { sum } from '@/lib/intelligence/math'
import { tablesToDataset, type Row } from '@/lib/repository/map'
import { SupabaseRestRepository } from '@/lib/repository/supabase-rest'
import { AccessError, can, scopeOf, type GeoScope } from '@/lib/server/access'
import { derivedRows } from '@/lib/server/derived'
import { exportRows, toCsv } from '@/lib/server/export'
import { parseFilters, ValidationError } from '@/lib/server/filters'
import type { Session } from '@/lib/server/session'
import { alertsView, districtView, drilldownView, gapsView, recommendationsView, summaryView, tradeView } from '@/lib/server/views'

let snapshot: Snapshot
const session = (over: Partial<Session>): Session => ({ userId: 'u', name: 'n', email: null, role: 'national_planner', stateId: null, districtId: null, demo: false, ...over })
const open: GeoScope = { stateId: null, districtId: null }
const filters = (query: string, scope: GeoScope = open) => parseFilters(new URLSearchParams(query), snapshot, scope)

beforeAll(() => {
  snapshot = buildSnapshot(JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset)
})

describe('filters', () => {
  it('defaults to the 12-month horizon and no restriction', () => {
    expect(filters('')).toEqual({ stateId: null, districtId: null, sectorId: null, tradeId: null, horizon: '12M', status: null })
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
  it('lets planners and admins use recommendations and export, and employers only view', () => {
    for (const role of ['admin', 'national_planner', 'state_planner', 'district_planner'] as const) {
      expect(can(session({ role }), 'recommendations')).toBe(true)
      expect(can(session({ role }), 'export')).toBe(true)
    }
    expect(can(session({ role: 'employer' }), 'view')).toBe(true)
    expect(can(session({ role: 'employer' }), 'recommendations')).toBe(false)
    expect(can(session({ role: 'employer' }), 'export')).toBe(false)
  })

  it('limits a state planner to their state', () => {
    const scope = scopeOf(session({ role: 'state_planner', stateId: 'TG' }), snapshot)
    expect(scope).toEqual({ stateId: 'TG', districtId: null })
    const f = filters('', scope)
    expect(f.stateId).toBe('TG')
    expect(new Set(gapsView(snapshot, f).rows.map((r) => r.stateId))).toEqual(new Set(['TG']))
    expect(() => filters('stateId=KA', scope)).toThrow(AccessError)
    expect(() => filters('districtId=pune', scope)).toThrow(AccessError)
  })

  it('limits a district planner to their district', () => {
    const scope = scopeOf(session({ role: 'district_planner', districtId: 'warangal' }), snapshot)
    expect(scope).toEqual({ stateId: 'TG', districtId: 'warangal' })
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
  it('the dashboard, the gap table and the drill-down agree on every total', () => {
    for (const query of ['', 'stateId=TG', 'districtId=pune', 'sectorId=renewable-energy', 'stateId=KA&sectorId=it-digital', 'tradeId=solar-technician&horizon=6M', 'horizon=current', 'horizon=3M&stateId=MH']) {
      const f = filters(query)
      const summary = summaryView(snapshot, f)
      const gaps = gapsView(snapshot, f)
      const drill = drilldownView(snapshot, f)
      const known = gaps.rows.filter((r) => r.demand !== null && r.supply !== null)
      expect(summary.totals.demand ?? 0, query).toBe(sum(known.map((r) => r.demand as number)))
      expect(summary.totals.supply ?? 0, query).toBe(sum(known.map((r) => r.supply as number)))
      expect(summary.totals.gap ?? 0, query).toBe(sum(known.map((r) => r.gap as number)))
      expect(drill.total.demand, query).toBe(summary.totals.demand)
      expect(drill.total.gap, query).toBe(summary.totals.gap)
      if (drill.children.length) expect(sum(drill.children.map((c) => c.demand ?? 0)), query).toBe(summary.totals.demand ?? 0)
      expect(sum(Object.values(summary.statusCounts)), query).toBe(gaps.rows.length)
    }
  })

  it('drills from national to state, district, sector and trade', () => {
    expect(drilldownView(snapshot, filters('')).level).toBe('state')
    expect(drilldownView(snapshot, filters('stateId=TG')).level).toBe('district')
    expect(drilldownView(snapshot, filters('districtId=warangal')).level).toBe('sector')
    const trades = drilldownView(snapshot, filters('districtId=warangal&sectorId=renewable-energy'))
    expect(trades.level).toBe('trade')
    expect(trades.children.map((c) => c.id)).toEqual(['solar-technician'])
    const leaf = drilldownView(snapshot, filters('districtId=warangal&sectorId=renewable-energy&tradeId=solar-technician'))
    expect(leaf.level).toBe('cell')
    expect(leaf.leaf[0]).toMatchObject({ demand: 1250, supply: 800, gap: 450, status: 'severe_shortage' })
  })

  it('shows the same trade figures on the trade endpoint as in the gap table', () => {
    const view = tradeView(snapshot, 'solar-technician', filters('districtId=warangal'))!
    expect(view.forecast.totals).toMatchObject({ demand: 1250, supply: 800, gap: 450, gapPercentage: 56.25, status: 'severe_shortage' })
    expect(view.priority.score).toBe(snapshot.cells.find((c) => c.key === 'warangal|solar-technician')?.priority.score)
    expect(view.warnings.map((w) => w.type)).toContain('upcoming_shortage')
    expect(view.recommendations[0].action).toBe('increase_capacity')
    expect(view.sources.demand.length).toBeGreaterThan(0)
    expect(view.forecast.monthly).toHaveLength(12)
    expect(tradeView(snapshot, 'unknown', filters(''))).toBeNull()
  })

  it('filters the gap table by status and by status group', () => {
    const severe = gapsView(snapshot, filters('status=severe_shortage')).rows
    expect(severe.every((r) => r.status === 'severe_shortage')).toBe(true)
    const anyShortage = gapsView(snapshot, filters('status=any_shortage')).rows
    expect(anyShortage.length).toBe(severe.length + gapsView(snapshot, filters('status=shortage')).rows.length)
    expect(gapsView(snapshot, filters('status=insufficient_data')).rows).toHaveLength(2)
  })

  it('counts warnings and recommendations from the same pairs', () => {
    const f = filters('stateId=TG')
    const summary = summaryView(snapshot, f)
    const alerts = alertsView(snapshot, f)
    expect(alerts.warnings.length).toBe(summary.counts.warnings)
    expect(alerts.warnings.every((w) => w.stateId === 'TG')).toBe(true)
    const recs = recommendationsView(snapshot, f)
    expect(recs.items.length).toBe(summary.totals.cells)
    expect(recs.items.filter((i) => i.action !== 'maintain').length).toBe(recs.actionable)
  })

  it('profiles a district', () => {
    const view = districtView(snapshot, 'warangal', filters(''))!
    expect(view.state?.id).toBe('TG')
    expect(sum(view.sectors.map((s) => s.demand ?? 0))).toBe(view.total.demand)
    expect(view.trainingCentres.total).toBe(7)
  })
})

describe('export', () => {
  it('writes one labelled row per pair', () => {
    const rows = exportRows(snapshot, 'gaps', filters('districtId=warangal'))
    expect(rows.length).toBe(snapshot.cells.filter((c) => c.districtId === 'warangal').length)
    const solar = rows.find((r) => r.trade === 'Solar Technician')!
    expect(solar).toMatchObject({ state: 'Telangana', district: 'Warangal', demand: 1250, supply: 800, gap: 450, gap_percentage: 56.25, status: 'severe_shortage', data_label: 'Prototype synthetic pilot data' })
    const csv = toCsv(rows)
    expect(csv.split('\n')[0]).toContain('state,state_code,district')
    expect(csv.trim().split('\n')).toHaveLength(rows.length + 1)
  })

  it('exports forecasts, priority, alerts and recommendations', () => {
    const f = filters('tradeId=solar-technician&districtId=warangal')
    expect(exportRows(snapshot, 'forecasts', f).map((r) => r.horizon)).toEqual(['3M', '6M', '12M'])
    expect(exportRows(snapshot, 'priority', f)[0].priority_band).toBe('high')
    expect(exportRows(snapshot, 'alerts', f).map((r) => r.type)).toContain('upcoming_shortage')
    expect(String(exportRows(snapshot, 'recommendations', f)[0].recommendation)).toContain('Increase Solar Technician training capacity in Warangal')
  })

  it('escapes commas and quotes in CSV', () => {
    expect(toCsv([{ a: 'x, y', b: 'say "hi"', c: null }])).toBe('a,b,c\n"x, y","say ""hi""",\n')
    // Text that looks like a spreadsheet formula is neutralised; negative numbers are untouched.
    expect(toCsv([{ a: '=SUM(A1)', b: -450, c: '+1' }])).toBe("a,b,c\n'=SUM(A1),-450,'+1\n")
  })
})

describe('derived tables', () => {
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
    districts: [], sectors: [], trades: [], training_centres: [], data_sources: [],
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
