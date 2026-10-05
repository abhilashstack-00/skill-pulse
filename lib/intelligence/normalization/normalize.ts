import type { LabourDemandRow, TrainingCapacityRow } from '@/lib/domain/types'
import { DISTRICT_ALIASES, MONTH_NAMES, NCO_TO_TRADE, SECTOR_ALIASES, TITLE_NOISE, TRADE_ALIASES } from './mappings'

/** Lower-case, strip punctuation, collapse spaces. */
export function clean(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function invert(aliases: Record<string, string[]>): Map<string, string> {
  const index = new Map<string, string>()
  for (const [id, names] of Object.entries(aliases)) for (const name of names) index.set(clean(name), id)
  return index
}

const tradeIndex = invert(TRADE_ALIASES)
const districtIndex = invert(DISTRICT_ALIASES)
const sectorIndex = invert(SECTOR_ALIASES)
const noise = new Set(TITLE_NOISE.flatMap((n) => clean(n).split(' ')))

/** Occupation → trade id. An NCO code wins over the free-text title. */
export function matchTrade(title: string | null, ncoCode?: string | null): string | null {
  if (ncoCode) {
    const byCode = NCO_TO_TRADE[ncoCode.trim().slice(0, 4)]
    if (byCode) return byCode
  }
  if (!title) return null
  const cleaned = clean(title)
  const direct = tradeIndex.get(cleaned)
  if (direct) return direct
  const stripped = cleaned.split(' ').filter((word) => !noise.has(word)).join(' ')
  return tradeIndex.get(stripped) ?? null
}

export function matchDistrict(place: string | null): string | null {
  if (!place) return null
  const cleaned = clean(place)
  return districtIndex.get(cleaned) ?? districtIndex.get(cleaned.replace(/ (district|dist|city)$/, '')) ?? null
}

export function matchSector(label: string | null): string | null {
  return label ? sectorIndex.get(clean(label)) ?? null : null
}

/** '2026-09', '2026-09-15', '01/09/2026', 'Sep-2026', 'September 2026' → '2026-09'. */
export function normalizePeriod(value: string | null): string | null {
  if (!value) return null
  const v = value.trim()
  let m = v.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/)
  if (m) return valid(+m[1], +m[2])
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return valid(+m[3], +m[2])
  m = v.match(/^([A-Za-z]{3,9})[ -](\d{4})$/)
  if (m) return valid(+m[2], MONTH_NAMES.indexOf(m[1].slice(0, 3).toLowerCase()) + 1)
  return null
}

function valid(year: number, month: number): string | null {
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : null
}

/** '2026-27' or '2026' → 2026 (start year of the training cycle). */
export function normalizeTrainingYear(value: string | null): number | null {
  const m = value?.trim().match(/^(\d{4})(?:-\d{2,4})?$/)
  return m ? +m[1] : null
}

/* ------------------------------ Demand ingest ----------------------------- */

export type DemandMetric = 'jobPostings' | 'hiringSignal' | 'employmentRegistrations' | 'industryDemandSignal'

/** One record from any demand source, after reading but before mapping. */
export interface RawDemandRecord {
  source: string
  metric: DemandMetric
  period: string | null
  occupation: string | null
  ncoCode?: string | null
  place: string | null
  sector?: string | null
  value: number | null
}

export interface SourceReport {
  source: string
  recordsIn: number
  recordsMapped: number
  unmapped: { reason: 'occupation' | 'place' | 'period' | 'value'; example: string; count: number }[]
}

const COUNT_METRICS: DemandMetric[] = ['jobPostings', 'employmentRegistrations']

/**
 * Map raw records onto (district, trade, month) and combine them:
 * counts are summed, 0–100 scores are averaged. Records that cannot be mapped
 * are reported, never guessed. A metric with no records stays null.
 */
export function normalizeDemand(
  records: RawDemandRecord[],
  sectorOfTrade: Map<string, string>,
  datasetTag: string,
): { rows: LabourDemandRow[]; reports: SourceReport[] } {
  const cells = new Map<string, { districtId: string; tradeId: string; period: string; values: Record<DemandMetric, number[]> }>()
  const reports = new Map<string, SourceReport>()
  const rejects = new Map<string, Map<string, { reason: SourceReport['unmapped'][number]['reason']; example: string; count: number }>>()

  const reject = (source: string, reason: SourceReport['unmapped'][number]['reason'], example: string) => {
    const bySource = rejects.get(source) ?? new Map()
    const key = `${reason}:${example}`
    const entry = bySource.get(key) ?? { reason, example, count: 0 }
    entry.count += 1
    bySource.set(key, entry)
    rejects.set(source, bySource)
  }

  for (const record of records) {
    const report = reports.get(record.source) ?? { source: record.source, recordsIn: 0, recordsMapped: 0, unmapped: [] }
    reports.set(record.source, report)
    report.recordsIn += 1

    const tradeId = matchTrade(record.occupation, record.ncoCode)
    if (!tradeId || !sectorOfTrade.has(tradeId)) { reject(record.source, 'occupation', record.occupation ?? record.ncoCode ?? '(blank)'); continue }
    const districtId = matchDistrict(record.place)
    if (!districtId) { reject(record.source, 'place', record.place ?? '(blank)'); continue }
    const period = normalizePeriod(record.period)
    if (!period) { reject(record.source, 'period', record.period ?? '(blank)'); continue }
    if (record.value === null || !Number.isFinite(record.value) || record.value < 0) { reject(record.source, 'value', String(record.value)); continue }

    report.recordsMapped += 1
    const key = `${districtId}|${tradeId}|${period}`
    const cell = cells.get(key) ?? { districtId, tradeId, period, values: { jobPostings: [], hiringSignal: [], employmentRegistrations: [], industryDemandSignal: [] } }
    cell.values[record.metric].push(record.value)
    cells.set(key, cell)
  }

  const combine = (metric: DemandMetric, values: number[]): number | null => {
    if (!values.length) return null
    const total = values.reduce((a, b) => a + b, 0)
    return COUNT_METRICS.includes(metric) ? Math.round(total) : Math.round((total / values.length) * 10) / 10
  }

  const rows: LabourDemandRow[] = [...cells.values()]
    .sort((a, b) => `${a.districtId}|${a.tradeId}|${a.period}`.localeCompare(`${b.districtId}|${b.tradeId}|${b.period}`))
    .map((cell) => ({
      districtId: cell.districtId,
      sectorId: sectorOfTrade.get(cell.tradeId) as string,
      tradeId: cell.tradeId,
      period: cell.period,
      jobPostings: combine('jobPostings', cell.values.jobPostings),
      hiringSignal: combine('hiringSignal', cell.values.hiringSignal),
      employmentRegistrations: combine('employmentRegistrations', cell.values.employmentRegistrations),
      industryDemandSignal: combine('industryDemandSignal', cell.values.industryDemandSignal),
      source: datasetTag,
    }))

  for (const [source, entries] of rejects) {
    const report = reports.get(source)
    if (report) report.unmapped = [...entries.values()].sort((a, b) => b.count - a.count)
  }
  return { rows, reports: [...reports.values()] }
}

/* ------------------------------ Supply ingest ----------------------------- */

export interface RawTrainingRecord {
  year: string | null
  place: string | null
  occupation: string | null
  allocatedSeats: number | null
  enrolled: number | null
  completed: number | null
  placed: number | null
}

export function normalizeTraining(records: RawTrainingRecord[], sectorOfTrade: Map<string, string>): { rows: TrainingCapacityRow[]; report: SourceReport } {
  const report: SourceReport = { source: 'training_capacity', recordsIn: records.length, recordsMapped: 0, unmapped: [] }
  const rows = new Map<string, TrainingCapacityRow>()
  const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0))
  for (const record of records) {
    const tradeId = matchTrade(record.occupation)
    const districtId = matchDistrict(record.place)
    const year = normalizeTrainingYear(record.year)
    if (!tradeId || !sectorOfTrade.has(tradeId) || !districtId || year === null || record.allocatedSeats === null) {
      const reason = !tradeId ? 'occupation' : !districtId ? 'place' : year === null ? 'period' : 'value'
      const example = String(!tradeId ? record.occupation : !districtId ? record.place : year === null ? record.year : record.allocatedSeats)
      const found = report.unmapped.find((u) => u.reason === reason && u.example === example)
      if (found) found.count += 1
      else report.unmapped.push({ reason, example, count: 1 })
      continue
    }
    report.recordsMapped += 1
    const key = `${districtId}|${tradeId}|${year}`
    const existing = rows.get(key)
    rows.set(key, {
      districtId, sectorId: sectorOfTrade.get(tradeId) as string, tradeId, year,
      allocatedSeats: (existing?.allocatedSeats ?? 0) + record.allocatedSeats,
      enrolled: add(existing?.enrolled ?? null, record.enrolled),
      completed: add(existing?.completed ?? null, record.completed),
      placed: add(existing?.placed ?? null, record.placed),
    })
  }
  return { rows: [...rows.values()].sort((a, b) => `${a.districtId}|${a.tradeId}|${a.year}`.localeCompare(`${b.districtId}|${b.tradeId}|${b.year}`)), report }
}
