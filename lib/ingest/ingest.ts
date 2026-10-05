import type { District, State, Trade } from '@/lib/domain/types'
import { clean, EXACT_METHODS, matchDistrictDetailed, matchSectorDetailed, matchTradeDetailed, normalizePeriod, normalizeTrainingYear, type DateOrder, type MatchResult } from '@/lib/intelligence/normalization/normalize'
import { CsvError, numberOrNull, parseCsv } from './csv'
import type { SourceSpec } from './sources'

/**
 * Ingestion: one source file in, normalised facts and a report out.
 *
 * Pure: it reads text and returns values. Writing them to the bundled dataset
 * or to the database is done by apply.ts and apply-db.ts, so the same rules
 * run in the seed build, the command line and the upload endpoint.
 */

export class IngestError extends Error {}

export type RejectReason =
  | 'occupation_unknown'
  | 'occupation_ambiguous'
  | 'occupation_code_only'
  | 'place_unknown'
  | 'place_ambiguous'
  | 'place_conflict'
  | 'period'
  | 'period_future'
  | 'value'
  | 'inconsistent'
  | 'needs_review'

export interface IngestOptions {
  /**
   * What to do with rows matched by a looser rule than an exact alias.
   *   hold   leave them out and list them for a person to review (the default)
   *   count  count them, and list them
   */
  looseMatches?: 'hold' | 'count'
  /** The month the load happens in, 'YYYY-MM'. Rows dated after it are refused. */
  today: string
  /** Overrides the source's own day/month order for all-numeric dates. */
  dateOrder?: DateOrder
}

export interface IngestReport {
  sourceId: string
  rowsRead: number
  rowsMapped: number
  rowsRejected: number
  /** Rows matched by a looser rule. Counted or held according to `looseMatches`. */
  rowsLooselyMatched: number
  /** Of those, the rows left out for review (included in rowsRejected). */
  rowsHeld: number
  looseMatches: 'hold' | 'count'
  /** Rows identical to an earlier row in the same file. They are kept: two real postings can be identical. */
  duplicateRows: number
  /** Rows where the sector named in the file is not the mapped trade's sector (kept). */
  sectorMismatches: number
  /** Rows where title and occupation code pointed to different trades (the title was used). */
  codeConflicts: number
  /**
   * For count sources: the total of the value column over every row with a
   * readable value, and the part of it that was mapped. Their ratio says how
   * much of the source's volume reached the dataset. Null for 0–100 scores.
   */
  valueRead: number | null
  valueMapped: number | null
  periodMin: string | null
  periodMax: string | null
  /** District–trade pairs the file has at least one accepted row for. */
  pairs: number
  /** Most frequent first, at most LIST_LIMIT kinds; `rejectKinds` is how many kinds there were in all. */
  rejects: { reason: RejectReason; example: string; count: number; value: number | null }[]
  rejectKinds: number
  looseMatchList: { raw: string; mappedTo: string; method: string; score: number; count: number; value: number | null }[]
  looseKinds: number
}

export interface DemandFact { districtId: string; tradeId: string; period: string; value: number }
export interface TrainingFact { districtId: string; tradeId: string; year: number; allocatedSeats: number; enrolled: number | null; completed: number | null; placed: number | null }

export interface IngestOutcome {
  report: IngestReport
  demand: DemandFact[]
  training: TrainingFact[]
}

export const MAX_ROWS = 100_000
/** No single row of a pilot-scale extract carries more than this; larger is a unit or typing error. */
const MAX_COUNT = 10_000_000
const LIST_LIMIT = 20

class Tally<T extends { count: number; value: number | null }> {
  private readonly items = new Map<string, T>()
  add(key: string, value: number | null, make: () => Omit<T, 'count' | 'value'>) {
    const entry = this.items.get(key)
    if (entry) {
      entry.count += 1
      if (value !== null) entry.value = (entry.value ?? 0) + value
    } else this.items.set(key, { ...make(), count: 1, value } as T)
  }
  get kinds() {
    return this.items.size
  }
  top(): T[] {
    return [...this.items.values()].sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || b.count - a.count).slice(0, LIST_LIMIT)
  }
}

const occupationReason = (m: MatchResult): RejectReason => (m.failure === 'ambiguous' ? 'occupation_ambiguous' : m.failure === 'code_only_group' ? 'occupation_code_only' : 'occupation_unknown')
const isLoose = (m: MatchResult) => Boolean(m.id) && !EXACT_METHODS.includes(m.method as (typeof EXACT_METHODS)[number])

export function ingestExtract(spec: SourceSpec, text: string, refs: { trades: Trade[]; districts: District[]; states: State[] }, options: IngestOptions): IngestOutcome {
  let rows: Record<string, string>[]
  try {
    rows = parseCsv(text)
  } catch (error) {
    if (error instanceof CsvError) throw new IngestError(error.message)
    throw error
  }
  if (!rows.length) throw new IngestError('The file has no data rows.')
  if (rows.length > MAX_ROWS) throw new IngestError(`The file has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it by month and load the parts one after another: a later file replaces the values of any district, trade and month it repeats.`)
  const present = new Set(Object.keys(rows[0]))
  const required = Object.entries(spec.columns).filter(([key]) => key !== 'sector' && key !== 'ncoCode').map(([, column]) => column)
  const missing = required.filter((column) => !present.has(column))
  if (missing.length) throw new IngestError(`This does not look like a ${spec.id} file. Missing column(s): ${missing.join(', ')}. Expected: ${Object.values(spec.columns).join(', ')}.`)

  const policy = options.looseMatches ?? 'hold'
  const order = options.dateOrder ?? spec.dateOrder
  const sectorOf = new Map(refs.trades.map((t) => [t.id, t.sectorId]))
  const stateOfDistrict = new Map(refs.districts.map((d) => [d.id, d.stateId]))
  // How a state may be written after a comma: its name or its code.
  const stateByText = new Map(refs.states.flatMap((st) => [[clean(st.name), st.id], [clean(st.code), st.id]] as [string, string][]))
  const valueColumn = spec.kind === 'demand' ? spec.columns.value : spec.columns.seats
  const tracksVolume = spec.kind === 'training' || spec.combine === 'sum'

  const rejects = new Tally<IngestReport['rejects'][number]>()
  const loose = new Tally<IngestReport['looseMatchList'][number]>()
  const seen = new Set<string>()
  const report: IngestReport = {
    sourceId: spec.id, rowsRead: rows.length, rowsMapped: 0, rowsRejected: 0, rowsLooselyMatched: 0, rowsHeld: 0, looseMatches: policy, duplicateRows: 0,
    sectorMismatches: 0, codeConflicts: 0, valueRead: tracksVolume ? 0 : null, valueMapped: tracksVolume ? 0 : null,
    periodMin: null, periodMax: null, pairs: 0, rejects: [], rejectKinds: 0, looseMatchList: [], looseKinds: 0,
  }

  const demand = new Map<string, { fact: DemandFact; values: number[] }>()
  const training = new Map<string, TrainingFact>()
  const pairs = new Set<string>()

  for (const row of rows) {
    const signature = JSON.stringify(row)
    if (seen.has(signature)) report.duplicateRows += 1
    seen.add(signature)

    const volume = tracksVolume ? numberOrNull(row[valueColumn]) : null
    const counted = volume !== null && volume >= 0 && volume <= MAX_COUNT ? volume : null
    if (counted !== null) report.valueRead = (report.valueRead ?? 0) + counted
    const reject = (reason: RejectReason, example: string | null | undefined) => {
      report.rowsRejected += 1
      rejects.add(`${reason}:${example}`, counted, () => ({ reason, example: example && example.length ? example.slice(0, 80) : '(blank)' }))
    }

    const occupationText = row[spec.columns.occupation] ?? ''
    const code = spec.kind === 'demand' && spec.columns.ncoCode ? row[spec.columns.ncoCode] : null
    const trade = matchTradeDetailed(occupationText, code)
    if (!trade.id || !sectorOf.has(trade.id)) { reject(occupationReason(trade), occupationText || code); continue }
    const placeText = row[spec.columns.place] ?? ''
    let district: MatchResult & { qualifier?: string } = matchDistrictDetailed(placeText)
    if (!district.id) { reject(district.failure === 'ambiguous' ? 'place_ambiguous' : 'place_unknown', placeText); continue }
    // "Hyderabad, Karnataka": the text after the comma, or a state column, must agree with the district's state.
    const named = [district.qualifier, 'state' in row ? clean(row.state ?? '') : ''].filter((x): x is string => Boolean(x))
    let conflict = false
    for (const text of named) {
      const stateId = stateByText.get(text)
      if (stateId && stateId !== stateOfDistrict.get(district.id as string)) conflict = true
      // A qualifier we cannot check ("Hyderabad, Sindh") makes the match a suggestion, not a fact.
      else if (!stateId && text === district.qualifier && district.method !== 'spelling') district = { ...district, method: 'place_unknown_qualifier', score: 0.8 }
    }
    if (conflict) { reject('place_conflict', placeText); continue }

    let demandKey: string | null = null
    let demandValue = 0
    let period: string | null = null
    let trainingFact: TrainingFact | null = null
    if (spec.kind === 'demand') {
      period = normalizePeriod(row[spec.columns.period], order)
      if (!period) { reject('period', row[spec.columns.period]); continue }
      if (period > options.today) { reject('period_future', row[spec.columns.period]); continue }
      const value = numberOrNull(row[spec.columns.value])
      // A count written with a decimal point is refused even when it is whole: "1.000" is a thousand to some writers and one to others.
      const inRange = value !== null && value >= 0 && (spec.combine === 'sum' ? Number.isInteger(value) && value <= MAX_COUNT && !row[spec.columns.value].includes('.') : value <= 100)
      if (!inRange) { reject('value', row[spec.columns.value]); continue }
      demandKey = `${district.id}|${trade.id}|${period}`
      demandValue = value as number
    } else {
      const year = normalizeTrainingYear(row[spec.columns.year])
      if (year === null) { reject('period', row[spec.columns.year]); continue }
      // A cycle may be announced a year ahead; further than that is a typing error.
      if (year > Number(options.today.slice(0, 4)) + 1) { reject('period_future', row[spec.columns.year]); continue }
      const seats = numberOrNull(row[spec.columns.seats])
      const enrolled = numberOrNull(row[spec.columns.enrolled])
      const completed = numberOrNull(row[spec.columns.completed])
      const placed = numberOrNull(row[spec.columns.placed])
      const counts = [seats, enrolled, completed, placed]
      const pointed = [spec.columns.seats, spec.columns.enrolled, spec.columns.completed, spec.columns.placed].some((column) => (row[column] ?? '').includes('.'))
      if (seats === null || pointed || counts.some((n) => n !== null && (n < 0 || !Number.isInteger(n) || n > MAX_COUNT))) { reject('value', row[spec.columns.seats]); continue }
      // People cannot complete without enrolling, or be placed without completing.
      if ((completed !== null && (enrolled === null || completed > enrolled)) || (placed !== null && (completed === null || placed > completed))) {
        reject('inconsistent', `${occupationText} / ${placeText} / ${row[spec.columns.year]}`)
        continue
      }
      trainingFact = { districtId: district.id as string, tradeId: trade.id, year, allocatedSeats: seats, enrolled, completed, placed }
      period = String(year)
    }

    // The row is valid. If it was matched by a looser rule, list it; count it only if the loader said so.
    const looseTrade = isLoose(trade)
    const looseDistrict = isLoose(district)
    if (looseTrade) loose.add(`t:${trade.method}:${occupationText || code}`, counted, () => ({ raw: (occupationText || String(code ?? '')).slice(0, 80), mappedTo: trade.id as string, method: trade.method as string, score: trade.score as number }))
    if (looseDistrict) loose.add(`d:${district.method}:${placeText}`, counted, () => ({ raw: placeText.slice(0, 80), mappedTo: district.id as string, method: district.method as string, score: district.score as number }))
    if (looseTrade || looseDistrict) {
      report.rowsLooselyMatched += 1
      if (policy === 'hold') {
        report.rowsHeld += 1
        reject('needs_review', looseTrade ? occupationText || code : placeText)
        continue
      }
    }

    if (demandKey) {
      const entry = demand.get(demandKey) ?? { fact: { districtId: district.id as string, tradeId: trade.id, period: period as string, value: 0 }, values: [] }
      entry.values.push(demandValue)
      demand.set(demandKey, entry)
    } else if (trainingFact) {
      const key = `${trainingFact.districtId}|${trainingFact.tradeId}|${trainingFact.year}`
      const existing = training.get(key)
      const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0))
      training.set(key, {
        ...trainingFact,
        allocatedSeats: (existing?.allocatedSeats ?? 0) + trainingFact.allocatedSeats,
        enrolled: add(existing?.enrolled ?? null, trainingFact.enrolled), completed: add(existing?.completed ?? null, trainingFact.completed), placed: add(existing?.placed ?? null, trainingFact.placed),
      })
    }
    if (!report.periodMin || (period as string) < report.periodMin) report.periodMin = period
    if (!report.periodMax || (period as string) > report.periodMax) report.periodMax = period
    report.rowsMapped += 1
    if (counted !== null) report.valueMapped = (report.valueMapped ?? 0) + counted
    pairs.add(`${district.id}|${trade.id}`)
    if (trade.conflict) report.codeConflicts += 1
    const sectorText = spec.columns.sector ? row[spec.columns.sector] : null
    if (sectorText) {
      const sector = matchSectorDetailed(sectorText)
      if (sector.id && sector.id !== sectorOf.get(trade.id)) report.sectorMismatches += 1
    }
  }

  report.pairs = pairs.size
  report.rejects = rejects.top()
  report.rejectKinds = rejects.kinds
  report.looseMatchList = loose.top()
  report.looseKinds = loose.kinds
  const byPair = (a: { districtId: string; tradeId: string }, b: { districtId: string; tradeId: string }) => `${a.districtId}|${a.tradeId}`.localeCompare(`${b.districtId}|${b.tradeId}`)
  return {
    report,
    demand: [...demand.values()]
      .map(({ fact, values }) => {
        const total = values.reduce((a, b) => a + b, 0)
        const combine = spec.kind === 'demand' ? spec.combine : 'sum'
        return { ...fact, value: combine === 'sum' ? Math.round(total) : Math.round((total / values.length) * 10) / 10 }
      })
      .sort((a, b) => byPair(a, b) || a.period.localeCompare(b.period)),
    training: [...training.values()].sort((a, b) => byPair(a, b) || a.year - b.year),
  }
}
