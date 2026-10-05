/**
 * Builds the pilot dataset: every raw extract in data/pilot/raw goes through
 * the same ingestion code the upload endpoint and `pnpm ingest` use.
 *
 * Writes
 *   data/pilot/dataset.json        used when the app runs without a database
 *   data/pilot/ingest-report.json  what was mapped, matched loosely or refused
 *   supabase/seed.sql              the same rows as SQL inserts
 *
 * Run: pnpm data:ingest
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Dataset } from '@/lib/domain/types'
import { applyToDataset } from '@/lib/ingest/apply'
import { ingestExtract, type IngestReport } from '@/lib/ingest/ingest'
import { SOURCE_SPECS } from '@/lib/ingest/sources'
import { datasetToSql } from './lib/sql'
import { dataSources, districts, meta, sectors, states, trades, trainingCentres } from './pilot/reference'

const RAW = join(process.cwd(), 'data/pilot/raw')
/** Fixed so the build is reproducible: the day the pilot extracts were generated. */
const LOADED_AT = `${meta.updatedAt}T00:00:00.000Z`

let dataset: Dataset = {
  meta, states, districts, sectors, trades, trainingCentres,
  trainingCapacity: [],
  labourDemand: [],
  dataSources: dataSources.map((source) => ({ ...source, lastUpdated: null, recordsIn: null, recordsMapped: null })),
  ingestionRuns: [],
}

const reports: IngestReport[] = []
for (const spec of SOURCE_SPECS) {
  const fileName = `${spec.rawFile}.csv`
  // The pilot counts rows matched by a looser rule (and lists them), so that its demand is not
  // understated further. A file loaded by a person holds them for review unless told otherwise.
  const outcome = ingestExtract(spec, readFileSync(join(RAW, fileName), 'utf8'), { trades, districts, states }, { looseMatches: 'count', today: meta.asOfPeriod })
  dataset = applyToDataset(dataset, spec, outcome, { fileName, loadedAt: LOADED_AT, loadedBy: null, mode: 'replace', synthetic: true })
  reports.push(outcome.report)
  const r = outcome.report
  const volume = r.valueRead ? `; ${((100 * (r.valueMapped ?? 0)) / r.valueRead).toFixed(1)}% of volume mapped` : ''
  console.log(`${spec.id}: ${r.rowsMapped}/${r.rowsRead} rows mapped (${r.rowsLooselyMatched} by a looser rule), ${r.rowsRejected} rejected${volume}`)
}
// The reference mapping is dated with the build as well.
dataset = { ...dataset, dataSources: dataset.dataSources.map((s) => (s.status === 'prototype_reference' ? { ...s, lastUpdated: meta.updatedAt } : s)) }

writeFileSync(join(process.cwd(), 'data/pilot/dataset.json'), JSON.stringify(dataset))
writeFileSync(join(process.cwd(), 'data/pilot/ingest-report.json'), JSON.stringify({ generatedFor: dataset.meta.asOfPeriod, reports }, null, 2) + '\n')
writeFileSync(join(process.cwd(), 'supabase/seed.sql'), datasetToSql(dataset))
console.log(`dataset: ${dataset.labourDemand.length} demand rows, ${dataset.trainingCapacity.length} training rows, as of ${dataset.meta.asOfPeriod}`)
