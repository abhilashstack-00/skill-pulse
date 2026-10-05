import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CellAnalysis, Dataset, Snapshot } from '@/lib/domain/types'
import { applyToDataset } from '@/lib/ingest/apply'
import { formatCsv } from '@/lib/ingest/csv'
import { ingestExtract } from '@/lib/ingest/ingest'
import { specFor } from '@/lib/ingest/sources'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { isShortage, STATUS_RANK } from '@/lib/intelligence/gap'
import { exportRows } from '@/lib/server/export'
import { parseFilters } from '@/lib/server/filters'
import type { Session } from '@/lib/server/session'
import { alertsView, evidenceView, gapsView, recommendationsView, summaryView } from '@/lib/server/views'

/**
 * The end-to-end chain, from a source file to an export row:
 *
 *   file → validation → mapping → stored rows → Demand Index → forecast → gap
 *        → priority → early warning → recommendation → views → export
 *
 * One number in a source file is changed and every step downstream is checked
 * to have moved, in the right direction, for that pair and for no other. If a
 * figure on a screen were typed in rather than computed, this is where it
 * would show: it would not move.
 *
 * No expected value is written here. The pair is chosen from the pilot data
 * by rule, and "after" is compared with "before".
 */
const planner: Session = { userId: 'u', name: 'n', email: null, role: 'national_planner', stateId: null, districtId: null, approved: true, demo: false, evaluator: false }
const open = { stateId: null, districtId: null, districtIds: null }
const portal = specFor('job-portals')!

let dataset: Dataset
let before: Snapshot
let after: Snapshot
let target: CellAnalysis
let loaded: ReturnType<typeof ingestExtract>
const cellOf = (s: Snapshot, key: string) => s.cells.find((c) => c.key === key)!

beforeAll(() => {
  dataset = JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset
  before = buildSnapshot(dataset)
  // A quiet pair: forecast with the full method, balanced, no warning, nothing to do.
  target = before.cells.find((c) =>
    c.horizons['12M'].method === 'full' && c.horizons['12M'].gap.status === 'balanced' && c.horizons.current.gap.status === 'balanced'
    && c.warnings.length === 0 && c.recommendation.action === 'maintain' && (c.supply.utilizationPct ?? 0) >= 70,
  )!
  const trade = dataset.trades.find((t) => t.id === target.tradeId)!
  const district = dataset.districts.find((d) => d.id === target.districtId)!
  const sector = dataset.sectors.find((s) => s.id === target.sectorId)!
  // A new portal file for that pair only: postings in each of the last six months raised, more each month.
  const recent = target.demand.series.slice(-6)
  const rows = recent.map((m, i) => [`${m.period}-15`, trade.name, district.name, sector.name, Math.round((m.jobPostings as number) * (1.5 + 0.5 * i))])
  loaded = ingestExtract(portal, formatCsv(['posting_date', 'job_title', 'city', 'industry', 'openings'], rows), dataset, { today: dataset.meta.asOfPeriod })
  after = buildSnapshot(applyToDataset(dataset, portal, loaded, { fileName: 'more-postings.csv', loadedAt: '2026-10-05T00:00:00.000Z', loadedBy: 'chain test', mode: 'merge', synthetic: true }))
})

describe('a change in a source file reaches every step downstream', () => {
  it('finds a quiet pair to disturb, and the file for it loads cleanly', () => {
    expect(target).toBeDefined()
    expect(loaded.report).toMatchObject({ rowsRead: 6, rowsMapped: 6, rowsRejected: 0, rowsLooselyMatched: 0, pairs: 1 })
    expect(loaded.demand.every((f) => f.districtId === target.districtId && f.tradeId === target.tradeId)).toBe(true)
  })

  it('1. stored rows: the six months carry the new postings and name the load that wrote them', () => {
    const stored = cellOf(after, target.key).demand.series.slice(-6)
    const old = target.demand.series.slice(-6)
    stored.forEach((m, i) => {
      expect(m.jobPostings).toBe(loaded.demand.find((f) => f.period === m.period)!.value)
      expect(m.jobPostings as number).toBeGreaterThan(old[i].jobPostings as number)
      expect(m.employmentRegistrations).toBe(old[i].employmentRegistrations) // the other source's value is untouched
    })
    const run = after.dataset.ingestionRuns.at(-1)!
    const row = after.dataset.labourDemand.find((r) => r.districtId === target.districtId && r.tradeId === target.tradeId && r.period === dataset.meta.asOfPeriod)!
    expect(row.lineage?.jobPostings).toBe(run.id)
    expect(run.fileName).toBe('more-postings.csv')
  })

  it('2. Demand Index: the job-postings component and the index rise', () => {
    const [a, b] = [target.demand.index, cellOf(after, target.key).demand.index]
    const postings = (x: typeof a) => x.components.find((c) => c.key === 'jobPostings')!
    expect(postings(b).raw as number).toBeGreaterThan(postings(a).raw as number)
    expect(b.value as number).toBeGreaterThan(a.value as number)
    // And the index is still exactly the sum of its weighted components.
    expect(b.components.reduce((t, c) => t + (c.contribution as number), 0)).toBeCloseTo(b.value as number, 1)
  })

  it('3. forecast: the baseline, the trend and every horizon rise', () => {
    const [a, b] = [target, cellOf(after, target.key)]
    for (const key of ['3M', '6M', '12M'] as const) {
      expect(b.demandForecasts[key].predictedDemand as number, key).toBeGreaterThan(a.demandForecasts[key].predictedDemand as number)
      expect(b.demandForecasts[key].components!.baseline, key).toBeGreaterThan(a.demandForecasts[key].components!.baseline)
    }
    expect(b.demand.trendPct as number).toBeGreaterThan(a.demand.trendPct as number)
    // Supply was not in the file: seats and the supply forecast are exactly as they were.
    expect(b.supplyForecasts).toEqual(a.supplyForecasts)
  })

  it('4. gap: the gap widens and the pair moves from balanced into shortage', () => {
    const [a, b] = [target.horizons['12M'].gap, cellOf(after, target.key).horizons['12M'].gap]
    expect(b.gap as number).toBeGreaterThan(a.gap as number)
    expect(STATUS_RANK[b.status]).toBeGreaterThan(STATUS_RANK[a.status])
    expect(isShortage(b.status)).toBe(true)
    expect(b.gap).toBe((b.demand as number) - (b.supply as number))
  })

  it('5. priority: the score rises, through gap severity and demand growth', () => {
    const [a, b] = [target.priority, cellOf(after, target.key).priority]
    const part = (p: typeof a, key: string) => p.components.find((c) => c.key === key)!.contribution as number
    expect(b.score as number).toBeGreaterThan(a.score as number)
    expect(part(b, 'gapSeverity')).toBeGreaterThan(part(a, 'gapSeverity'))
    expect(part(b, 'demandGrowth')).toBeGreaterThanOrEqual(part(a, 'demandGrowth'))
  })

  it('6. early warning: a pair with none now has a shortage warning, with its evidence', () => {
    const warnings = cellOf(after, target.key).warnings
    expect(target.warnings).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => ['acute_shortage', 'upcoming_shortage', 'emerging_shortage'].includes(w.type))).toBe(true)
    for (const w of warnings) {
      expect(w.evidence.length).toBeGreaterThan(0)
      expect(w.horizonMonths).toBeGreaterThan(0)
    }
  })

  it('7. recommendation: "maintain" becomes a capacity action with a computed effect', () => {
    const r = cellOf(after, target.key).recommendation
    expect(target.recommendation).toMatchObject({ action: 'maintain', effect: null })
    expect(['increase_capacity', 'fill_seats_first']).toContain(r.action)
    expect(r.params.gap).toBe(cellOf(after, target.key).horizons['12M'].gap.gap)
    expect(r.effect?.seats as number).toBeGreaterThan(0)
  })

  it('8. screens and export: every view of the pair shows the new figures, and they agree with each other', () => {
    const f = parseFilters(new URLSearchParams(`districtId=${target.districtId}&tradeId=${target.tradeId}`), after, open)
    const cell = cellOf(after, target.key)
    const h = cell.horizons['12M']
    expect(summaryView(after, f).totals).toMatchObject({ demand: h.demand, supply: h.supply, gap: h.gap.gap, cells: 1 })
    expect(gapsView(after, f).rows[0]).toMatchObject({ demand: h.demand, gap: h.gap.gap, status: h.gap.status, priorityScore: cell.priority.score })
    expect(alertsView(after, f, planner).warnings.map((w) => w.type)).toEqual(cell.warnings.map((w) => w.type))
    expect(recommendationsView(after, f).items[0].action).toBe(cell.recommendation.action)
    const evidence = evidenceView(after, target.districtId, target.tradeId, planner)!
    expect(evidence.demandRows.at(-1)?.jobPostings).toBe(cell.demand.series.at(-1)?.jobPostings)
    expect(evidence.runs.map((r) => r.fileName)).toContain('more-postings.csv')
    const [row] = exportRows(after, 'gaps', f, { advice: true })
    expect(row).toMatchObject({ demand: h.demand, supply: h.supply, gap: h.gap.gap, gap_percentage: h.gap.gapPercentage, status: h.gap.status, priority_score: cell.priority.score, recommended_action: cell.recommendation.action })
    // The same export before the load says something else.
    const [was] = exportRows(before, 'gaps', parseFilters(new URLSearchParams(`districtId=${target.districtId}&tradeId=${target.tradeId}`), before, open), { advice: true })
    expect(was).toMatchObject({ status: 'balanced', recommended_action: 'maintain' })
    expect(row.demand as number).toBeGreaterThan(was.demand as number)
  })

  it('9. nothing else moves: every other pair keeps its forecast, gap, warnings and recommendation', () => {
    for (const c of before.cells) {
      if (c.key === target.key) continue
      const now = cellOf(after, c.key)
      expect(now.demandForecasts['12M'].predictedDemand, c.key).toBe(c.demandForecasts['12M'].predictedDemand)
      expect(now.horizons['12M'].gap, c.key).toEqual(c.horizons['12M'].gap)
      expect(now.warnings.map((w) => w.type), c.key).toEqual(c.warnings.map((w) => w.type))
      expect(now.recommendation.action, c.key).toBe(c.recommendation.action)
    }
    // Group totals move by exactly the pair's change.
    const total = (s: Snapshot) => summaryView(s, parseFilters(new URLSearchParams(''), s, open)).totals
    expect((total(after).demand as number) - (total(before).demand as number)).toBe((cellOf(after, target.key).horizons['12M'].demand as number) - (target.horizons['12M'].demand as number))
  })

  it('and the other way: lowering demand moves a shortage pair toward balance', () => {
    const short = before.cells.find((c) => c.horizons['12M'].method === 'full' && c.horizons['12M'].gap.status === 'shortage')!
    const trade = dataset.trades.find((t) => t.id === short.tradeId)!
    const district = dataset.districts.find((d) => d.id === short.districtId)!
    const rows = short.demand.series.slice(-12).map((m) => [`${m.period}-15`, trade.name, district.name, '', Math.round((m.jobPostings as number) * 0.5)])
    const file = ingestExtract(portal, formatCsv(['posting_date', 'job_title', 'city', 'industry', 'openings'], rows), dataset, { today: dataset.meta.asOfPeriod })
    const lowered = cellOf(buildSnapshot(applyToDataset(dataset, portal, file, { fileName: 'fewer.csv', loadedAt: '2026-10-05T00:00:00.000Z', loadedBy: 'chain test', mode: 'merge', synthetic: true })), short.key)
    expect(lowered.horizons['12M'].demand as number).toBeLessThan(short.horizons['12M'].demand as number)
    expect(STATUS_RANK[lowered.horizons['12M'].gap.status]).toBeLessThan(STATUS_RANK[short.horizons['12M'].gap.status])
    expect(lowered.recommendation.action).not.toBe(short.recommendation.action)
  })
})
