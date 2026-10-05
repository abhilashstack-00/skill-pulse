import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Dataset, Trade } from '@/lib/domain/types'
import { applyToDataset, asOfPeriod, metaAfter, statusAfter, valuesReplaced, SYNTHETIC_LABEL, UPLOADED_LABEL, type RunInfo } from '@/lib/ingest/apply'
import { CsvError, parseCsv, numberOrNull } from '@/lib/ingest/csv'
import { IngestError, ingestExtract, type IngestOptions } from '@/lib/ingest/ingest'
import { SOURCE_SPECS, specFor } from '@/lib/ingest/sources'

const pilot = JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset
const trades = pilot.trades as Trade[]
const refs = { trades, districts: pilot.districts, states: pilot.states }
/** The loader is told today's month; nothing in these tests depends on the clock. */
const hold: IngestOptions = { today: '2026-10' }
const count: IngestOptions = { today: '2026-10', looseMatches: 'count' }
const portal = specFor('job-portals')!
const exchange = specFor('employment-exchange')!
const hiring = specFor('industry-hiring')!
const training = specFor('training-capacity')!
const run = (over: Partial<RunInfo> = {}): RunInfo => ({ fileName: 'test.csv', loadedAt: '2026-10-05T09:30:00.000Z', loadedBy: 'tester', mode: 'merge', synthetic: true, ...over })

describe('CSV reading', () => {
  it('handles quoted commas, escaped quotes, Windows line ends and a byte-order mark', () => {
    const rows = parseCsv('﻿Name,Value\r\n"Doe, Jane","say ""hi"""\r\nplain,2\r\n\r\n')
    expect(rows).toEqual([{ name: 'Doe, Jane', value: 'say "hi"' }, { name: 'plain', value: '2' }])
  })

  it('reads numbers the way spreadsheets write them and refuses text', () => {
    expect(numberOrNull('1,250')).toBe(1250)
    expect(numberOrNull(' 71.5 ')).toBe(71.5)
    expect(numberOrNull('')).toBeNull()
    expect(numberOrNull('n/a')).toBeNull()
    expect(numberOrNull('12,50,000')).toBe(1250000) // Indian grouping
  })

  it('does not guess at things that only look like numbers', () => {
    for (const text of ['0x10', '1e12', '1,25', '12 approx', '1,2,3', '١٢', '--5', '1.2.3']) expect(numberOrNull(text)).toBeNull()
  })

  it('refuses a file it cannot read reliably instead of loading part of it', () => {
    expect(() => parseCsv('a,b\n1,"never closed\n2,3\n')).toThrow(CsvError)
    expect(() => parseCsv('a,b,A\n1,2,3\n')).toThrow(/more than once: a/)
    expect(() => parseCsv('a,b\n"x"y,2\n')).toThrow(/closing quote/)
  })

  it('treats a quote in the middle of a value as an ordinary character, so no row is swallowed', () => {
    const rows = parseCsv('title,n\n6" pipe Welder,1\nMason,2\n8" pipe Welder,3\nElectrician,4\n "Fitter, Grade 2" ,5\n')
    expect(rows.map((r) => [r.title, r.n])).toEqual([['6" pipe Welder', '1'], ['Mason', '2'], ['8" pipe Welder', '3'], ['Electrician', '4'], ['Fitter, Grade 2', '5']])
  })
})

describe('ingesting a hand-written portal file', () => {
  // tests/fixtures/portal_handwritten.csv was typed by hand, not produced by the pilot generator.
  // Expected results, row by row:
  //   1  Software Engineer / Bangalore / 2026-09 / 40      exact
  //   2  Sr. Software Engineer (Urgent) / Bengaluru (U)    qualifiers dropped, +10
  //   3  Sofware Developer / BLR / 15/09/2026              spelling (loose), +5        → 55 for the month
  //   4  Solar Technician - Rooftop / Hanamkonda / Sep-26  contains (loose), 7
  //   5  Solar PV Installer / Warangal (U) / 2026/08       exact, 12
  //   6  Electrician / Warangal, industry "IT"             exact, 3, sector mismatch
  //   7  Java Developer                                    rejected: occupation unknown
  //   8  Welder cum Electrician                            rejected: two trades
  //   9  Mason / Chennai                                   rejected: place unknown
  //  10  Q2 FY27                                           rejected: date
  //  11  openings −2                                       rejected: value
  //  12  openings 2.5                                      rejected: value (a count must be whole)
  //  13  same as row 1                                     kept: two real postings can be identical, +40
  //  14  "Data Entry Operator, DEO" / Mysore District / "1,200"   known title plus a qualifier (loose), 1,200
  // Rows 3, 4 and 14 were matched by a looser rule. By default they are held for a person to review.
  const text = readFileSync('tests/fixtures/portal_handwritten.csv', 'utf8')
  const outcome = ingestExtract(portal, text, refs, hold)
  const counted = ingestExtract(portal, text, refs, count)

  it('holds loosely matched rows for review unless told to count them', () => {
    expect(outcome.report).toMatchObject({
      sourceId: 'job-portals', rowsRead: 14, rowsMapped: 5, rowsRejected: 9, rowsLooselyMatched: 3, rowsHeld: 3, looseMatches: 'hold',
      duplicateRows: 1, sectorMismatches: 1, codeConflicts: 0, periodMin: '2026-08', periodMax: '2026-09', pairs: 3,
    })
    expect(counted.report).toMatchObject({ rowsMapped: 8, rowsRejected: 6, rowsLooselyMatched: 3, rowsHeld: 0, looseMatches: 'count', pairs: 4 })
  })

  it('adds counts for the same district, trade and month', () => {
    expect(outcome.demand).toEqual([
      { districtId: 'bengaluru-urban', tradeId: 'software-developer', period: '2026-09', value: 90 }, // 40 + 10 + 40
      { districtId: 'warangal', tradeId: 'electrician', period: '2026-08', value: 3 },
      { districtId: 'warangal', tradeId: 'solar-technician', period: '2026-08', value: 12 },
    ])
    expect(counted.demand).toEqual([
      { districtId: 'bengaluru-urban', tradeId: 'software-developer', period: '2026-09', value: 95 },
      { districtId: 'mysuru', tradeId: 'data-entry-operator', period: '2026-08', value: 1200 },
      { districtId: 'warangal', tradeId: 'electrician', period: '2026-08', value: 3 },
      { districtId: 'warangal', tradeId: 'solar-technician', period: '2026-08', value: 12 },
      { districtId: 'warangal', tradeId: 'solar-technician', period: '2026-09', value: 7 },
    ])
  })

  it('says why each rejected row was rejected', () => {
    const reasons: Record<string, number> = {}
    for (const r of outcome.report.rejects) reasons[r.reason] = (reasons[r.reason] ?? 0) + r.count
    expect(reasons).toEqual({ occupation_unknown: 1, occupation_ambiguous: 1, place_unknown: 1, period: 1, value: 2, needs_review: 3 })
    expect(outcome.report.rejects.find((r) => r.reason === 'occupation_unknown')).toMatchObject({ example: 'Java Developer', value: 25 })
    expect(outcome.report.rejectKinds).toBe(9)
  })

  it('lists every match that was not an exact alias, with its method, score and volume', () => {
    expect(outcome.report.looseMatchList.map((m) => [m.raw, m.mappedTo, m.method, m.value]).sort()).toEqual([
      ['Data Entry Operator, DEO', 'data-entry-operator', 'alias_with_qualifier', 1200],
      ['Sofware Developer', 'software-developer', 'spelling', 5],
      ['Solar Technician - Rooftop', 'solar-technician', 'alias_with_qualifier', 7],
    ])
  })

  it('reports how much of the file\'s volume reached the dataset', () => {
    // Readable values: every row except −2. 40+10+5+7+12+3+25+4+9+9+2.5+40+1200 = 1366.5
    expect(outcome.report.valueRead).toBe(1366.5)
    expect(outcome.report.valueMapped).toBe(105) // 90 + 3 + 12
    expect(counted.report.valueMapped).toBe(1317) // + 5 + 7 + 1200
  })
})

describe('ingest rules by source', () => {
  it('refuses a file with the wrong columns and says which are missing', () => {
    expect(() => ingestExtract(portal, 'date,title\n2026-09,Mason\n', refs, hold)).toThrow(IngestError)
    expect(() => ingestExtract(portal, 'date,title\n2026-09,Mason\n', refs, hold)).toThrow(/posting_date, job_title, city, openings/)
    expect(() => ingestExtract(portal, 'posting_date,job_title,city,openings\n', refs, hold)).toThrow(/no data rows/)
  })

  it('averages 0–100 scores for the same pair and month, and refuses scores out of range', () => {
    const text = 'month,role,location,sector,hiring_intent_score\n01/09/2026,Mason,Pune,Construction,70\n01/09/2026,Mason,Poona,Construction,81\n01/09/2026,Mason,Pune City,Construction,140\n'
    const o = ingestExtract(hiring, text, refs, hold)
    expect(o.demand).toEqual([{ districtId: 'pune', tradeId: 'mason', period: '2026-09', value: 75.5 }])
    expect(o.report).toMatchObject({ rowsMapped: 2, rowsRejected: 1 })
    expect(o.report.rejects[0]).toMatchObject({ reason: 'value', example: '140' })
  })

  it('flags an occupation code that disagrees with the title', () => {
    const text = 'period,nco_code,occupation,district,state,vacancies\nSep-2026,7412,Electrician,Pune,Maharashtra,4\nSep-2026,7233,Tractor mechanic,Pune,Maharashtra,6\n'
    const o = ingestExtract(exchange, text, refs, hold)
    expect(o.demand).toEqual([{ districtId: 'pune', tradeId: 'electrician', period: '2026-09', value: 4 }])
    expect(o.report).toMatchObject({ codeConflicts: 1, rowsRejected: 1 })
    expect(o.report.rejects[0].reason).toBe('occupation_code_only')
  })

  it('checks training rows for impossible outcomes', () => {
    const text = [
      'training_year,district,trade,sector,allocated_seats,enrolled,completed,placed',
      '2026-27,Pune,Mason,Construction,100,90,,',
      '2025-26,Pune,Mason,Construction,100,90,95,40', // more completed than enrolled
      '2024-25,Pune,Mason,Construction,100,90,80,85', // more placed than completed
      '2026-28,Pune,Mason,Construction,100,90,,', // not a training year
      '2023-24,Pune,Mason,Construction,,90,80,70', // no seats
      '2023-24,Pune,Welder,Manufacturing,60,66,50,30', // over-enrolment is allowed
    ].join('\n')
    const o = ingestExtract(training, text, refs, hold)
    expect(o.training).toEqual([
      { districtId: 'pune', tradeId: 'mason', year: 2026, allocatedSeats: 100, enrolled: 90, completed: null, placed: null },
      { districtId: 'pune', tradeId: 'welder', year: 2023, allocatedSeats: 60, enrolled: 66, completed: 50, placed: 30 },
    ])
    expect(Object.fromEntries(o.report.rejects.map((r) => [r.reason, r.count]))).toMatchObject({ inconsistent: 1, period: 1, value: 1 })
    expect(o.report.rowsRejected).toBe(4)
  })

  it('refuses months that have not happened yet, so a typing error cannot move the as-of date', () => {
    const text = 'posting_date,job_title,city,industry,openings\n2099-01-10,Mason,Pune,Construction,5\n2026-11-01,Mason,Pune,Construction,5\n2026-10-31,Mason,Pune,Construction,5\n'
    const o = ingestExtract(portal, text, refs, hold)
    expect(o.demand).toEqual([{ districtId: 'pune', tradeId: 'mason', period: '2026-10', value: 5 }])
    expect(o.report.rejects).toEqual([{ reason: 'period_future', example: '2099-01-10', count: 1, value: 5 }, { reason: 'period_future', example: '2026-11-01', count: 1, value: 5 }])
    // A training cycle may be announced one year ahead, not five.
    const seats = 'training_year,district,trade,sector,allocated_seats,enrolled,completed,placed\n2027-28,Pune,Mason,Construction,100,,,\n2031-32,Pune,Mason,Construction,100,,,\n'
    const t = ingestExtract(training, seats, refs, hold)
    expect(t.training.map((r) => r.year)).toEqual([2027])
    expect(t.report.rejects[0]).toMatchObject({ reason: 'period_future', example: '2031-32' })
  })

  it('refuses a count written with a decimal point, which is a thousand to some writers and one to others', () => {
    const text = 'posting_date,job_title,city,industry,openings\n2026-09-01,Mason,Pune,X,1.000\n2026-09-01,Mason,Pune,X,"1,000"\n2026-09-01,Mason,Pune,X,7.0\n'
    const o = ingestExtract(portal, text, refs, hold)
    expect(o.demand).toEqual([{ districtId: 'pune', tradeId: 'mason', period: '2026-09', value: 1000 }])
    expect(o.report.rejects.map((r) => r.example).sort()).toEqual(['1.000', '7.0'])
  })

  it('reads day-first dates unless the file is declared month first', () => {
    const text = 'posting_date,job_title,city,industry,openings\n03/04/2026,Mason,Pune,Construction,5\n2026-04-03T10:30:00Z,Mason,Pune,Construction,1\n3 Apr 2026,Mason,Pune,Construction,1\n'
    expect(ingestExtract(portal, text, refs, hold).demand).toEqual([{ districtId: 'pune', tradeId: 'mason', period: '2026-04', value: 7 }])
    expect(ingestExtract(portal, text, refs, { ...hold, dateOrder: 'mdy' }).demand).toEqual([
      { districtId: 'pune', tradeId: 'mason', period: '2026-03', value: 5 },
      { districtId: 'pune', tradeId: 'mason', period: '2026-04', value: 2 },
    ])
  })

  it('refuses a row whose district and state disagree', () => {
    const text = 'period,nco_code,occupation,district,state,vacancies\nSep-2026,7112,Mason,Pune,Karnataka,4\nSep-2026,7112,Mason,Pune,Maharashtra,6\n'
    const o = ingestExtract(exchange, text, refs, hold)
    expect(o.demand).toEqual([{ districtId: 'pune', tradeId: 'mason', period: '2026-09', value: 6 }])
    expect(o.report.rejects).toEqual([{ reason: 'place_conflict', example: 'Pune', count: 1, value: 4 }])
  })

  it('does not take a longer title for a known one just because it contains it', () => {
    const titles = ['Electrician Helper Trainee', 'Assistant to Mason', 'Non Solar Technician', 'Welder Electrician Fitter']
    const text = 'posting_date,job_title,city,industry,openings\n' + titles.map((title) => `2026-09-01,${title},Pune,X,1`).join('\n') + '\n'
    const o = ingestExtract(portal, text, refs, count)
    expect(o.demand).toEqual([])
    expect(o.report.rowsRejected).toBe(4)
  })

  it('stays fast on a large file of titles it has never seen', () => {
    const lines = ['posting_date,job_title,city,industry,openings']
    for (let i = 0; i < 20000; i++) lines.push(`2026-09-01,Completely Unknown Occupation Title Number ${i},Some Unknown Town ${i % 500},X,1`)
    const started = Date.now()
    const o = ingestExtract(portal, lines.join('\n'), refs, hold)
    expect(o.report).toMatchObject({ rowsRead: 20000, rowsMapped: 0 })
    expect(o.report.rejects.length).toBeLessThanOrEqual(20)
    expect(o.report.rejectKinds).toBe(20000)
    expect(Date.now() - started).toBeLessThan(10000)
  })

  it('has a file specification for every source the pilot loads', () => {
    expect(SOURCE_SPECS.map((s) => s.id).sort()).toEqual(['employment-exchange', 'industry-hiring', 'industry-survey', 'job-portals', 'training-capacity'])
  })
})

describe('applying a load to the dataset', () => {
  const base = (): Dataset => ({
    meta: { label: SYNTHETIC_LABEL, synthetic: true, asOfPeriod: '2026-08', updatedAt: '2026-09-01', currentTrainingYear: 2025 },
    states: [], districts: [], sectors: [], trades, trainingCentres: [],
    trainingCapacity: [],
    labourDemand: [
      { districtId: 'pune', sectorId: 'construction', tradeId: 'mason', period: '2026-08', jobPostings: 30, hiringSignal: 60, employmentRegistrations: 10, industryDemandSignal: null, source: 'seed', lineage: { jobPostings: 1, hiringSignal: 1, employmentRegistrations: 1 } },
      { districtId: 'pune', sectorId: 'construction', tradeId: 'mason', period: '2026-07', jobPostings: 28, hiringSignal: null, employmentRegistrations: null, industryDemandSignal: null, source: 'seed', lineage: { jobPostings: 1 } },
    ],
    dataSources: SOURCE_SPECS.map((s) => ({ id: s.id, name: s.id, description: '', sourceType: s.kind === 'training' ? 'supply' : 'demand', lastUpdated: '2026-09-01', status: 'prototype_synthetic', coverage: '', granularity: '', feeds: '', recordsIn: null, recordsMapped: null })),
    ingestionRuns: [{ id: 1, sourceId: 'job-portals', fileName: 'seed.csv', loadedAt: '2026-09-01T00:00:00.000Z', loadedBy: null, mode: 'replace', synthetic: true, rowsRead: 2, rowsMapped: 2, rowsRejected: 0, rowsLooselyMatched: 0, rowsHeld: 0, looseMatches: 'hold', valueRead: 58, valueMapped: 58, periodMin: '2026-07', periodMax: '2026-08', rejects: [], rejectKinds: 0, looseMatchList: [], looseKinds: 0 }],
  })
  const file = 'posting_date,job_title,city,industry,openings\n2026-09-10,Mason,Pune,Construction,35\n2026-08-10,Mason,Pune,Construction,31\n'
  const outcome = ingestExtract(portal, file, refs, hold)

  it('merges: overwrites this source\'s signal, keeps the others, and records the run', () => {
    const after = applyToDataset(base(), portal, outcome, run())
    const august = after.labourDemand.find((r) => r.period === '2026-08')!
    expect(august).toMatchObject({ jobPostings: 31, hiringSignal: 60, employmentRegistrations: 10, lineage: { jobPostings: 2, hiringSignal: 1, employmentRegistrations: 1 } })
    expect(after.labourDemand.find((r) => r.period === '2026-09')).toMatchObject({ jobPostings: 35, hiringSignal: null, employmentRegistrations: null, lineage: { jobPostings: 2 } })
    expect(after.labourDemand.find((r) => r.period === '2026-07')?.jobPostings).toBe(28) // not in the file: left alone
    expect(after.ingestionRuns.map((r) => r.id)).toEqual([1, 2])
    expect(after.ingestionRuns[1]).toMatchObject({ sourceId: 'job-portals', loadedBy: 'tester', mode: 'merge', rowsRead: 2, rowsMapped: 2 })
    // September has postings but no exchange figure yet, so it has no demand volume and "today" stays in August.
    expect(after.meta).toMatchObject({ asOfPeriod: '2026-08', updatedAt: '2026-10-05' })
    expect(after.dataSources.find((s) => s.id === 'job-portals')).toMatchObject({ lastUpdated: '2026-10-05', recordsIn: 2, recordsMapped: 2 })
  })

  it('replace: removes what the source loaded before, and drops rows left with nothing', () => {
    const after = applyToDataset(base(), portal, outcome, run({ mode: 'replace' }))
    expect(after.labourDemand.map((r) => r.period).sort()).toEqual(['2026-08', '2026-09']) // July had only postings, which were removed
    expect(after.labourDemand.find((r) => r.period === '2026-08')?.jobPostings).toBe(31)
  })

  it('says beforehand how many stored values a load would overwrite: merge replaces a month, it does not add to it', () => {
    // The file has August (already stored) and September (new).
    expect(valuesReplaced(base(), portal, outcome, 'merge')).toBe(1)
    expect(valuesReplaced(base(), portal, outcome, 'replace')).toBe(2) // everything this source had: July and August
    // Loading the same pair-month in two parts keeps the second part only. That is why a file is split by month, never within one.
    const part = (n: number) => ingestExtract(portal, `posting_date,job_title,city,industry,openings\n2026-09-10,Mason,Pune,Construction,${n}\n`, refs, hold)
    const twice = applyToDataset(applyToDataset(base(), portal, part(10), run()), portal, part(20), run())
    expect(twice.labourDemand.find((r) => r.period === '2026-09')?.jobPostings).toBe(20)
    expect(valuesReplaced(applyToDataset(base(), portal, part(10), run()), portal, part(20), 'merge')).toBe(1)
  })

  it('does not let one row for a later training cycle put every other pair out of date', () => {
    const years = (year: number, pairs: number) => Array.from({ length: pairs }, () => year)
    const meta = base().meta
    expect(metaAfter(meta, ['prototype_synthetic'], { asOfPeriod: meta.asOfPeriod, years: [...years(2024, 90), ...years(2025, 90), ...years(2027, 1)] }, '2026-10-05T00:00:00Z').currentTrainingYear).toBe(2025)
    expect(metaAfter(meta, ['prototype_synthetic'], { asOfPeriod: meta.asOfPeriod, years: [...years(2025, 90), ...years(2026, 45)] }, '2026-10-05T00:00:00Z').currentTrainingYear).toBe(2026)
  })

  it('does not change the dataset it was given', () => {
    const before = base()
    const snapshot = JSON.stringify(before)
    applyToDataset(before, portal, outcome, run({ mode: 'replace' }))
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('keeps a source marked synthetic until real data replaces all of it', () => {
    expect(statusAfter('prototype_synthetic', { mode: 'merge', synthetic: true })).toBe('prototype_synthetic')
    expect(statusAfter('prototype_synthetic', { mode: 'merge', synthetic: false })).toBe('prototype_synthetic') // old synthetic rows remain
    expect(statusAfter('prototype_synthetic', { mode: 'replace', synthetic: false })).toBe('uploaded')
    expect(statusAfter('uploaded', { mode: 'merge', synthetic: false })).toBe('uploaded')
    expect(statusAfter('uploaded', { mode: 'merge', synthetic: true })).toBe('prototype_synthetic') // test rows mixed back in
  })

  it('labels the whole dataset synthetic while any feeding source is', () => {
    const meta = base().meta
    expect(metaAfter(meta, ['uploaded', 'prototype_synthetic'], { asOfPeriod: meta.asOfPeriod, years: [] }, '2026-10-05T00:00:00Z')).toMatchObject({ synthetic: true, label: SYNTHETIC_LABEL })
    expect(metaAfter(meta, ['uploaded', 'uploaded'], { asOfPeriod: '2026-11', years: [2025, 2026] }, '2026-10-05T00:00:00Z')).toEqual({
      synthetic: false, label: UPLOADED_LABEL, asOfPeriod: '2026-11', updatedAt: '2026-10-05', currentTrainingYear: 2026,
    })
  })

  it('takes the as-of month from where most pairs have data, not from one stray row', () => {
    const months = (period: string, pairs: number) => Array.from({ length: pairs }, () => period)
    expect(asOfPeriod([...months('2026-08', 60), ...months('2026-09', 60), ...months('2026-10', 1)], '2026-01')).toBe('2026-09')
    expect(asOfPeriod([...months('2026-08', 60), ...months('2026-09', 30)], '2026-01')).toBe('2026-09') // exactly half counts
    expect(asOfPeriod([...months('2026-08', 60), ...months('2026-09', 29)], '2026-01')).toBe('2026-08')
    expect(asOfPeriod([], '2026-01')).toBe('2026-01')
  })
})
