import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { FORECAST, GAP_THRESHOLDS, GROUP } from '@/lib/config/methodology'
import type { Dataset, HorizonKey, Snapshot } from '@/lib/domain/types'
import { aggregateCells, combineHalfWidths, groupHeadline } from '@/lib/intelligence/aggregate'
import { confidenceFrom } from '@/lib/intelligence/forecast'
import { assessDataQuality, buildSnapshot, HORIZON_KEYS } from '@/lib/intelligence/engine'
import { classifyGap } from '@/lib/intelligence/gap'
import { sum } from '@/lib/intelligence/math'

let dataset: Dataset
let snapshot: Snapshot
const cell = (key: string) => snapshot.cells.find((c) => c.key === key)!

beforeAll(() => {
  dataset = JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset
  snapshot = buildSnapshot(dataset)
})

describe('pilot dataset', () => {
  it('is labelled as synthetic, down to each load', () => {
    expect(dataset.meta.synthetic).toBe(true)
    expect(dataset.meta.label).toMatch(/synthetic/i)
    expect(dataset.ingestionRuns.length).toBe(5)
    expect(dataset.ingestionRuns.every((r) => r.synthetic)).toBe(true)
    expect(dataset.dataSources.filter((s) => s.status === 'planned').every((s) => s.lastUpdated === null && s.recordsIn === null)).toBe(true)
    expect(dataset.dataSources.some((s) => s.status === 'uploaded')).toBe(false)
  })

  it('covers the pilot states, districts and sectors', () => {
    expect(dataset.states.map((s) => s.name).sort()).toEqual(['Karnataka', 'Maharashtra', 'Telangana'])
    expect(dataset.districts.map((d) => d.name).sort()).toEqual(['Bengaluru Urban', 'Hyderabad', 'Mysuru', 'Nagpur', 'Pune', 'Rangareddy', 'Warangal'])
    expect(dataset.sectors).toHaveLength(7)
  })

  it('has unique keys, valid references and plausible values', () => {
    const trades = new Map(dataset.trades.map((t) => [t.id, t.sectorId]))
    const districts = new Set(dataset.districts.map((d) => d.id))
    const runs = new Set(dataset.ingestionRuns.map((r) => r.id))
    const demandKeys = new Set<string>()
    for (const r of dataset.labourDemand) {
      const key = `${r.districtId}|${r.tradeId}|${r.period}`
      expect(demandKeys.has(key), key).toBe(false)
      demandKeys.add(key)
      expect(districts.has(r.districtId) && trades.get(r.tradeId) === r.sectorId, key).toBe(true)
      expect(r.period).toMatch(/^20\d\d-(0[1-9]|1[0-2])$/)
      for (const count of [r.jobPostings, r.employmentRegistrations]) expect(count === null || (Number.isInteger(count) && count >= 0), key).toBe(true)
      for (const score of [r.hiringSignal, r.industryDemandSignal]) expect(score === null || (score >= 0 && score <= 100), key).toBe(true)
      // Every stored value names the load it came from.
      for (const metric of ['jobPostings', 'hiringSignal', 'employmentRegistrations', 'industryDemandSignal'] as const) {
        expect(r[metric] === null ? r.lineage?.[metric] === undefined : runs.has(r.lineage?.[metric] as number), `${key} ${metric}`).toBe(true)
      }
    }
    const trainingKeys = new Set<string>()
    for (const r of dataset.trainingCapacity) {
      const key = `${r.districtId}|${r.tradeId}|${r.year}`
      expect(trainingKeys.has(key), key).toBe(false)
      trainingKeys.add(key)
      expect(trades.get(r.tradeId) === r.sectorId && runs.has(r.runId as number), key).toBe(true)
      expect(r.completed === null || r.completed <= (r.enrolled as number), key).toBe(true)
      expect(r.placed === null || r.placed <= (r.completed as number), key).toBe(true)
    }
  })

  it('is generated without knowledge of the engine or the mapping tables', () => {
    // The generator must not be able to steer a forecast or guarantee that its wording is recognised.
    const source = readFileSync('scripts/pilot/generate-raw.ts', 'utf8')
    expect(source).not.toMatch(/from '@\/lib\/intelligence\/(forecast|engine|normalization)/)
    expect(source).not.toMatch(/calibrat/i)
    // Consequently some of what it writes is not recognised, and the report says so.
    const portal = dataset.ingestionRuns.find((r) => r.sourceId === 'job-portals')!
    expect(portal.rowsRejected).toBeGreaterThan(0)
    expect(portal.rowsLooselyMatched).toBeGreaterThan(0)
    expect(portal.rowsMapped + portal.rowsRejected).toBe(portal.rowsRead)
  })
})

describe('demonstration scenario: Solar Technician in Warangal', () => {
  /**
   * The 12-month forecast recomputed here from the stored rows with plain
   * arithmetic, written separately from the engine. No expected number is
   * typed in: whatever the rows give is what both must agree on.
   */
  function recompute() {
    const stored = dataset.labourDemand
      .filter((r) => r.districtId === 'warangal' && r.tradeId === 'solar-technician')
      .sort((a, b) => a.period.localeCompare(b.period))
    const month = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5)) - 1
    const asOf = month(dataset.meta.asOfPeriod)
    const points = stored
      .filter((r) => r.jobPostings !== null && r.employmentRegistrations !== null)
      .map((r) => ({ t: month(r.period), y: (r.jobPostings as number) + (r.employmentRegistrations as number) }))
      .filter((p) => p.t > asOf - 12 && p.t <= asOf)
    const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const last = points.slice(-3)
    const before = points.slice(-6, -3)
    const baseline = average(last.map((p) => p.y))
    const centre = average(last.map((p) => p.t))
    const meanT = average(points.map((p) => p.t))
    const meanY = average(points.map((p) => p.y))
    const slope = points.reduce((a, p) => a + (p.t - meanT) * (p.y - meanY), 0) / points.reduce((a, p) => a + (p.t - meanT) ** 2, 0)
    const recent = (baseline - average(before.map((p) => p.y))) / (centre - average(before.map((p) => p.t)))
    let total = 0
    for (let k = 1; k <= 12; k++) {
      const distance = asOf + k - centre
      total += Math.max(0, baseline + 0.6 * slope * distance + 0.4 * recent * ((1 - 0.85 ** distance) / (1 - 0.85)))
    }
    const seats = dataset.trainingCapacity.filter((r) => r.districtId === 'warangal' && r.tradeId === 'solar-technician').sort((a, b) => a.year - b.year)
    const latest = seats[seats.length - 1]
    const changes = [seats.length - 1, seats.length - 2].map((i) => seats[i].allocatedSeats - seats[i - 1].allocatedSeats)
    return { months: points.length, demand: Math.round(total), supply: Math.round(latest.allocatedSeats + average(changes)), baseline }
  }

  it('is forecast from the stored rows: an independent recomputation gives the same figures', () => {
    const c = cell('warangal|solar-technician')
    const mine = recompute()
    const h = c.horizons['12M']
    expect(mine.months).toBe(12)
    expect(h.demand).toBe(mine.demand)
    expect(h.supply).toBe(mine.supply)
    expect(h.gap.gap).toBe(mine.demand - mine.supply)
    expect(h.gap.gapPercentage).toBeCloseTo(((mine.demand - mine.supply) / mine.supply) * 100, 2)
    expect(c.demandForecasts['12M'].components?.baseline).toBeCloseTo(mine.baseline, 2)
  })

  it('shows rising demand against flat capacity, and the engine draws the conclusions', () => {
    const c = cell('warangal|solar-technician')
    expect(c.stateId).toBe('TG')
    expect(c.sectorId).toBe('renewable-energy')
    expect(c.demand.trendPct as number).toBeGreaterThan(15)
    expect(c.supply.capacityChangePct).toBe(0)
    const h = c.horizons['12M']
    expect(h.gap.gapPercentage as number).toBeGreaterThanOrEqual(GAP_THRESHOLDS.severeShortage)
    expect(h.gap.status).toBe('severe_shortage')
    const upcoming = c.warnings.find((w) => w.type === 'upcoming_shortage')
    expect(upcoming?.params.lookaheadMonths).toBe(6)
    expect(c.warnings.map((w) => w.type)).toContain('emerging_shortage')
    expect(c.recommendation.action).toBe('increase_capacity')
    expect(c.recommendation.params).toMatchObject({ gap: h.gap.gap, gapPct: h.gap.gapPercentage })
    expect(c.priority.band).toBe('high')
  })
})

describe('every number is reproducible', () => {
  it('index values equal the sum of their weighted components', () => {
    for (const c of snapshot.cells) {
      for (const index of [c.demand.index, c.supply.index]) {
        if (index.value === null) {
          expect(index.missing.length, c.key).toBeGreaterThan(0)
          continue
        }
        expect(sum(index.components.map((x) => x.contribution as number)), c.key).toBeCloseTo(index.value, 0)
      }
    }
  })

  it('gap, gap % and classification follow from demand and supply', () => {
    for (const c of snapshot.cells) {
      for (const key of HORIZON_KEYS) {
        const h = c.horizons[key]
        if (h.demand === null || h.supply === null) {
          expect(h.gap.status, c.key).toBe('insufficient_data')
          expect(h.gap.gap).toBeNull()
          continue
        }
        expect(h.gap.gap).toBe(h.demand - h.supply)
        if (h.supply > 0) {
          const pct = ((h.demand - h.supply) / h.supply) * 100
          expect(h.gap.gapPercentage).toBeCloseTo(pct, 2)
          expect(h.gap.status).toBe(classifyGap(pct, GAP_THRESHOLDS))
        }
      }
    }
  })

  it('forecast parts add up to the forecast and stay inside the bounds', () => {
    for (const c of snapshot.cells) {
      for (const f of Object.values(c.demandForecasts)) {
        if (f.predictedDemand === null) continue
        const parts = f.parts!
        // The four parts are the forecast before rounding to whole persons (each part is kept to one decimal).
        expect(Math.abs(parts.baseline + parts.trend + parts.recentGrowth + parts.floorAdjustment - f.predictedDemand), c.key).toBeLessThanOrEqual(0.7)
        expect(f.interval!.halfWidth, c.key).toBeCloseTo(f.interval!.modelHalfWidth * f.interval!.calibrationFactor, 0)
        expect(f.lowerBound as number).toBeLessThanOrEqual(f.predictedDemand)
        expect(f.upperBound as number).toBeGreaterThanOrEqual(f.predictedDemand)
        expect(sum(f.monthly.map((m) => m.value))).toBeCloseTo(f.predictedDemand, -0.5)
      }
    }
  })

  it('priority scores are within 0–100 and equal their components', () => {
    for (const c of snapshot.cells) {
      if (c.priority.score === null) {
        expect(c.priority.missing.length, c.key).toBeGreaterThan(0)
        continue
      }
      expect(c.priority.score).toBeGreaterThanOrEqual(0)
      expect(c.priority.score).toBeLessThanOrEqual(100)
      expect(sum(c.priority.components.map((x) => x.contribution as number))).toBeCloseTo(c.priority.score, 0)
    }
  })

  it('is deterministic: building twice gives identical results', () => {
    const again = buildSnapshot(JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset)
    expect(JSON.stringify(again.cells)).toBe(JSON.stringify(snapshot.cells))
    expect(again.backtest).toEqual(snapshot.backtest)
  })
})

describe('missing data is reported, never filled in', () => {
  it('gives a baseline estimate with low confidence for a trade with 4 months of history', () => {
    const c = cell('nagpur|wind-turbine-technician')
    expect(c.demand.monthsObserved).toBe(4)
    expect(c.horizons['12M'].method).toBe('baseline_estimate')
    expect(c.horizons['12M'].confidence?.label).toBe('low')
    expect(c.demand.trendPct).toBeNull()
    expect(c.priority.score).toBeNull()
    expect(c.priority.missing).toContain('demandGrowth')
    expect(c.supply.index.value).toBeNull() // no completed cycle yet
  })

  it('gives no forecast and no gap for a trade with 2 months of history', () => {
    const c = cell('mysuru|phlebotomy-technician')
    expect(c.horizons['12M']).toMatchObject({ demand: null, method: 'insufficient_data' })
    expect(c.horizons['12M'].gap.status).toBe('insufficient_data')
    expect(c.recommendation.action).toBe('collect_data')
    expect(c.warnings).toEqual([])
  })

  it('gives no gap where there is no training capacity data', () => {
    const c = cell('warangal|digital-marketing-executive')
    expect(c.horizons['12M'].demand).not.toBeNull()
    expect(c.horizons['12M'].supply).toBeNull()
    expect(c.horizons['12M'].gap).toMatchObject({ status: 'insufficient_data', note: 'no_supply_data' })
  })

  it('gives no Demand Index when one of its signals is missing', () => {
    const c = cell('rangareddy|logistics-coordinator')
    expect(c.demand.index.value).toBeNull()
    expect(c.demand.index.missing).toEqual(['industryDemandSignal'])
    expect(c.horizons['12M'].demand).not.toBeNull() // volume signals are present, so the forecast still stands
  })
})

describe('aggregation', () => {
  const group = (cells: Snapshot['cells']) => aggregateCells(cells, snapshot.calibration)
  const total = (cells: Snapshot['cells'], key: HorizonKey) => group(cells).horizons[key]
  const by = (pick: (c: Snapshot['cells'][number]) => string) => [...new Set(snapshot.cells.map(pick))].map((id) => snapshot.cells.filter((c) => pick(c) === id))
  const groupings = () => [by((c) => c.stateId), by((c) => c.districtId), by((c) => c.sectorId), by((c) => c.tradeId)]

  it.each(HORIZON_KEYS)('%s totals add up across states, districts, sectors and trades', (key) => {
    const all = total(snapshot.cells, key)
    for (const groups of groupings().map((sets) => sets.map((cells) => total(cells, key)))) {
      expect(sum(groups.map((g) => g.demand ?? 0))).toBe(all.demand)
      expect(sum(groups.map((g) => g.supply ?? 0))).toBe(all.supply)
      expect(sum(groups.map((g) => g.shortageTotal))).toBe(all.shortageTotal)
      expect(sum(groups.map((g) => g.surplusTotal))).toBe(all.surplusTotal)
      expect(sum(groups.map((g) => g.cellsIncluded + g.cellsExcluded))).toBe(snapshot.cells.length)
    }
  })

  it('reports seats short and seats spare separately, and they add up to the net gap', () => {
    for (const cells of [snapshot.cells, ...groupings().flat()]) {
      for (const key of HORIZON_KEYS) {
        const g = total(cells, key)
        const included = cells.filter((c) => c.horizons[key].demand !== null && c.horizons[key].supply !== null)
        const gaps = (statuses: string[]) => sum(included.filter((c) => statuses.includes(c.horizons[key].gap.status)).map((c) => c.horizons[key].gap.gap as number))
        expect(g.shortageTotal).toBe(gaps(['shortage', 'severe_shortage']))
        expect(g.surplusTotal).toBe(gaps(['oversupply', 'severe_oversupply']))
        expect(g.shortagePairs).toBe(g.statusCounts.shortage + g.statusCounts.severe_shortage)
        expect(g.oversupplyPairs).toBe(g.statusCounts.oversupply + g.statusCounts.severe_oversupply)
        if (g.netGap !== null) expect(g.shortageTotal + g.surplusTotal + g.balancedNet).toBe(g.netGap)
      }
    }
  })

  it('never calls a group balanced while one of its pairs is in shortage or oversupply', () => {
    for (const cells of [snapshot.cells, ...groupings().flat()]) {
      for (const key of HORIZON_KEYS) {
        const g = total(cells, key)
        if (cells.length === 1) continue
        if (g.headline === 'balanced') expect(g.shortagePairs + g.oversupplyPairs).toBe(0)
        if (g.shortagePairs + g.oversupplyPairs > 0) expect(['mostly_shortage', 'mostly_oversupply', 'mixed', 'largely_balanced']).toContain(g.headline)
        const material = ((g.supply ?? 0) * GROUP.materialSharePct) / 100
        if (g.headline === 'mostly_shortage') { expect(g.shortageTotal).toBeGreaterThanOrEqual(material); expect(Math.abs(g.surplusTotal)).toBeLessThan(material) }
        if (g.headline === 'mostly_oversupply') { expect(Math.abs(g.surplusTotal)).toBeGreaterThanOrEqual(material); expect(g.shortageTotal).toBeLessThan(material) }
        if (g.headline === 'mixed') { expect(g.shortageTotal).toBeGreaterThanOrEqual(material); expect(Math.abs(g.surplusTotal)).toBeGreaterThanOrEqual(material) }
      }
    }
    // The case that used to be hidden: the pilot as a whole nets close to zero but is far from balanced.
    const all = total(snapshot.cells, '12M')
    expect(all.shortagePairs).toBeGreaterThan(10)
    expect(all.headline).not.toBe('balanced')
  })

  it('decides the headline from the two gross figures', () => {
    // Against 10,000 seats, 2% is 200: that is what counts as material.
    const some = { classified: 5, outside: 2 }
    expect(groupHeadline(900, -100, 10000, some)).toBe('mostly_shortage')
    expect(groupHeadline(100, -900, 10000, some)).toBe('mostly_oversupply')
    expect(groupHeadline(500, -400, 10000, some)).toBe('mixed')
    expect(groupHeadline(900, -200, 10000, some)).toBe('mixed') // 200 spare is exactly material, however large the other side
    expect(groupHeadline(900, -199, 10000, some)).toBe('mostly_shortage')
    // 30 short and 10 spare out of 10,000 is not "mostly shortage" of anything.
    expect(groupHeadline(30, -10, 10000, some)).toBe('largely_balanced')
    expect(groupHeadline(0, 0, 10000, { classified: 5, outside: 0 })).toBe('balanced')
    expect(groupHeadline(0, 0, null, { classified: 0, outside: 0 })).toBe('insufficient_data')
    // A shortage against no seats at all is always material.
    expect(groupHeadline(40, 0, 0, { classified: 1, outside: 1 })).toBe('mostly_shortage')
  })

  it('gives a group the priority of its highest pair, never a blended score', () => {
    for (const cells of [snapshot.cells, ...groupings().flat()]) {
      const g = group(cells)
      const scores = cells.map((c) => c.priority.score).filter((x): x is number => x !== null)
      expect(g.priority.peak?.score ?? null).toBe(scores.length ? Math.max(...scores) : null)
      expect(g.priority.highPairs).toBe(cells.filter((c) => c.priority.band === 'high').length)
      expect(g.priority.highPairs + g.priority.mediumPairs + g.priority.lowPairs + g.priority.unscoredPairs).toBe(cells.length)
      if (g.priority.peakKey) expect(cells.find((c) => c.key === g.priority.peakKey)?.priority).toEqual(g.priority.peak)
    }
  })

  it('derives a group\'s confidence from its own interval', () => {
    for (const key of ['3M', '6M', '12M'] as const) {
      for (const cells of groupings().flat().filter((x) => x.length > 1)) {
        const g = total(cells, key)
        if (g.demand === null || g.halfWidth === null) continue
        const weak = sum(cells.filter((c) => c.horizons[key].demand !== null && c.horizons[key].supply !== null && c.horizons[key].method !== 'full').map((c) => c.horizons[key].demand as number))
        expect(g.confidence).toEqual(confidenceFrom(g.demand, g.halfWidth, weak > GROUP.shortHistoryShare * g.demand ? 'limited_history' : 'full'))
        expect((g.demandUpper as number) - g.demand).toBeCloseTo(g.halfWidth, -0.5)
        // Between the independent case and the fully correlated case.
        const halves = cells.filter((c) => c.horizons[key].demand !== null && c.horizons[key].supply !== null).map((c) => (c.horizons[key].demandUpper as number) - (c.horizons[key].demand as number))
        expect(g.halfWidth).toBeGreaterThanOrEqual(combineHalfWidths(halves, 0) - 0.1)
        expect(g.halfWidth).toBeLessThanOrEqual(combineHalfWidths(halves, 1) + 0.1)
      }
    }
    expect(combineHalfWidths([3, 4], 0)).toBe(5) // independent: quadrature
    expect(combineHalfWidths([3, 4], 1)).toBe(7) // in step: they add
    expect(combineHalfWidths([3, 4], 0.5)).toBeCloseTo(Math.sqrt(0.5 * 25 + 0.5 * 49), 10)
  })

  it('does not give a group high confidence when most of its demand is forecast without the full method', () => {
    for (const cells of groupings().flat().filter((x) => x.length > 1)) {
      const g = total(cells, '12M')
      if (g.demand === null || g.confidence === null) continue
      const weak = sum(cells.filter((c) => c.horizons['12M'].demand !== null && c.horizons['12M'].supply !== null && c.horizons['12M'].method !== 'full').map((c) => c.horizons['12M'].demand as number))
      if (weak > GROUP.shortHistoryShare * g.demand) expect(g.confidence.score).toBeLessThanOrEqual(FORECAST.confidence.capLimitedHistory)
    }
    const mysuru = total(snapshot.cells.filter((c) => c.districtId === 'mysuru'), '12M')
    expect(mysuru.confidence?.label).not.toBe('high')
  })

  it('leaves out pairs with missing data and says how many', () => {
    const all = total(snapshot.cells, '12M')
    const missing = snapshot.cells.filter((c) => c.horizons['12M'].demand === null || c.horizons['12M'].supply === null).length
    expect(missing).toBeGreaterThan(0)
    expect(all.cellsExcluded).toBe(missing)
    expect(all.cellsIncluded + all.cellsExcluded).toBe(snapshot.cells.length)
    expect(sum(Object.values(all.statusCounts))).toBe(snapshot.cells.length)
    expect(all.statusCounts.insufficient_data).toBe(missing)
  })

  it('returns the pair itself when a group has one member', () => {
    const c = cell('warangal|solar-technician')
    const g = group([c])
    const h = c.horizons['12M']
    expect(g.horizons['12M']).toMatchObject({ demand: h.demand, supply: h.supply, netGap: h.gap.gap, netGapPercentage: h.gap.gapPercentage, headline: h.gap.status, confidence: h.confidence })
    expect(g.demandIndex).toMatchObject({ value: c.demand.index.value, averaged: false })
    expect(g.priority.peak).toEqual(c.priority)
    expect(g.demandTrendPct).toBe(c.demand.trendPct)
    // Every pair, every horizon: a group of one shows that pair's own interval, to the person.
    for (const one of snapshot.cells) {
      for (const key of HORIZON_KEYS) {
        const x = aggregateCells([one], snapshot.calibration).horizons[key]
        expect([x.demandLower, x.demandUpper], `${one.key} ${key}`).toEqual([one.horizons[key].demandLower, one.horizons[key].demandUpper])
      }
    }
  })

  it('averages pair indices by size for a group and says that it did', () => {
    const cells = snapshot.cells.filter((c) => c.tradeId === 'solar-technician' && c.demand.index.value !== null)
    const weights = cells.map((c) => c.demand.monthlyRunRate as number)
    const expected = sum(cells.map((c, i) => (c.demand.index.value as number) * weights[i])) / sum(weights)
    const index = group(cells).demandIndex
    expect(index.value).toBeCloseTo(expected, 1)
    expect(index.averaged).toBe(true)
    // No scaling reference is claimed for a figure that was not scaled.
    expect(index.components.every((x) => x.reference === null)).toBe(true)
    expect(sum(index.components.map((x) => x.contribution as number))).toBeCloseTo(index.value as number, 0)
  })
})

describe('backtest and interval calibration', () => {
  it('tests many forecast start months per pair for each horizon', () => {
    expect(snapshot.backtest.map((b) => b.horizon)).toEqual(['3M', '6M', '12M'])
    for (const b of snapshot.backtest) {
      expect(b.cells).toBeGreaterThan(70)
      expect(b.samples).toBeGreaterThanOrEqual(b.cells)
      expect(b.wape as number).toBeGreaterThan(0)
      expect(b.pctErrorAtCoverage as number).toBeGreaterThanOrEqual(b.medianApe as number)
      expect(b.calibrationFactor as number).toBeGreaterThanOrEqual(FORECAST.calibration.minFactor)
      // Reported as measured, negative or not; what group totals use is never below the stated minimum.
      expect(b.errorCorrelation as number).toBeGreaterThanOrEqual(-1)
      expect(b.errorCorrelation as number).toBeLessThanOrEqual(1)
      expect(snapshot.calibration[b.horizon].measuredCorrelation).toBe(b.errorCorrelation)
      expect(snapshot.calibration[b.horizon].errorCorrelation).toBe(Math.max(GROUP.minErrorCorrelation, b.errorCorrelation as number))
    }
    expect(snapshot.backtest[0].origins).toBeGreaterThan(snapshot.backtest[2].origins) // shorter horizons leave room for more start months
  })

  it('checks the interval forward in time where the history allows, and says where it does not', () => {
    const [three, six, twelve] = snapshot.backtest
    // 3 and 6 months: the factor was set only on forecasts whose outcome was already known.
    for (const b of [three, six]) {
      expect(b.holdoutSamples, b.horizon).toBeGreaterThanOrEqual(snapshot.cells.length / 2)
      expect(b.holdoutCoverage as number, b.horizon).toBeGreaterThan(0)
      expect(b.holdoutCoverage as number, b.horizon).toBeLessThanOrEqual(100)
    }
    // 12 months on a 24-month history: one start month, nothing earlier to learn from. Not checked, and reported as such.
    expect(twelve.origins).toBe(1)
    expect(twelve.holdoutCoverage).toBeNull()
    expect(twelve.holdoutSamples).toBe(0)
  })

  it('does not let a sum of many pairs look certain just because the pairs were generated independently', () => {
    const all = aggregateCells(snapshot.cells, snapshot.calibration).horizons['12M']
    const halves = snapshot.cells.filter((c) => c.horizons['12M'].demand !== null && c.horizons['12M'].supply !== null).map((c) => (c.horizons['12M'].demandUpper as number) - (c.horizons['12M'].demand as number))
    expect(all.halfWidth as number).toBeGreaterThan(1.5 * combineHalfWidths(halves, 0))
  })

  it('gives different pairs different confidence at the same horizon', () => {
    for (const key of ['3M', '6M', '12M'] as const) {
      const scores = snapshot.cells.map((c) => c.horizons[key].confidence?.score).filter((x): x is number => x !== undefined)
      const counts = new Map<number, number>()
      for (const score of scores) counts.set(score, (counts.get(score) ?? 0) + 1)
      expect(counts.size, key).toBeGreaterThan(10)
      // No single value covers most pairs: confidence is not one number per horizon.
      expect(Math.max(...counts.values()) / scores.length, key).toBeLessThan(0.25)
      const labels = new Set(snapshot.cells.map((c) => c.horizons[key].confidence?.label))
      expect(labels.has('high') && labels.has('medium'), key).toBe(true)
    }
  })

  it('makes the confidence part of the priority score vary with it', () => {
    const contributions = new Set(snapshot.cells.map((c) => c.priority.components.find((x) => x.key === 'forecastConfidence')?.contribution).filter((x) => x !== null && x !== undefined))
    expect(contributions.size).toBeGreaterThan(10)
  })

  it('applies the measured factor to every pair\'s own model interval', () => {
    for (const c of snapshot.cells) {
      for (const key of ['3M', '6M', '12M'] as const) {
        const f = c.demandForecasts[key]
        if (!f.interval) continue
        expect(f.interval.calibrationFactor).toBeCloseTo(snapshot.calibration[key].factor, 3)
      }
    }
  })
})

describe('classifications and the forecast interval', () => {
  it('says for every pair whether its classification holds at both ends of its interval, and totals the ones that do', () => {
    const all = aggregateCells(snapshot.cells, snapshot.calibration).horizons['12M']
    const side = (pct: number | null) => (pct === null ? null : pct >= GAP_THRESHOLDS.shortage ? 'shortage' : pct <= GAP_THRESHOLDS.oversupply ? 'oversupply' : 'balanced')
    let firmShort = 0
    for (const c of snapshot.cells) {
      const h = c.horizons['12M']
      if (h.demandLower === null || h.demandUpper === null || h.supply === null || !h.supply) continue
      const at = (demand: number) => side(((demand - (h.supply as number)) / (h.supply as number)) * 100)
      expect(h.firm, c.key).toBe(at(h.demandLower) === at(h.demand as number) && at(h.demandUpper) === at(h.demand as number))
      if (h.firm && at(h.demand as number) === 'shortage') firmShort += 1
    }
    expect(all.firmShortagePairs).toBe(firmShort)
    expect(all.firmShortagePairs).toBeLessThanOrEqual(all.shortagePairs)
    expect(all.firmShortageTotal).toBeLessThanOrEqual(all.shortageTotal)
    expect(Math.abs(all.firmSurplusTotal)).toBeLessThanOrEqual(Math.abs(all.surplusTotal))
    // "Current" has no interval, so nothing is called firm or not.
    expect(snapshot.cells.every((c) => c.horizons.current.firm === null)).toBe(true)
    for (const c of snapshot.cells) expect(c.recommendation.tentative, c.key).toBe((c.horizons['12M'].firm === false || c.horizons['12M'].confidence?.label === 'low') && ['increase_capacity', 'fill_seats_first', 'review_allocation', 'reduce_or_redirect'].includes(c.recommendation.action))
  })

})

describe('data quality', () => {
  const run = (over: Partial<Dataset['ingestionRuns'][number]>): Dataset['ingestionRuns'][number] => ({
    id: 1, sourceId: 'job-portals', fileName: 'f.csv', loadedAt: '2026-10-01T00:00:00Z', loadedBy: null, mode: 'replace', synthetic: true,
    rowsRead: 100, rowsMapped: 100, rowsRejected: 0, rowsLooselyMatched: 0, rowsHeld: 0, looseMatches: 'hold', valueRead: 1000, valueMapped: 1000,
    periodMin: null, periodMax: null, rejects: [], rejectKinds: 0, looseMatchList: [], looseKinds: 0, ...over,
  })
  const quality = (runs: Dataset['ingestionRuns']) => assessDataQuality({ ...dataset, ingestionRuns: runs })

  it('flags a source that lost a material share of its volume on the way in', () => {
    expect(quality([run({})])).toMatchObject({ flagged: false, sources: [{ sharePct: 100, flagged: false }] })
    expect(quality([run({ valueMapped: 950 })]).flagged).toBe(false) // exactly at the threshold
    expect(quality([run({ valueMapped: 949 })]).flagged).toBe(true)
  })

  it('flags one rejected value that carries a large share, even when the total looks fine', () => {
    const one = (value: number) => quality([run({ valueMapped: 1000 - value, rejects: [{ reason: 'place_unknown', example: 'Mysooru', count: 3, value }] })])
    expect(one(9).flagged).toBe(false)
    expect(one(10)).toMatchObject({ flagged: true, sources: [{ largeRejects: 1 }] }) // 1% of 1,000
  })

  it('counts every load since the source was last replaced: a clean file on top does not clear an earlier loss', () => {
    const lossy = run({ id: 1, valueMapped: 500, rowsMapped: 50 })
    const clean = (id: number, mode: 'merge' | 'replace') => run({ id, mode, rowsRead: 1, rowsMapped: 1, valueRead: 10, valueMapped: 10 })
    expect(quality([lossy, clean(2, 'merge')]).sources[0]).toMatchObject({ runId: 2, loads: 2, valueRead: 1010, valueMapped: 510, flagged: true })
    // Replacing the source removes the lossy rows from the dataset, and only then does the flag go.
    expect(quality([lossy, clean(2, 'replace')]).sources[0]).toMatchObject({ runId: 2, loads: 1, sharePct: 100, flagged: false })
  })

  it('sees rows lost for an unreadable value, which carry no volume, through the row count', () => {
    // 5 rows, 4 rejected because the number could not be read: the volume read and mapped are both 10.
    const q = quality([run({ rowsRead: 5, rowsMapped: 1, rowsRejected: 4, valueRead: 10, valueMapped: 10 })])
    expect(q.sources[0]).toMatchObject({ sharePct: 100, rowSharePct: 20, flagged: true })
    // Sources that carry 0–100 scores have no volume and are judged on rows alone.
    const scores = quality([run({ sourceId: 'industry-survey', valueRead: null, valueMapped: null, rowsMapped: 90 })])
    expect(scores.sources[0]).toMatchObject({ sharePct: null, rowSharePct: 90, flagged: true })
  })

  it('says so on the pilot itself, and attaches a caution to every oversupply action and to no other', () => {
    // The synthetic portal extract contains titles the mapping table does not know, on purpose.
    expect(snapshot.dataQuality.flagged).toBe(true)
    const portal = snapshot.dataQuality.sources.find((s) => s.sourceId === 'job-portals')!
    const loaded = dataset.ingestionRuns.find((r) => r.id === portal.runId)!
    expect(portal.sharePct).toBeCloseTo(((loaded.valueMapped as number) / (loaded.valueRead as number)) * 100, 1)
    for (const c of snapshot.cells) {
      const oversupplied = ['oversupply', 'severe_oversupply'].includes(c.horizons['12M'].gap.status)
      expect(c.recommendation.caution, c.key).toBe(oversupplied ? 'verify_demand_data' : null)
    }
  })
})
