import { describe, expect, it } from 'vitest'
import { PRIORITY } from '@/lib/config/methodology'
import type { GapStatus, HorizonResult } from '@/lib/domain/types'
import { evaluateWarnings } from '@/lib/intelligence/alerts'
import { computeGap, isFirm } from '@/lib/intelligence/gap'
import { computePriority } from '@/lib/intelligence/priority'
import { recommend } from '@/lib/intelligence/recommendations'

const horizon = (demand: number | null, supply: number | null, key: HorizonResult['horizon'] = '12M'): HorizonResult => ({
  horizon: key, months: key === '6M' ? 6 : 12, periodStart: '2026-10', periodEnd: '2027-09',
  demand, demandLower: demand, demandUpper: demand, supply, gap: computeGap(demand, supply), firm: demand === null || supply === null ? null : true,
  confidence: demand === null ? null : { score: 80, label: 'high' }, method: demand === null ? 'insufficient_data' : 'full',
})

describe('Priority Score', () => {
  it('is the weighted sum of its five components', () => {
    // gap 56.25% → 56.25/60 = 93.75; trend 28.4% → 94.67; employment 74.6; utilisation 94; confidence 98
    const p = computePriority({ gap: computeGap(1250, 800), demandTrendPct: 28.4, employmentSignal: 74.6, utilizationPct: 94, confidenceScore: 98 })
    const expected = 0.35 * 93.75 + 0.25 * ((28.4 / 30) * 100) + 0.15 * 74.6 + 0.15 * 94 + 0.1 * 98
    expect(p.score).toBeCloseTo(expected, 1)
    expect(p.band).toBe('high')
    expect(p.direction).toBe('shortage')
    expect(p.components.map((c) => c.key)).toEqual(['gapSeverity', 'demandGrowth', 'employmentSignal', 'capacityPressure', 'forecastConfidence'])
    expect(p.components.reduce((t, c) => t + (c.contribution as number), 0)).toBeCloseTo(p.score as number, 1)
  })

  it('stays within 0–100 for any inputs', () => {
    for (const demand of [0, 10, 500, 1000, 5000, 100000]) {
      for (const trend of [-90, -10, 0, 12, 300]) {
        for (const signal of [0, 50, 100]) {
          const p = computePriority({ gap: computeGap(demand, 1000), demandTrendPct: trend, employmentSignal: signal, utilizationPct: signal, confidenceScore: signal })
          expect(p.score as number).toBeGreaterThanOrEqual(0)
          expect(p.score as number).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('measures components in the direction of the gap, so oversupply can rank too', () => {
    // 40% oversupply, demand falling 18% a year, weak employment signal, half-empty seats
    const p = computePriority({ gap: computeGap(600, 1000), demandTrendPct: -18, employmentSignal: 20, utilizationPct: 55, confidenceScore: 90 })
    expect(p.direction).toBe('oversupply')
    const byKey = Object.fromEntries(p.components.map((c) => [c.key, c.value]))
    expect(byKey.gapSeverity).toBeCloseTo((40 / 60) * 100, 1)
    expect(byKey.demandGrowth).toBe(60) // 18 / 30
    expect(byKey.employmentSignal).toBe(80) // 100 − 20
    expect(byKey.capacityPressure).toBe(45) // 100 − 55
  })

  it('gives no score when an input is missing, and names it', () => {
    const p = computePriority({ gap: computeGap(248, 180), demandTrendPct: null, employmentSignal: 41.6, utilizationPct: 78.3, confidenceScore: 35 })
    expect(p.score).toBeNull()
    expect(p.band).toBeNull()
    expect(p.missing).toEqual(['demandGrowth'])
    expect(computePriority({ gap: computeGap(null, 180), demandTrendPct: 5, employmentSignal: 40, utilizationPct: 80, confidenceScore: null }).missing).toEqual(['gapSeverity', 'forecastConfidence'])
  })

  it('bands scores with the configured cut-offs', () => {
    const at = (gapPct: number) => computePriority({ gap: computeGap(1000 + gapPct * 10, 1000), demandTrendPct: 0, employmentSignal: 0, utilizationPct: 0, confidenceScore: 0 })
    expect(at(60).score).toBe(35) // only gap severity contributes: 0.35 × 100
    expect(at(60).band).toBe('low')
    // With every other component at 100: score = 35 × severity + 65. Severity 5 ÷ 60 → 67.9, 9 ÷ 60 → 70.25.
    const withRest = (gapPct: number) => computePriority({ gap: computeGap(1000 + gapPct * 10, 1000), demandTrendPct: 30, employmentSignal: 100, utilizationPct: 100, confidenceScore: 100 })
    expect(withRest(8).score).toBeCloseTo(69.7, 1)
    expect(withRest(8).band).toBe('medium')
    expect(withRest(9).score).toBeCloseTo(70.3, 1)
    expect(withRest(9).band).toBe('medium') // 9% is inside the balanced band: capped, and it says so
    expect(withRest(9).cappedBy).toBe('balanced')
    expect(withRest(15).band).toBe('high') // a shortage with the same inputs is not capped
    expect(withRest(15).cappedBy).toBeNull()
    // Exactly on the cut-offs.
    const flat = (confidence: number) => computePriority({ gap: computeGap(1000, 1000), demandTrendPct: 30, employmentSignal: 100, utilizationPct: 100, confidenceScore: confidence })
    expect(flat(100).score).toBe(PRIORITY.bands.high - 5) // 25 + 15 + 15 + 10 = 65
    expect(flat(100).band).toBe('medium')
    const edge = computePriority({ gap: computeGap(1000, 1000), demandTrendPct: 30, employmentSignal: 100, utilizationPct: 0, confidenceScore: 50 })
    expect(edge.score).toBe(PRIORITY.bands.medium) // 25 + 15 + 0 + 5 = 45
    expect(edge.band).toBe('medium')
    expect(computePriority({ gap: computeGap(1000, 1000), demandTrendPct: 30, employmentSignal: 100, utilizationPct: 0, confidenceScore: 40 }).band).toBe('low') // 44
  })
})

describe('early-warning rules', () => {
  const ids = { key: 'warangal|solar-technician', districtId: 'warangal', sectorId: 'renewable-energy', tradeId: 'solar-technician' }
  const types = (current: HorizonResult, lookahead: HorizonResult, planning: HorizonResult, trend: number | null, capacity: number | null) =>
    evaluateWarnings({ ...ids, current, lookahead, planning, demandTrendPct: trend, capacityChangePct: capacity }).map((w) => w.type)

  it('flags an upcoming shortage when the 6-month forecast moves into shortage', () => {
    // balanced now (+10%), +25% in 6 months
    expect(types(horizon(880, 800, 'current'), horizon(500, 400, '6M'), horizon(1040, 800), 8, 2)).toContain('upcoming_shortage')
  })

  it('flags a shortage that is forecast to become severe', () => {
    const warnings = evaluateWarnings({ ...ids, current: horizon(1016, 800, 'current'), lookahead: horizon(584, 400, '6M'), planning: horizon(1250, 800), demandTrendPct: 45, capacityChangePct: 0 })
    const upcoming = warnings.find((w) => w.type === 'upcoming_shortage')
    expect(upcoming?.severity).toBe('high')
    expect(upcoming?.params).toMatchObject({ currentStatus: 'shortage', lookaheadStatus: 'severe_shortage', lookaheadGapPct: 46 })
  })

  it('flags an emerging shortage: demand rising rapidly while capacity is flat', () => {
    expect(types(horizon(820, 800, 'current'), horizon(430, 400, '6M'), horizon(900, 800), 20, 0)).toContain('emerging_shortage')
    // capacity is growing with demand → no emerging shortage
    expect(types(horizon(820, 800, 'current'), horizon(430, 400, '6M'), horizon(900, 800), 20, 18)).not.toContain('emerging_shortage')
    // demand is not rising rapidly
    expect(types(horizon(820, 800, 'current'), horizon(430, 400, '6M'), horizon(900, 800), 6, 0)).not.toContain('emerging_shortage')
  })

  it('flags oversupply risk: capacity growing while demand declines', () => {
    expect(types(horizon(900, 1000, 'current'), horizon(440, 500, '6M'), horizon(860, 1000), -8, 12)).toContain('oversupply_risk')
    expect(types(horizon(900, 1000, 'current'), horizon(440, 500, '6M'), horizon(860, 1000), 3, 12)).not.toContain('oversupply_risk')
  })

  it('flags upcoming saturation when the forecast moves into oversupply', () => {
    expect(types(horizon(900, 1000, 'current'), horizon(400, 500, '6M'), horizon(780, 1000), -10, 0)).toContain('upcoming_saturation')
  })

  it('flags acute shortage and saturation that already exist', () => {
    expect(types(horizon(1400, 1000, 'current'), horizon(700, 500, '6M'), horizon(1400, 1000), 0, 0)).toContain('acute_shortage')
    expect(types(horizon(600, 1000, 'current'), horizon(300, 500, '6M'), horizon(600, 1000), 0, 0)).toContain('saturation')
  })

  it('says monitor when the gap is closing or a balanced cell is near a threshold', () => {
    expect(types(horizon(1200, 1000, 'current'), horizon(550, 500, '6M'), horizon(1100, 1000), -4, 0)).toEqual(['monitor'])
    expect(types(horizon(1050, 1000, 'current'), horizon(560, 500, '6M'), horizon(1120, 1000), 4, 0)).toEqual(['monitor'])
  })

  it('raises nothing for a comfortably balanced cell', () => {
    expect(types(horizon(1000, 1000, 'current'), horizon(505, 500, '6M'), horizon(1010, 1000), 1, 1)).toEqual([])
  })

  it('raises no forecast-based warning when the forecast is missing', () => {
    expect(types(horizon(null, 280, 'current'), horizon(null, 140, '6M'), horizon(null, 280), null, 3)).toEqual([])
  })

  it('says a shortage deepens, not that it is coming, when the pair is already short', () => {
    const from = (current: number, soon: number) => evaluateWarnings({ ...ids, current: horizon(current, 1000, 'current'), lookahead: horizon(soon, 500, '6M'), planning: horizon(1400, 1000), demandTrendPct: 0, capacityChangePct: 0 }).find((w) => w.type === 'upcoming_shortage')
    expect(from(1000, 600)).toMatchObject({ reason: 'warning.upcoming_shortage.reason', recommendedAction: 'warning.action.planCapacity' }) // balanced → shortage
    expect(from(1200, 700)).toMatchObject({ reason: 'warning.upcoming_shortage.reason.deepening', recommendedAction: 'warning.action.planCapacityWidening' }) // shortage → severe
    const spare = evaluateWarnings({ ...ids, current: horizon(800, 1000, 'current'), lookahead: horizon(300, 500, '6M'), planning: horizon(600, 1000), demandTrendPct: 0, capacityChangePct: 0 }).find((w) => w.type === 'upcoming_saturation')
    expect(spare?.reason).toBe('warning.upcoming_saturation.reason.deepening')
  })

  it('attaches every required field to a warning', () => {
    const [w] = evaluateWarnings({ ...ids, current: horizon(1400, 1000, 'current'), lookahead: horizon(700, 500, '6M'), planning: horizon(1400, 1000), demandTrendPct: 0, capacityChangePct: 0 })
    expect(w).toMatchObject({ type: 'acute_shortage', severity: 'critical', districtId: 'warangal', sectorId: 'renewable-energy', tradeId: 'solar-technician' })
    expect(w.reason).toBe('warning.acute_shortage.reason')
    expect(w.recommendedAction).toBeTruthy()
    expect(w.evidence.length).toBeGreaterThan(0)
  })
})

describe('planner recommendations', () => {
  const base = { key: 'k', districtId: 'd', sectorId: 's', tradeId: 't', demandTrendPct: 10, capacityChangePct: 0, utilizationPct: 92, completionRatePct: 82, placementRatePct: 70, priorityScore: 80, demandDataDoubtful: false }
  const actionFor = (demand: number | null, supply: number | null, extra: Partial<typeof base> = {}) => recommend({ ...base, ...extra, planning: horizon(demand, supply) })

  it.each<[number, number, string, GapStatus]>([
    [1250, 800, 'increase_capacity', 'severe_shortage'],
    [950, 800, 'increase_capacity', 'shortage'],
    [820, 800, 'maintain', 'balanced'],
    [650, 800, 'review_allocation', 'oversupply'],
    [400, 800, 'reduce_or_redirect', 'severe_oversupply'],
  ])('demand %s against supply %s → %s', (demand, supply, action, status) => {
    const r = actionFor(demand, supply)
    expect(r.action).toBe(action)
    expect(r.status).toBe(status)
  })

  it('warns before cutting seats when part of the demand data did not arrive', () => {
    expect(actionFor(400, 800).caution).toBeNull()
    expect(actionFor(400, 800, { demandDataDoubtful: true }).caution).toBe('verify_demand_data')
    expect(actionFor(650, 800, { demandDataDoubtful: true }).caution).toBe('verify_demand_data')
    // Missing demand cannot create a shortage, so shortage actions carry no such note.
    expect(actionFor(1250, 800, { demandDataDoubtful: true }).caution).toBeNull()
    expect(actionFor(820, 800, { demandDataDoubtful: true }).caution).toBeNull()
  })

  it('marks an action tentative when the forecast interval reaches another classification', () => {
    const supply = 1000
    // Forecast 1,200 (+20%, shortage). Interval 1,160–1,240 stays a shortage; 1,100–1,300 reaches the balanced band at its low end.
    expect(isFirm(computeGap(1200, supply), 1160, 1240)).toBe(true)
    expect(isFirm(computeGap(1200, supply), 1100, 1300)).toBe(false)
    // Shortage and severe shortage are the same side: 1,400 with 1,200–1,600 is firm although the low end is only "shortage".
    expect(isFirm(computeGap(1400, supply), 1200, 1600)).toBe(true)
    // A balanced pair whose interval reaches a shortage is not firm either.
    expect(isFirm(computeGap(1100, supply), 1000, 1200)).toBe(false)
    expect(isFirm(computeGap(null, supply), null, null)).toBeNull()
    const planning = { ...horizon(1200, supply), demandLower: 1100, demandUpper: 1300, firm: false }
    expect(recommend({ ...base, planning }).tentative).toBe(true)
    expect(recommend({ ...base, planning: { ...planning, firm: true } }).tentative).toBe(false)
    // Nothing to be tentative about when no action is proposed.
    expect(recommend({ ...base, planning: { ...horizon(1050, supply), firm: false } }).tentative).toBe(false)
  })

  it('asks to fill existing seats first when they are under-used', () => {
    expect(actionFor(1250, 800, { utilizationPct: 61 }).action).toBe('fill_seats_first')
  })

  it('adds a quality review when completion or placement is weak', () => {
    expect(actionFor(1250, 800, { placementRatePct: 41 }).secondary).toBe('review_quality')
    expect(actionFor(1250, 800).secondary).toBeNull()
  })

  it('asks for data rather than guessing when the gap is unknown', () => {
    expect(actionFor(null, 800).action).toBe('collect_data')
    expect(actionFor(900, null).action).toBe('collect_data')
  })

  it('cites the figures it was derived from', () => {
    const r = actionFor(1250, 800)
    const evidence = Object.fromEntries(r.evidence.map((e) => [e.key, e.value]))
    expect(evidence).toMatchObject({ 'ev.forecastDemand': 1250, 'ev.forecastSupply': 800, 'ev.gap': 450, 'ev.gapPct': 56.25, 'ev.status': 'severe_shortage' })
    expect(r.params).toMatchObject({ gap: 450, gapPct: 56.25 })
  })
})
