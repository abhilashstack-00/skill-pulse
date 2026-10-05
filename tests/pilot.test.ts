import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { GAP_THRESHOLDS } from '@/lib/config/methodology'
import type { Dataset, HorizonKey, Snapshot } from '@/lib/domain/types'
import { aggregateCells } from '@/lib/intelligence/aggregate'
import { buildSnapshot, HORIZON_KEYS } from '@/lib/intelligence/engine'
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
  it('is labelled as synthetic', () => {
    expect(dataset.meta.synthetic).toBe(true)
    expect(dataset.meta.label).toMatch(/synthetic/i)
    for (const row of dataset.labourDemand.slice(0, 50)) expect(row.source).toMatch(/synthetic/)
    expect(dataset.dataSources.filter((s) => s.status === 'planned').every((s) => s.lastUpdated === null && s.recordsIn === null)).toBe(true)
  })

  it('covers the pilot states, districts and sectors', () => {
    expect(dataset.states.map((s) => s.name).sort()).toEqual(['Karnataka', 'Maharashtra', 'Telangana'])
    expect(dataset.districts.map((d) => d.name).sort()).toEqual(['Bengaluru Urban', 'Hyderabad', 'Mysuru', 'Nagpur', 'Pune', 'Rangareddy', 'Warangal'])
    expect(dataset.sectors).toHaveLength(7)
  })
})

describe('demo scenario: Solar Technician in Warangal', () => {
  it('comes out of the engine, not out of the interface', () => {
    const c = cell('warangal|solar-technician')
    expect(c.stateId).toBe('TG')
    expect(c.sectorId).toBe('renewable-energy')
    expect(c.supply.seats).toBe(800)
    const h = c.horizons['12M']
    expect(h.demand).toBe(1250)
    expect(h.supply).toBe(800)
    expect(h.gap).toMatchObject({ gap: 450, gapPercentage: 56.25, status: 'severe_shortage' })
    expect(c.demand.trendPct as number).toBeGreaterThan(15) // demand trend: increasing
    expect(c.supply.capacityChangePct).toBe(0) // capacity flat
  })

  it('raises the early warning and the recommendation from that evidence', () => {
    const c = cell('warangal|solar-technician')
    const upcoming = c.warnings.find((w) => w.type === 'upcoming_shortage')
    expect(upcoming).toBeDefined()
    expect(upcoming?.params.lookaheadMonths).toBe(6)
    expect(c.warnings.map((w) => w.type)).toContain('emerging_shortage')
    expect(c.recommendation.action).toBe('increase_capacity')
    expect(c.recommendation.params).toMatchObject({ gap: 450, gapPct: 56.25 })
    expect(c.priority.band).toBe('high')
  })

  it('has a forecast that can be rebuilt from stored monthly data', () => {
    const c = cell('warangal|solar-technician')
    const f = c.demandForecasts['12M']
    const stored = dataset.labourDemand.filter((r) => r.districtId === 'warangal' && r.tradeId === 'solar-technician')
    expect(stored).toHaveLength(24)
    const lastThree = stored.slice(-3).map((r) => (r.jobPostings as number) + (r.employmentRegistrations as number))
    expect(f.components?.baseline).toBeCloseTo(sum(lastThree) / 3, 2)
    expect((f.parts?.baseline as number) + (f.parts?.trend as number) + (f.parts?.recentGrowth as number)).toBeCloseTo(1250, 0)
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
        expect(parts.baseline + parts.trend + parts.recentGrowth, c.key).toBeCloseTo(f.predictedDemand, -0.5)
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
  const total = (cells: Snapshot['cells'], key: HorizonKey) => aggregateCells(cells).horizons[key]

  it.each(HORIZON_KEYS)('%s totals add up across states, districts, sectors and trades', (key) => {
    const all = total(snapshot.cells, key)
    const by = (pick: (c: Snapshot['cells'][number]) => string) =>
      [...new Set(snapshot.cells.map(pick))].map((id) => total(snapshot.cells.filter((c) => pick(c) === id), key))
    for (const groups of [by((c) => c.stateId), by((c) => c.districtId), by((c) => c.sectorId), by((c) => c.tradeId)]) {
      expect(sum(groups.map((g) => g.demand ?? 0))).toBe(all.demand)
      expect(sum(groups.map((g) => g.supply ?? 0))).toBe(all.supply)
      expect(sum(groups.map((g) => g.shortageTotal))).toBe(all.shortageTotal)
      expect(sum(groups.map((g) => g.surplusTotal))).toBe(all.surplusTotal)
      expect(sum(groups.map((g) => g.cellsIncluded + g.cellsExcluded))).toBe(snapshot.cells.length)
    }
  })

  it('leaves out pairs with missing data and says how many', () => {
    const all = total(snapshot.cells, '12M')
    expect(all.cellsExcluded).toBe(2)
    expect(all.cellsIncluded + all.cellsExcluded).toBe(snapshot.cells.length)
    expect(sum(Object.values(all.statusCounts))).toBe(snapshot.cells.length)
    expect(all.statusCounts.insufficient_data).toBe(2)
    expect((all.shortageTotal as number) + (all.surplusTotal as number)).toBe(all.gap.gap)
  })

  it('returns the pair itself when a group has one member', () => {
    const c = cell('warangal|solar-technician')
    const group = aggregateCells([c])
    expect(group.horizons['12M'].gap).toEqual(c.horizons['12M'].gap)
    expect(group.demandIndex.value).toBe(c.demand.index.value)
    expect(group.priority).toEqual(c.priority)
  })

  it('weights the group Demand Index by demand volume', () => {
    const cells = snapshot.cells.filter((c) => c.tradeId === 'solar-technician' && c.demand.index.value !== null)
    const weights = cells.map((c) => c.demand.monthlyRunRate as number)
    const expected = sum(cells.map((c, i) => (c.demand.index.value as number) * weights[i])) / sum(weights)
    expect(aggregateCells(cells).demandIndex.value).toBeCloseTo(expected, 1)
  })
})

describe('backtest', () => {
  it('measures forecast error on held-back months for each horizon', () => {
    expect(snapshot.backtest.map((b) => b.horizon)).toEqual(['3M', '6M', '12M'])
    for (const b of snapshot.backtest) {
      expect(b.cells).toBeGreaterThan(80)
      expect(b.wape as number).toBeGreaterThan(0)
      expect(b.p80Ape as number).toBeGreaterThanOrEqual(b.medianApe as number)
    }
  })

  it('never states an interval narrower than the measured error', () => {
    for (const c of snapshot.cells) {
      for (const key of ['3M', '6M', '12M'] as const) {
        const f = c.demandForecasts[key]
        if (f.predictedDemand === null || f.predictedDemand === 0) continue
        const half = (f.upperBound as number) - f.predictedDemand
        expect(half + 1, c.key).toBeGreaterThanOrEqual(snapshot.intervalCalibration[key] * f.predictedDemand)
      }
    }
  })
})
