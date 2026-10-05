import type { Dataset, DatasetMeta, IngestionRun, LabourDemandRow, SourceStatus, TrainingCapacityRow } from '@/lib/domain/types'
import type { IngestOutcome } from './ingest'
import type { SourceSpec } from './sources'

export interface RunInfo {
  fileName: string
  /** ISO timestamp. */
  loadedAt: string
  loadedBy: string | null
  /** merge: add to and overwrite what this source loaded before. replace: remove everything this source loaded before first. */
  mode: 'merge' | 'replace'
  /** Declared by the person loading the file: true for generated or test data. */
  synthetic: boolean
}

export const SYNTHETIC_LABEL = 'Prototype synthetic pilot data'
export const UPLOADED_LABEL = 'Uploaded data, not officially verified'

/**
 * A source stays "synthetic" until a file declared as not synthetic REPLACES
 * everything it loaded before. Merging real rows into synthetic ones leaves the
 * source marked synthetic, because some of its values still are.
 */
export function statusAfter(previous: SourceStatus, run: Pick<RunInfo, 'mode' | 'synthetic'>): SourceStatus {
  if (run.synthetic) return 'prototype_synthetic'
  return run.mode === 'replace' || previous === 'uploaded' ? 'uploaded' : 'prototype_synthetic'
}

/** A month counts as "covered" when at least this share of the busiest month's pairs reported in it. */
export const AS_OF_COVERAGE_SHARE = 0.5

/**
 * The as-of month: the newest month that most pairs have reported for. One row
 * for one pair in a later month does not move "today" for every other pair.
 * `periods` holds one entry per pair-month that has a complete demand volume.
 */
export function asOfPeriod(periods: string[], fallback: string): string {
  const counts = new Map<string, number>()
  for (const period of periods) counts.set(period, (counts.get(period) ?? 0) + 1)
  if (!counts.size) return fallback
  const busiest = Math.max(...counts.values())
  return [...counts.entries()].filter(([, n]) => n >= AS_OF_COVERAGE_SHARE * busiest).map(([period]) => period).sort().at(-1) as string
}

/** The dataset as a whole is synthetic while any source that feeds it still is. */
export function metaAfter(meta: DatasetMeta, statuses: SourceStatus[], facts: { asOfPeriod: string; years: number[] }, loadedAt: string): DatasetMeta {
  const synthetic = statuses.some((s) => s === 'prototype_synthetic')
  return {
    label: synthetic ? SYNTHETIC_LABEL : UPLOADED_LABEL,
    synthetic,
    asOfPeriod: facts.asOfPeriod,
    updatedAt: loadedAt.slice(0, 10),
    // Same rule as the as-of month: one row for a later cycle does not make every other pair's seats out of date.
    currentTrainingYear: facts.years.length ? Number(asOfPeriod(facts.years.map(String), String(meta.currentTrainingYear))) : meta.currentTrainingYear,
  }
}

export function runRecord(id: number, spec: SourceSpec, outcome: IngestOutcome, run: RunInfo): IngestionRun {
  const r = outcome.report
  return {
    id, sourceId: spec.id, fileName: run.fileName, loadedAt: run.loadedAt, loadedBy: run.loadedBy, mode: run.mode, synthetic: run.synthetic,
    rowsRead: r.rowsRead, rowsMapped: r.rowsMapped, rowsRejected: r.rowsRejected, rowsLooselyMatched: r.rowsLooselyMatched, rowsHeld: r.rowsHeld, looseMatches: r.looseMatches,
    valueRead: r.valueRead, valueMapped: r.valueMapped,
    periodMin: r.periodMin, periodMax: r.periodMax, rejects: r.rejects, rejectKinds: r.rejectKinds, looseMatchList: r.looseMatchList, looseKinds: r.looseKinds,
  }
}

/**
 * How many values already stored would be overwritten or removed by this load.
 * Merge replaces this source's value for every district, trade and month (or
 * training year) the file contains; it does not add to it. Replace removes
 * everything the source loaded before.
 */
export function valuesReplaced(dataset: Dataset, spec: SourceSpec, outcome: IngestOutcome, mode: 'merge' | 'replace'): number {
  if (spec.kind === 'demand') {
    const stored = dataset.labourDemand.filter((r) => r[spec.metric] !== null)
    if (mode === 'replace') return stored.length
    const keys = new Set(outcome.demand.map((f) => `${f.districtId}|${f.tradeId}|${f.period}`))
    return stored.filter((r) => keys.has(`${r.districtId}|${r.tradeId}|${r.period}`)).length
  }
  if (mode === 'replace') return dataset.trainingCapacity.length
  const keys = new Set(outcome.training.map((f) => `${f.districtId}|${f.tradeId}|${f.year}`))
  return dataset.trainingCapacity.filter((r) => keys.has(`${r.districtId}|${r.tradeId}|${r.year}`)).length
}

/** Apply one ingested file to an in-memory dataset. Returns a new dataset; the input is not changed. */
export function applyToDataset(dataset: Dataset, spec: SourceSpec, outcome: IngestOutcome, run: RunInfo): Dataset {
  const runId = Math.max(0, ...dataset.ingestionRuns.map((r) => r.id)) + 1
  const sectorOf = new Map(dataset.trades.map((t) => [t.id, t.sectorId]))
  let labourDemand = dataset.labourDemand
  let trainingCapacity = dataset.trainingCapacity

  if (spec.kind === 'demand') {
    const metric = spec.metric
    const rows = new Map<string, LabourDemandRow>(labourDemand.map((r) => [`${r.districtId}|${r.tradeId}|${r.period}`, { ...r, lineage: { ...r.lineage } }]))
    if (run.mode === 'replace') {
      for (const row of rows.values()) {
        row[metric] = null
        delete row.lineage?.[metric]
      }
    }
    for (const fact of outcome.demand) {
      const key = `${fact.districtId}|${fact.tradeId}|${fact.period}`
      const row = rows.get(key) ?? {
        districtId: fact.districtId, sectorId: sectorOf.get(fact.tradeId) as string, tradeId: fact.tradeId, period: fact.period,
        jobPostings: null, hiringSignal: null, employmentRegistrations: null, industryDemandSignal: null, source: spec.id, lineage: {},
      }
      row[metric] = fact.value
      row.lineage = { ...row.lineage, [metric]: runId }
      rows.set(key, row)
    }
    labourDemand = [...rows.values()]
      .filter((r) => r.jobPostings !== null || r.hiringSignal !== null || r.employmentRegistrations !== null || r.industryDemandSignal !== null)
      .sort((a, b) => `${a.districtId}|${a.tradeId}|${a.period}`.localeCompare(`${b.districtId}|${b.tradeId}|${b.period}`))
  } else {
    const rows = new Map<string, TrainingCapacityRow>(run.mode === 'replace' ? [] : trainingCapacity.map((r) => [`${r.districtId}|${r.tradeId}|${r.year}`, r]))
    for (const fact of outcome.training) {
      rows.set(`${fact.districtId}|${fact.tradeId}|${fact.year}`, { ...fact, sectorId: sectorOf.get(fact.tradeId) as string, runId })
    }
    trainingCapacity = [...rows.values()].sort((a, b) => `${a.districtId}|${a.tradeId}|${a.year}`.localeCompare(`${b.districtId}|${b.tradeId}|${b.year}`))
  }

  const dataSources = dataset.dataSources.map((s) =>
    s.id === spec.id
      ? { ...s, status: statusAfter(s.status, run), lastUpdated: run.loadedAt.slice(0, 10), recordsIn: outcome.report.rowsRead, recordsMapped: outcome.report.rowsMapped }
      : s,
  )
  const feeding = dataSources.filter((s) => s.sourceType !== 'reference' && s.status !== 'planned').map((s) => s.status)
  return {
    ...dataset,
    meta: metaAfter(
      dataset.meta,
      feeding,
      {
        asOfPeriod: asOfPeriod(labourDemand.filter((r) => r.jobPostings !== null && r.employmentRegistrations !== null).map((r) => r.period), dataset.meta.asOfPeriod),
        years: trainingCapacity.map((r) => r.year),
      },
      run.loadedAt,
    ),
    labourDemand,
    trainingCapacity,
    dataSources,
    ingestionRuns: [...dataset.ingestionRuns, runRecord(runId, spec, outcome, run)],
  }
}
