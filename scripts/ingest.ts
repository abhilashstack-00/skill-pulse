/**
 * Ingest: raw extracts → normalisation layer → one normalised dataset.
 *
 * Writes
 *   data/pilot/dataset.json        used when the app runs without Supabase
 *   data/pilot/ingest-report.json  what was mapped and what was rejected
 *   supabase/seed.sql              the same rows as SQL inserts
 *
 * Run: pnpm data:ingest
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DataSource, Dataset } from '@/lib/domain/types'
import { normalizeDemand, normalizeTraining, type RawDemandRecord, type RawTrainingRecord } from '@/lib/intelligence/normalization/normalize'
import { numberOrNull, readCsv } from './lib/csv'
import { DATASET_TAG, dataSources, districts, meta, sectors, states, trades, trainingCentres } from './pilot/reference'
import { datasetToSql } from './lib/sql'

const RAW = join(process.cwd(), 'data/pilot/raw')
const raw = (name: string) => readCsv(join(RAW, `${name}.csv`))

/** Each reader turns one source's own columns into the common raw-record shape. */
const demandRecords: RawDemandRecord[] = [
  ...raw('job_portal').map((r) => ({ source: 'job_portal', metric: 'jobPostings' as const, period: r.posting_date, occupation: r.job_title, place: r.city, sector: r.industry, value: numberOrNull(r.openings) })),
  ...raw('employment_exchange').map((r) => ({ source: 'employment_exchange', metric: 'employmentRegistrations' as const, period: r.period, occupation: r.occupation, ncoCode: r.nco_code, place: r.district, value: numberOrNull(r.vacancies) })),
  ...raw('industry_hiring').map((r) => ({ source: 'industry_hiring', metric: 'hiringSignal' as const, period: r.month, occupation: r.role, place: r.location, sector: r.sector, value: numberOrNull(r.hiring_intent_score) })),
  ...raw('industry_survey').map((r) => ({ source: 'industry_survey', metric: 'industryDemandSignal' as const, period: r.survey_month, occupation: r.trade, place: r.district, value: numberOrNull(r.outlook_score) })),
]
const trainingRecords: RawTrainingRecord[] = raw('training_capacity').map((r) => ({
  year: r.training_year, place: r.district, occupation: r.trade,
  allocatedSeats: numberOrNull(r.allocated_seats), enrolled: numberOrNull(r.enrolled), completed: numberOrNull(r.completed), placed: numberOrNull(r.placed),
}))

const sectorOfTrade = new Map(trades.map((t) => [t.id, t.sectorId]))
const demand = normalizeDemand(demandRecords, sectorOfTrade, DATASET_TAG)
const training = normalizeTraining(trainingRecords, sectorOfTrade)
const reports = [...demand.reports, training.report]

const sources: DataSource[] = dataSources.map(({ rawFile, ...source }) => {
  const report = reports.find((r) => r.source === rawFile)
  return {
    ...source,
    lastUpdated: source.status === 'planned' ? null : meta.updatedAt,
    recordsIn: report?.recordsIn ?? null,
    recordsMapped: report?.recordsMapped ?? null,
  }
})

const dataset: Dataset = {
  meta, states, districts, sectors, trades, trainingCentres,
  trainingCapacity: training.rows,
  labourDemand: demand.rows,
  dataSources: sources,
}

writeFileSync(join(process.cwd(), 'data/pilot/dataset.json'), JSON.stringify(dataset))
writeFileSync(join(process.cwd(), 'data/pilot/ingest-report.json'), JSON.stringify({ generatedFor: meta.asOfPeriod, reports }, null, 2) + '\n')
writeFileSync(join(process.cwd(), 'supabase/seed.sql'), datasetToSql(dataset))

for (const r of reports) console.log(`${r.source}: ${r.recordsMapped}/${r.recordsIn} mapped, ${r.recordsIn - r.recordsMapped} rejected`)
console.log(`dataset: ${dataset.labourDemand.length} demand rows, ${dataset.trainingCapacity.length} training rows`)
