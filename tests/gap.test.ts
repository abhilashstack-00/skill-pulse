import { describe, expect, it } from 'vitest'
import { GAP_THRESHOLDS } from '@/lib/config/methodology'
import { classifyGap, computeGap } from '@/lib/intelligence/gap'

describe('gap calculation', () => {
  it('matches the worked example: demand 1,850 against supply 1,200', () => {
    const result = computeGap(1850, 1200)
    expect(result.gap).toBe(650)
    expect(result.gapPercentage).toBeCloseTo(54.17, 2) // 54.166…%
    expect(result.status).toBe('severe_shortage')
  })

  it('matches the demo scenario: demand 1,250 against 800 seats', () => {
    expect(computeGap(1250, 800)).toMatchObject({ gap: 450, gapPercentage: 56.25, status: 'severe_shortage' })
  })

  it('gives a negative gap when supply exceeds demand', () => {
    expect(computeGap(700, 1000)).toMatchObject({ gap: -300, gapPercentage: -30, status: 'severe_oversupply' })
  })

  it('reports insufficient data instead of a number when an input is missing', () => {
    expect(computeGap(null, 800)).toMatchObject({ gap: null, gapPercentage: null, status: 'insufficient_data', note: 'no_demand_forecast' })
    expect(computeGap(900, null)).toMatchObject({ gap: null, gapPercentage: null, status: 'insufficient_data', note: 'no_supply_data' })
  })

  it('does not divide by zero supply', () => {
    expect(computeGap(120, 0)).toMatchObject({ gap: 120, gapPercentage: null, status: 'severe_shortage', note: 'zero_supply' })
    expect(computeGap(0, 0)).toMatchObject({ gap: 0, gapPercentage: null, status: 'balanced', note: 'zero_supply' })
  })
})

describe('classification thresholds (prototype, configurable)', () => {
  it('uses the documented thresholds', () => {
    expect(GAP_THRESHOLDS).toEqual({ severeShortage: 30, shortage: 15, oversupply: -15, severeOversupply: -30 })
  })

  it.each([
    [45, 'severe_shortage'],
    [30, 'severe_shortage'],
    [29.99, 'shortage'],
    [15, 'shortage'],
    [14.99, 'balanced'],
    [0, 'balanced'],
    [-14.99, 'balanced'],
    [-15, 'oversupply'],
    [-29.99, 'oversupply'],
    [-30, 'severe_oversupply'],
    [-80, 'severe_oversupply'],
  ])('%s%% is %s', (pct, status) => {
    expect(classifyGap(pct)).toBe(status)
  })

  it('follows the thresholds it is given', () => {
    expect(classifyGap(20, { severeShortage: 50, shortage: 25, oversupply: -25, severeOversupply: -50 })).toBe('balanced')
  })
})
