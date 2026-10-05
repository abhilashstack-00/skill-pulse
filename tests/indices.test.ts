import { describe, expect, it } from 'vitest'
import { DEMAND_INDEX, PRIORITY, SUPPLY_INDEX } from '@/lib/config/methodology'
import { computeDemandIndex, normalizeDemandComponents, weightedIndex } from '@/lib/intelligence/demand-index'
import { scaleCount, sum } from '@/lib/intelligence/math'
import { computeSupplyIndex, supplyRates } from '@/lib/intelligence/supply-index'

const total = (weights: Record<string, number>) => sum(Object.values(weights))

describe('weights', () => {
  it('each set of weights totals 100%', () => {
    expect(total(DEMAND_INDEX.weights)).toBeCloseTo(1, 10)
    expect(total(SUPPLY_INDEX.weights)).toBeCloseTo(1, 10)
    expect(total(PRIORITY.weights)).toBeCloseTo(1, 10)
  })

  it('uses the weights stated in the methodology', () => {
    expect(DEMAND_INDEX.weights).toEqual({ jobPostings: 0.4, hiringSignal: 0.25, employmentRegistrations: 0.2, industryDemandSignal: 0.15 })
    expect(SUPPLY_INDEX.weights).toEqual({ seats: 0.4, utilization: 0.25, completion: 0.2, placement: 0.15 })
    expect(PRIORITY.weights).toEqual({ gapSeverity: 0.35, demandGrowth: 0.25, employmentSignal: 0.15, capacityPressure: 0.15, forecastConfidence: 0.1 })
  })
})

describe('Demand Index', () => {
  it('is the weighted sum of the four normalised components', () => {
    // 0.40×78 + 0.25×82 + 0.20×64 + 0.15×71 = 31.2 + 20.5 + 12.8 + 10.65 = 75.15
    const result = weightedIndex({ jobPostings: 78, hiringSignal: 82, employmentRegistrations: 64, industryDemandSignal: 71 }, DEMAND_INDEX.weights)
    expect(result.components.map((c) => c.contribution)).toEqual([31.2, 20.5, 12.8, 10.65])
    expect(sum(result.components.map((c) => c.contribution as number))).toBeCloseTo(75.15, 10)
    expect(result.value).toBeCloseTo(75.15, 1)
    expect(result.missing).toEqual([])
  })

  it('changes when a weight changes (guards the formula)', () => {
    const inputs = { jobPostings: 78, hiringSignal: 82, employmentRegistrations: 64, industryDemandSignal: 71 }
    const altered = weightedIndex(inputs, { ...DEMAND_INDEX.weights, jobPostings: 0.5, hiringSignal: 0.15 })
    expect(altered.value).not.toBeCloseTo(75.15, 1)
  })

  it('returns no value when a component is missing, and names it', () => {
    const result = computeDemandIndex(
      { jobPostings: 120, hiringSignal: 70, employmentRegistrations: 40, industryDemandSignal: null },
      { jobPostings: 300, employmentRegistrations: 100 },
    )
    expect(result.value).toBeNull()
    expect(result.missing).toEqual(['industryDemandSignal'])
  })

  it('scales counts to 0–100 against the reference and leaves scores as they are', () => {
    const n = normalizeDemandComponents(
      { jobPostings: 300, hiringSignal: 82, employmentRegistrations: 0, industryDemandSignal: 130 },
      { jobPostings: 300, employmentRegistrations: 100 },
    )
    expect(n.jobPostings).toBeCloseTo(100, 10)
    expect(n.hiringSignal).toBe(82)
    expect(n.employmentRegistrations).toBe(0)
    expect(n.industryDemandSignal).toBe(100) // scores are clamped to the scale
  })

  it('keeps the raw inputs next to the normalised ones', () => {
    const result = computeDemandIndex({ jobPostings: 57, hiringSignal: 90, employmentRegistrations: 30, industryDemandSignal: 80 }, { jobPostings: 295, employmentRegistrations: 107 })
    const postings = result.components.find((c) => c.key === 'jobPostings')
    expect(postings?.raw).toBe(57)
    expect(postings?.reference).toBe(295)
    expect(postings?.normalized).toBeCloseTo((100 * Math.log1p(57)) / Math.log1p(295), 1)
  })
})

describe('count scaling', () => {
  it('is 0 at 0, 100 at the reference, capped above it, and increasing in between', () => {
    expect(scaleCount(0, 200)).toBe(0)
    expect(scaleCount(200, 200)).toBeCloseTo(100, 10)
    expect(scaleCount(5000, 200)).toBe(100)
    expect(scaleCount(50, 200)).toBeLessThan(scaleCount(100, 200))
  })

  it('is 0 when there is no reference to scale against', () => {
    expect(scaleCount(40, 0)).toBe(0)
  })
})

describe('Supply Index', () => {
  const raw = { seats: 800, enrolled: 752, outcomesEnrolled: 752, completed: 620, placed: 465 }

  it('derives rates from the raw figures without altering them', () => {
    const rates = supplyRates(raw)
    expect(rates.utilizationPct).toBeCloseTo(94, 10)
    expect(rates.completionRatePct).toBeCloseTo((620 / 752) * 100, 10)
    expect(rates.placementRatePct).toBeCloseTo(75, 10)
    expect(raw).toEqual({ seats: 800, enrolled: 752, outcomesEnrolled: 752, completed: 620, placed: 465 })
  })

  it('is 0.40 seats + 0.25 utilisation + 0.20 completion + 0.15 placement', () => {
    const result = computeSupplyIndex(raw, 800)
    // seats scale to 100 at the reference
    const expected = 0.4 * 100 + 0.25 * 94 + 0.2 * ((620 / 752) * 100) + 0.15 * 75
    expect(result.value).toBeCloseTo(expected, 1)
    expect(result.components.find((c) => c.key === 'seats')?.raw).toBe(800)
  })

  it('returns no value when outcomes are not yet known', () => {
    const result = computeSupplyIndex({ seats: 180, enrolled: 141, outcomesEnrolled: null, completed: null, placed: null }, 800)
    expect(result.value).toBeNull()
    expect(result.missing).toEqual(['completion', 'placement'])
  })

  it('does not divide by zero', () => {
    expect(supplyRates({ seats: 0, enrolled: 0, outcomesEnrolled: 0, completed: 0, placed: 0 })).toEqual({ utilizationPct: null, completionRatePct: null, placementRatePct: null })
  })
})
