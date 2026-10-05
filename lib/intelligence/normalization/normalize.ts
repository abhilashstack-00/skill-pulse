import { DISTRICT_ALIASES, MONTH_NAMES, NCO_TO_TRADE, SECTOR_ALIASES, TITLE_NOISE, TRADE_ALIASES } from './mappings'

/**
 * Matching rules of the mapping layer. Every function either returns a match
 * together with HOW it was found and how close it was, or says why it could
 * not decide. Nothing is guessed silently: anything that is not an exact
 * alias is reported so a person can check it.
 */

export const MATCHING = {
  /** Smallest similarity (0–1) at which a misspelt title or place is accepted. */
  fuzzyThreshold: 0.88,
  /** In a spelling match with the same number of words, every word must be at least this close to its counterpart. */
  wordThreshold: 0.75,
  /** The best candidate must beat the best candidate of any OTHER entity by this much. */
  fuzzyMargin: 0.05,
  /** Scores reported for the looser methods, so they can be told apart and reviewed. */
  score: { qualified: 0.85, codeOnly: 0.7, unknownQualifier: 0.8 },
  /** Longer text than this is not a job title or a place name; it is refused without a spelling search. */
  maxLength: 80,
} as const

/**
 * exact methods            alias, alias_without_qualifiers
 * looser methods           alias_with_qualifier ("Solar Technician - Rooftop"), spelling, nco_code,
 *                          place_unknown_qualifier ("Hyderabad, Sindh")
 * A looser match is a suggestion. Whether it is counted is the loader's decision, not this file's.
 */
export type MatchMethod = 'alias' | 'alias_without_qualifiers' | 'alias_with_qualifier' | 'spelling' | 'nco_code' | 'place_unknown_qualifier'
export const EXACT_METHODS: readonly MatchMethod[] = ['alias', 'alias_without_qualifiers']
export type MatchFailure = 'blank' | 'unknown' | 'ambiguous' | 'code_only_group'

export interface MatchResult {
  id: string | null
  method: MatchMethod | null
  /** 1 for an exact alias; lower for looser methods. Null when there is no match. */
  score: number | null
  failure: MatchFailure | null
  /** True when a source gave both a title and a code and they point to different trades (the title wins). */
  conflict?: boolean
}

const found = (id: string, method: MatchMethod, score: number): MatchResult => ({ id, method, score: Math.round(score * 1000) / 1000, failure: null })
const failed = (failure: MatchFailure): MatchResult => ({ id: null, method: null, score: null, failure })

/** Lower-case, expand "(U)"/"(R)", strip punctuation, collapse spaces. */
export function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(\s*u\s*\)/g, ' urban ')
    .replace(/\(\s*r\s*\)/g, ' rural ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function invert(aliases: Record<string, string[]>): Map<string, string> {
  const index = new Map<string, string>()
  for (const [id, names] of Object.entries(aliases)) {
    for (const name of names) {
      const key = clean(name)
      const existing = index.get(key)
      if (existing && existing !== id) throw new Error(`Mapping table error: "${name}" is listed for both ${existing} and ${id}`)
      index.set(key, id)
    }
  }
  return index
}

const tradeIndex = invert(TRADE_ALIASES)
const districtIndex = invert(DISTRICT_ALIASES)
const sectorIndex = invert(SECTOR_ALIASES)
const noise = new Set(TITLE_NOISE.flatMap((n) => clean(n).split(' ')))

/** Damerau–Levenshtein distance (insert, delete, substitute, swap neighbours). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

export const similarity = (a: string, b: string): number => (a.length || b.length ? 1 - editDistance(a, b) / Math.max(a.length, b.length) : 1)

/** Closest alias by spelling, accepted only when it is clearly closer than any other entity's. */
function bySpelling(text: string, index: Map<string, string>): MatchResult | null {
  if (text.length > MATCHING.maxLength) return null
  const best = new Map<string, number>()
  const bestAlias = new Map<string, string>()
  for (const [alias, id] of index) {
    // A very short alias ("it", "deo", "hyd") is too easy to hit by accident.
    if (alias.length < 5) continue
    // Lengths this far apart cannot reach the threshold: skip the costly comparison.
    if (Math.abs(alias.length - text.length) > (1 - MATCHING.fuzzyThreshold + MATCHING.fuzzyMargin) * Math.max(alias.length, text.length)) continue
    const s = similarity(text, alias)
    if (s > (best.get(id) ?? 0)) { best.set(id, s); bestAlias.set(id, alias) }
  }
  const ranked = [...best.entries()].sort((x, y) => y[1] - x[1])
  if (!ranked.length || ranked[0][1] < MATCHING.fuzzyThreshold) return null
  if (ranked.length > 1 && ranked[0][1] - ranked[1][1] < MATCHING.fuzzyMargin) return failed('ambiguous')
  // A misspelling changes a letter or two in a word; it does not turn one word into another.
  // "Window Technician" is close to "Wind Technician" as a string, but "window" is not a misspelt "wind".
  const words = text.split(' ')
  const aliasWords = (bestAlias.get(ranked[0][0]) as string).split(' ')
  if (words.length === aliasWords.length && words.some((word, i) => similarity(word, aliasWords[i]) < MATCHING.wordThreshold)) return null
  return found(ranked[0][0], 'spelling', ranked[0][1])
}

const exactTitle = (cleaned: string): string | null => {
  const direct = tradeIndex.get(cleaned)
  if (direct) return direct
  const stripped = cleaned.split(' ').filter((word) => !noise.has(word)).join(' ')
  const plain = tradeIndex.get(stripped)
  if (plain) return plain
  // Plural of the last word: "Electricians", "Solar Technicians".
  return stripped.endsWith('s') ? tradeIndex.get(stripped.slice(0, -1)) ?? null : null
}

/**
 * A known title followed by a qualifier set off by punctuation
 * ("Solar Technician - Rooftop", "Phlebotomist (Home Collection)"), or two
 * titles joined by "cum" that are the same trade ("Electrician cum Wireman").
 * A known title merely appearing among other words is NOT accepted: a "Mason
 * Jar Packer" is not a mason and a "Software Developer Recruiter" is not a
 * developer.
 */
function byQualifier(title: string): MatchResult | null {
  const lowered = title.toLowerCase()
  const parts = lowered.split(/\s+cum\s+/)
  if (parts.length === 2) {
    const [a, b] = parts.map((part) => exactTitle(clean(part)))
    if (a && b) return a === b ? found(a, 'alias_with_qualifier', MATCHING.score.qualified) : failed('ambiguous')
    return null
  }
  const pieces = lowered.split(/\s[-–—]\s|[(),\/]/).map(clean).filter(Boolean)
  if (pieces.length < 2) return null
  const id = exactTitle(pieces[0])
  if (!id) return null
  for (const piece of pieces.slice(1)) {
    // The qualifier names another trade ("Welder / Electrician", "Mason - Welder"): two trades, not one.
    const other = exactTitle(piece)
    if (other && other !== id) return failed('ambiguous')
    // The qualifier says this is a different job from the trade itself ("Electrician (Helper)", "Mason (not required)").
    if (piece.split(' ').some((word) => ROLE_CHANGING.has(word))) return failed('unknown')
  }
  return found(id, 'alias_with_qualifier', MATCHING.score.qualified)
}
/**
 * Words that turn a trade's title into a different job, or negate it. A title qualified by one of these is not matched.
 * ("Trainee" and "apprentice" are not here: the mapping tables treat them as levels of the same trade.)
 */
const ROLE_CHANGING = new Set(['helper', 'assistant', 'recruiter', 'trainer', 'instructor', 'teacher', 'faculty', 'not', 'non', 'except', 'no'])

function matchTitle(title: string): MatchResult {
  const cleaned = clean(title)
  if (!cleaned) return failed('blank')
  if (cleaned.length > MATCHING.maxLength) return failed('unknown')
  const direct = tradeIndex.get(cleaned)
  if (direct) return found(direct, 'alias', 1)
  const exact = exactTitle(cleaned)
  if (exact) return found(exact, 'alias_without_qualifiers', 1)
  const stripped = cleaned.split(' ').filter((word) => !noise.has(word)).join(' ')
  return byQualifier(title) ?? bySpelling(stripped, tradeIndex) ?? failed('unknown')
}

/**
 * Occupation → trade.
 *
 * The title decides. An NCO code is a four-digit unit group that can cover
 * several trades, so on its own it is accepted only when the source gives no
 * title at all, and then with a lower score. When title and code disagree the
 * title wins and the disagreement is reported.
 */
export function matchTradeDetailed(title: string | null | undefined, ncoCode?: string | null): MatchResult {
  // Files repeat the same wording thousands of times: decide each distinct wording once.
  const key = `${title ?? ''}\u0000${ncoCode ?? ''}`
  const known = tradeMemo.get(key)
  if (known) return known
  const result = decideTrade(title, ncoCode)
  if (tradeMemo.size < MEMO_LIMIT) tradeMemo.set(key, result)
  return result
}
const MEMO_LIMIT = 50_000
const tradeMemo = new Map<string, MatchResult>()
const districtMemo = new Map<string, MatchResult>()

function decideTrade(title: string | null | undefined, ncoCode?: string | null): MatchResult {
  const codeDigits = ncoCode ? String(ncoCode).replace(/\D/g, '').slice(0, 4) : ''
  const byCode = codeDigits.length === 4 ? NCO_TO_TRADE[codeDigits] ?? null : null
  const hasTitle = Boolean(title && clean(title))
  if (hasTitle) {
    const byTitle = matchTitle(title as string)
    if (byTitle.id) return byCode && byCode !== byTitle.id ? { ...byTitle, conflict: true } : byTitle
    // A title the tables do not know, with only a unit-group code to go on: not enough.
    if (byTitle.failure === 'unknown' && byCode) return failed('code_only_group')
    return byTitle
  }
  return byCode ? found(byCode, 'nco_code', MATCHING.score.codeOnly) : failed('blank')
}

/**
 * Place → district. Text after a comma ("Hyderabad, Telangana") is returned as
 * `qualifier` for the caller to check against the district's state; this file
 * does not know which state a district is in.
 */
export function matchDistrictDetailed(place: string | null | undefined): MatchResult & { qualifier?: string } {
  const key = place ?? ''
  const known = districtMemo.get(key)
  if (known) return known
  const result = decideDistrict(place)
  if (districtMemo.size < MEMO_LIMIT) districtMemo.set(key, result)
  return result
}

function decideDistrict(place: string | null | undefined): MatchResult & { qualifier?: string } {
  const cleaned = place ? clean(place) : ''
  if (!cleaned) return failed('blank')
  if (cleaned.length > MATCHING.maxLength) return failed('unknown')
  const direct = districtIndex.get(cleaned)
  if (direct) return found(direct, 'alias', 1)
  // "Mysore District", "Nagpur City": drop a generic suffix. "Hyderabad, Telangana": keep what follows the comma for checking.
  const comma = place!.indexOf(',')
  const qualifier = comma >= 0 ? clean(place!.slice(comma + 1)) : ''
  const beforeComma = comma >= 0 ? clean(place!.slice(0, comma)) : cleaned
  const trimmed = beforeComma.replace(/ (district|dist|city)$/, '')
  const simplified = districtIndex.get(trimmed) ?? districtIndex.get(beforeComma)
  if (simplified) return { ...found(simplified, 'alias_without_qualifiers', 1), ...(qualifier ? { qualifier } : {}) }
  const spelt = bySpelling(trimmed, districtIndex)
  return spelt ? { ...spelt, ...(qualifier ? { qualifier } : {}) } : failed('unknown')
}

export function matchSectorDetailed(label: string | null | undefined): MatchResult {
  const cleaned = label ? clean(label) : ''
  if (!cleaned) return failed('blank')
  const direct = sectorIndex.get(cleaned)
  return direct ? found(direct, 'alias', 1) : bySpelling(cleaned, sectorIndex) ?? failed('unknown')
}

export const matchTrade = (title: string | null | undefined, ncoCode?: string | null): string | null => matchTradeDetailed(title, ncoCode).id
export const matchDistrict = (place: string | null | undefined): string | null => matchDistrictDetailed(place).id
export const matchSector = (label: string | null | undefined): string | null => matchSectorDetailed(label).id

/* --------------------------------- Dates ---------------------------------- */

export type DateOrder = 'dmy' | 'mdy'

function valid(year: number, month: number, day?: number): string | null {
  if (!(year >= 2000 && year <= 2100 && month >= 1 && month <= 12)) return null
  // A day that does not exist in that month (31 September) means the value was not a date, or was typed wrongly.
  if (day !== undefined && !(day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate())) return null
  return `${year}-${String(month).padStart(2, '0')}`
}
const dayOf = (text: string | undefined): number | undefined => (text === undefined ? undefined : Number(text))
const fullYear = (text: string): number => (text.length === 2 ? 2000 + Number(text) : Number(text))

/**
 * A date or month in any of the forms sources use → 'YYYY-MM'.
 *
 *   2026-09 · 2026-09-15 · 2026-09-15T10:30:00Z · 2026/09 · 2026/09/15 · 09/2026 · 09-2026
 *   Sep-2026 · Sep 2026 · Sep-26 · September 2026 · 15 Sep 2026 · 15-Sep-2026
 *   15/09/2026 · 15/09/26   (day first unless the source is declared month first)
 *
 * Quarters, "FY" forms and anything else return null. "2011-12" is read as
 * December 2011, as ISO writes it: a financial-year column must not be loaded
 * as a month column. Whether a month is
 * plausible (not in the future) is checked by the loader, which knows the date.
 */
export function normalizePeriod(value: string | null | undefined, order: DateOrder = 'dmy'): string | null {
  if (!value) return null
  const v = value.trim()
  let m = v.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?(?:[T ]\d{1,2}:\d{2}.*)?$/)
  if (m) return valid(+m[1], +m[2], dayOf(m[3]))
  m = v.match(/^(\d{1,2})[-/](\d{4})$/)
  if (m) return valid(+m[2], +m[1])
  m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})$/)
  if (m) return order === 'dmy' ? valid(fullYear(m[3]), +m[2], +m[1]) : valid(fullYear(m[3]), +m[1], +m[2])
  m = v.match(/^(?:(\d{1,2})[ -])?([A-Za-z]{3,9})[ -](\d{4}|\d{2})$/)
  if (m) {
    const month = MONTH_NAMES.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
    // "Sep" and "September" are months; "Sepia 2026" is not.
    const name = m[2].toLowerCase()
    const known = month > 0 && (name.length === 3 || FULL_MONTHS[month - 1] === name || (name === 'sept' && month === 9))
    return known ? valid(fullYear(m[3]), month, dayOf(m[1])) : null
  }
  return null
}
const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** '2026-27', '2026-2027' or '2026' → 2026 (start year of the training cycle). */
export function normalizeTrainingYear(value: string | null | undefined): number | null {
  const m = value?.trim().match(/^(\d{4})(?:[-/](\d{2}|\d{4}))?$/)
  if (!m) return null
  const start = +m[1]
  if (m[2]) {
    const end = m[2].length === 2 ? Math.floor(start / 100) * 100 + +m[2] : +m[2]
    if (end !== start + 1) return null
  }
  return start >= 2000 && start <= 2100 ? start : null
}
