import { describe, expect, it } from 'vitest'
import { matchDistrict, matchSector, matchTrade, normalizeDemand, normalizePeriod, normalizeTraining, normalizeTrainingYear, type RawDemandRecord } from '@/lib/intelligence/normalization/normalize'

const sectorOfTrade = new Map([['software-developer', 'it-digital'], ['solar-technician', 'renewable-energy']])

describe('occupation, place, sector and time mapping', () => {
  it('maps different titles for the same occupation to one trade', () => {
    for (const title of ['Software Engineer', 'Software Developer', 'Frontend Developer', 'Senior Software Engineer', 'software  developer (Urgent)']) {
      expect(matchTrade(title)).toBe('software-developer')
    }
    expect(matchTrade('Solar PV Installer')).toBe('solar-technician')
  })

  it('prefers the NCO code when a source provides one', () => {
    expect(matchTrade('Technician (general)', '7412')).toBe('solar-technician')
    expect(matchTrade('Software Developer', '9999')).toBe('software-developer')
  })

  it('does not guess an occupation it does not know', () => {
    expect(matchTrade('Astrologer')).toBeNull()
    expect(matchTrade(null)).toBeNull()
  })

  it('maps spelling variants of a place to one district', () => {
    expect(['Bangalore', 'Bengaluru', 'BLR', 'Bengaluru Urban'].map(matchDistrict)).toEqual(Array(4).fill('bengaluru-urban'))
    expect(matchDistrict('Hanamkonda')).toBe('warangal')
    expect(matchDistrict('Mysore District')).toBe('mysuru')
    expect(matchDistrict('Chennai')).toBeNull()
  })

  it('maps sector labels', () => {
    expect(matchSector('IT/ITES')).toBe('it-digital')
    expect(matchSector('Green Jobs')).toBe('renewable-energy')
    expect(matchSector('Aviation')).toBeNull()
  })

  it('brings date formats onto one monthly period', () => {
    expect(['2026-09', '2026-09-15', '01/09/2026', 'Sep-2026', 'September 2026'].map(normalizePeriod)).toEqual(Array(5).fill('2026-09'))
    expect(normalizePeriod('Q2 FY27')).toBeNull()
    expect(normalizePeriod('2026-13')).toBeNull()
    expect(normalizeTrainingYear('2026-27')).toBe(2026)
  })
})

describe('demand ingest', () => {
  const record = (over: Partial<RawDemandRecord>): RawDemandRecord => ({
    source: 'job_portal', metric: 'jobPostings', period: '2026-09-15', occupation: 'Software Engineer', place: 'Hyderabad', value: 10, ...over,
  })

  it('sums counts and averages scores for the same district, trade and month', () => {
    const { rows } = normalizeDemand(
      [
        record({ value: 100 }),
        record({ occupation: 'Frontend Developer', place: 'Secunderabad', value: 40 }),
        record({ source: 'employment_exchange', metric: 'employmentRegistrations', period: 'Sep-2026', ncoCode: '2512', occupation: 'x', value: 30 }),
        record({ source: 'industry_hiring', metric: 'hiringSignal', period: '01/09/2026', value: 70 }),
        record({ source: 'industry_hiring', metric: 'hiringSignal', period: '01/09/2026', place: 'Hyd', value: 80 }),
      ],
      sectorOfTrade,
      'test',
    )
    expect(rows).toEqual([
      {
        districtId: 'hyderabad', sectorId: 'it-digital', tradeId: 'software-developer', period: '2026-09',
        jobPostings: 140, hiringSignal: 75, employmentRegistrations: 30, industryDemandSignal: null, source: 'test',
      },
    ])
  })

  it('leaves a signal empty when no source reported it', () => {
    const { rows } = normalizeDemand([record({})], sectorOfTrade, 'test')
    expect(rows[0]).toMatchObject({ jobPostings: 10, hiringSignal: null, employmentRegistrations: null, industryDemandSignal: null })
  })

  it('rejects and reports records it cannot map, without inventing a mapping', () => {
    const { rows, reports } = normalizeDemand(
      [
        record({}),
        record({ occupation: 'Astrologer' }),
        record({ place: 'Chennai' }),
        record({ period: 'Q2 FY27' }),
        record({ value: null }),
        record({ value: -5 }),
      ],
      sectorOfTrade,
      'test',
    )
    expect(rows).toHaveLength(1)
    expect(reports[0]).toMatchObject({ source: 'job_portal', recordsIn: 6, recordsMapped: 1 })
    expect(reports[0].unmapped.map((u) => u.reason).sort()).toEqual(['occupation', 'period', 'place', 'value', 'value'])
  })
})

describe('training ingest', () => {
  it('keeps unknown outcomes empty and maps names', () => {
    const { rows, report } = normalizeTraining(
      [
        { year: '2026-27', place: 'Warangal', occupation: 'Solar Technician', allocatedSeats: 800, enrolled: 752, completed: null, placed: null },
        { year: '2026-27', place: 'Atlantis', occupation: 'Solar Technician', allocatedSeats: 100, enrolled: null, completed: null, placed: null },
      ],
      sectorOfTrade,
    )
    expect(rows).toEqual([{ districtId: 'warangal', sectorId: 'renewable-energy', tradeId: 'solar-technician', year: 2026, allocatedSeats: 800, enrolled: 752, completed: null, placed: null }])
    expect(report).toMatchObject({ recordsIn: 2, recordsMapped: 1 })
  })
})
