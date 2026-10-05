import { describe, expect, it } from 'vitest'
import { TRADE_ALIASES } from '@/lib/intelligence/normalization/mappings'
import {
  editDistance, matchDistrict, matchDistrictDetailed, matchSector, matchTrade, matchTradeDetailed, normalizePeriod, normalizeTrainingYear, similarity,
} from '@/lib/intelligence/normalization/normalize'

describe('occupation mapping', () => {
  it('maps different titles for the same occupation to one trade, as exact matches', () => {
    for (const title of ['Software Engineer', 'Software Developer', 'Frontend Developer']) {
      expect(matchTradeDetailed(title)).toMatchObject({ id: 'software-developer', method: 'alias', score: 1 })
    }
    expect(matchTrade('Solar PV Installer')).toBe('solar-technician')
  })

  it('ignores seniority and contract words', () => {
    for (const title of ['Senior Software Engineer', 'software  developer (Urgent)', 'Jr. Electrician - Contract']) {
      expect(matchTradeDetailed(title).method, title).toBe('alias_without_qualifiers')
    }
    expect(matchTrade('Jr. Electrician - Contract')).toBe('electrician')
  })

  it('accepts a known title followed by a marked-off qualifier, with a lower score so it can be reviewed', () => {
    expect(matchTradeDetailed('Solar Technician - Rooftop')).toMatchObject({ id: 'solar-technician', method: 'alias_with_qualifier', score: 0.85 })
    expect(matchTradeDetailed('Electrician (Wireman)')).toMatchObject({ id: 'electrician', method: 'alias_with_qualifier' })
    expect(matchTradeDetailed('Electrician cum Wireman')).toMatchObject({ id: 'electrician', method: 'alias_with_qualifier' }) // both names are the same trade
  })

  it('does not take a longer title for a known one just because the words appear in it', () => {
    // A helper is not an electrician, and an auto electrician is a different occupation.
    for (const title of ['Electrician Helper', 'Auto electrician specialist', 'Assistant to Mason', 'Non Solar Technician']) {
      expect(matchTradeDetailed(title).id, title).toBeNull()
    }
  })

  it('reads the qualifier before trusting it', () => {
    // The qualifier names another trade: two trades, whichever way they are joined.
    for (const title of ['Welder / Electrician', 'Welder, Electrician', 'Mason - Welder', 'Electrician (Welder)']) {
      expect(matchTradeDetailed(title), title).toMatchObject({ id: null, failure: 'ambiguous' })
    }
    // The qualifier says it is a different job, or not this one.
    for (const title of ['Electrician (Helper)', 'Mason (not required)', 'Software Developer - Recruiter', 'Welder, Instructor']) {
      expect(matchTradeDetailed(title).id, title).toBeNull()
    }
    // An ordinary qualifier still works.
    expect(matchTradeDetailed('Electrician (Industrial)').id).toBe('electrician')
  })

  it('does not call one word a misspelling of a different word', () => {
    expect(matchTradeDetailed('Window Technician').id).toBeNull() // "window" is not a misspelt "wind"
    expect(matchTradeDetailed('CEO Executive').id).toBeNull() // nor "ceo" a misspelt "seo"
    // Real misspellings, one or two letters inside a word, still match.
    expect(matchTradeDetailed('Wearhouse Associate').id).toBe('warehouse-associate')
    expect(matchTradeDetailed('Logistics Co-ordinator').id).toBe('logistics-coordinator')
  })

  it('accepts a close misspelling and reports how close', () => {
    // one letter missing out of 18: 1 − 1/18 = 0.944
    expect(matchTradeDetailed('Sofware Developer')).toMatchObject({ id: 'software-developer', method: 'spelling', score: 0.944 })
    expect(matchTradeDetailed('Retail Sales Assosiate').id).toBe('retail-sales-associate')
  })

  it('refuses what it cannot decide instead of guessing', () => {
    expect(matchTradeDetailed('Astrologer')).toMatchObject({ id: null, failure: 'unknown' })
    expect(matchTradeDetailed('Java Developer')).toMatchObject({ id: null, failure: 'unknown' })
    expect(matchTradeDetailed('Software Engg')).toMatchObject({ id: null, failure: 'unknown' }) // too far from any alias
    expect(matchTradeDetailed('Welder cum Electrician')).toMatchObject({ id: null, failure: 'ambiguous' }) // two trades named
    expect(matchTradeDetailed(null)).toMatchObject({ id: null, failure: 'blank' })
    expect(matchTradeDetailed('   ')).toMatchObject({ id: null, failure: 'blank' })
  })

  it('lets the title decide, and uses an occupation code only when there is no title', () => {
    // No title at all: the unit group is all there is, accepted with a low score.
    expect(matchTradeDetailed('', '7412')).toMatchObject({ id: 'solar-technician', method: 'nco_code', score: 0.7 })
    expect(matchTradeDetailed(null, '7412.0100').id).toBe('solar-technician')
    // An unknown title with only a four-digit group: an auto electrician is not a solar technician.
    expect(matchTradeDetailed('Auto electrician specialist', '7233')).toMatchObject({ id: null, failure: 'code_only_group' })
    expect(matchTradeDetailed('Tractor mechanic', '7233')).toMatchObject({ id: null, failure: 'code_only_group' })
    // Title and code disagree: the title wins and the conflict is flagged.
    expect(matchTradeDetailed('Electrician', '7412')).toMatchObject({ id: 'electrician', conflict: true })
    expect(matchTradeDetailed('Software Developer', '9999')).toMatchObject({ id: 'software-developer', method: 'alias' })
    expect(matchTradeDetailed('Software Developer', '2512').conflict).toBeUndefined()
  })

  it('has no alias listed under two trades', () => {
    const seen = new Map<string, string>()
    for (const [trade, aliases] of Object.entries(TRADE_ALIASES)) {
      for (const alias of aliases) {
        expect(seen.get(alias) ?? trade, alias).toBe(trade)
        seen.set(alias, trade)
      }
    }
  })
})

describe('place and sector mapping', () => {
  it('maps spelling variants of a place to one district', () => {
    expect(['Bangalore', 'Bengaluru', 'BLR', 'Bengaluru Urban', 'Bengaluru (U)'].map((p) => matchDistrict(p))).toEqual(Array(5).fill('bengaluru-urban'))
    expect(matchDistrict('Hanamkonda')).toBe('warangal')
    expect(matchDistrictDetailed('Mysore District')).toMatchObject({ id: 'mysuru', method: 'alias_without_qualifiers' })
    expect(matchDistrict('Hyderabad, Telangana')).toBe('hyderabad')
    expect(matchDistrictDetailed('Hyderbad')).toMatchObject({ id: 'hyderabad', method: 'spelling' })
  })

  it('does not stretch a match to a place it does not know', () => {
    expect(matchDistrict('Chennai')).toBeNull()
    expect(matchDistrict('Mysooru')).toBeNull() // two edits in seven letters: below the threshold
    // "(R)" means rural: a different district from Bengaluru Urban, and not in the pilot.
    expect(matchDistrict('Bengaluru (R)')).toBeNull()
    expect(matchDistrict('')).toBeNull()
  })

  it('maps sector labels', () => {
    expect(matchSector('IT/ITES')).toBe('it-digital')
    expect(matchSector('IT & Digital')).toBe('it-digital')
    expect(matchSector('Green Jobs')).toBe('renewable-energy')
    expect(matchSector('Aviation')).toBeNull()
  })
})

describe('dates', () => {
  it('brings every documented form onto one monthly period', () => {
    const forms = ['2026-09', '2026-09-15', '2026/09', '2026/09/15', '09/2026', '09-2026', 'Sep-2026', 'Sep 2026', 'Sep-26', 'Sept 2026', 'September 2026', '15/09/2026', '15/09/26', '15 Sep 2026', '15-Sep-2026', '2026-09-15T10:30:00Z', '2026-09-15 10:30']
    expect(forms.map((f) => normalizePeriod(f))).toEqual(Array(forms.length).fill('2026-09'))
  })

  it('reads day/month order as the source declares it', () => {
    expect(normalizePeriod('09/01/2026')).toBe('2026-01') // day first, the default
    expect(normalizePeriod('09/01/2026', 'mdy')).toBe('2026-09')
  })

  it('refuses quarters, impossible months and days, and words that are not months', () => {
    for (const value of ['Q2 FY27', '2026-13', '13/2026', 'Sepia 2026', 'FY2026', '', '2026', '31/09/2026', '2026-02-30', '32 Sep 2026', '00/09/2026']) expect(normalizePeriod(value), value).toBeNull()
    expect(normalizePeriod(null)).toBeNull()
    expect(normalizePeriod('29/02/2028')).toBe('2028-02') // a leap day is a real day
    // Not a financial year: this is how ISO writes December 2011, and it is read that way.
    expect(normalizePeriod('2011-12')).toBe('2011-12')
  })

  it('reads training years', () => {
    expect(normalizeTrainingYear('2026-27')).toBe(2026)
    expect(normalizeTrainingYear('2026-2027')).toBe(2026)
    expect(normalizeTrainingYear('2026')).toBe(2026)
    expect(normalizeTrainingYear('2026-28')).toBeNull() // not consecutive years
    expect(normalizeTrainingYear('FY26')).toBeNull()
  })
})

describe('spelling distance', () => {
  it('counts insertions, deletions, substitutions and swapped neighbours as one edit each', () => {
    expect(editDistance('solar', 'solar')).toBe(0)
    expect(editDistance('solar', 'sollar')).toBe(1)
    expect(editDistance('solar', 'solr')).toBe(1)
    expect(editDistance('solar', 'sokar')).toBe(1)
    expect(editDistance('solar', 'sloar')).toBe(1)
    expect(similarity('mysooru', 'mysuru')).toBeCloseTo(1 - 2 / 7, 5)
  })
})
