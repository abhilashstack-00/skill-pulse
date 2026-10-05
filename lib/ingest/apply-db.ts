import type { Pool, PoolClient } from 'pg'
import type { DatasetMeta, IngestionRun, SourceStatus } from '@/lib/domain/types'
import { AS_OF_COVERAGE_SHARE, metaAfter, runRecord, statusAfter, type RunInfo } from './apply'
import type { IngestOutcome } from './ingest'
import { METRIC_COLUMN, type SourceSpec } from './sources'

/** One load at a time: two concurrent loads must not take the same run id. */
const LOCK_KEY = 771001

/**
 * Apply one ingested file to the database in a single transaction: either the
 * run, its rows, the source's status and the dataset's as-of month all change,
 * or nothing does. The rules are the same as apply.ts uses for the bundled file.
 */
export async function applyToDatabase(pool: Pool, spec: SourceSpec, outcome: IngestOutcome, run: RunInfo): Promise<IngestionRun> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY])
    const next = await client.query<{ id: number }>('select coalesce(max(id), 0) + 1 as id from public.ingestion_runs')
    const record = runRecord(Number(next.rows[0].id), spec, outcome, run)
    await client.query(
      `insert into public.ingestion_runs (id, source_id, file_name, loaded_at, loaded_by, mode, synthetic, rows_read, rows_mapped, rows_rejected, rows_loosely_matched,
         rows_held, loose_policy, value_read, value_mapped, period_min, period_max, rejects, reject_kinds, loose_matches, loose_kinds)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20::jsonb, $21)`,
      [record.id, record.sourceId, record.fileName, record.loadedAt, record.loadedBy, record.mode, record.synthetic, record.rowsRead, record.rowsMapped,
        record.rowsRejected, record.rowsLooselyMatched, record.rowsHeld, record.looseMatches, record.valueRead, record.valueMapped, record.periodMin, record.periodMax,
        JSON.stringify(record.rejects), record.rejectKinds, JSON.stringify(record.looseMatchList), record.looseKinds],
    )

    if (spec.kind === 'demand') await writeDemand(client, spec, outcome, run, record.id)
    else await writeTraining(client, outcome, run, record.id)

    const source = await client.query<{ status: SourceStatus }>('select status from public.data_sources where id = $1 for update', [spec.id])
    if (!source.rows[0]) throw new Error(`data_sources has no row for ${spec.id}`)
    await client.query('update public.data_sources set status = $2, last_updated = $3::date, records_in = $4, records_mapped = $5 where id = $1', [
      spec.id, statusAfter(source.rows[0].status, run), run.loadedAt.slice(0, 10), outcome.report.rowsRead, outcome.report.rowsMapped,
    ])

    const feeding = await client.query<{ status: SourceStatus }>("select status from public.data_sources where source_type <> 'reference' and status <> 'planned'")
    // The newest month that most pairs have reported for (see asOfPeriod in apply.ts: same rule).
    const facts = await client.query<{ period: string | null; year: number | null }>(
      `with months as (
         select period, count(*) as pairs from public.labour_demand
         where job_postings is not null and employment_registrations is not null group by period
       ), years as (
         select year, count(*) as pairs from public.training_capacity group by year
       )
       select (select to_char(max(period), 'YYYY-MM') from months where pairs >= $1::numeric * (select max(pairs) from months)) as period,
              (select max(year) from years where pairs >= $1::numeric * (select max(pairs) from years)) as year`,
      [AS_OF_COVERAGE_SHARE],
    )
    const current = await client.query<{ label: string; synthetic: boolean; as_of: string; updated: string; year: number }>(
      "select label, synthetic, to_char(as_of_period, 'YYYY-MM') as as_of, to_char(updated_at, 'YYYY-MM-DD') as updated, current_training_year as year from public.dataset_meta",
    )
    const before: DatasetMeta = current.rows[0]
      ? { label: current.rows[0].label, synthetic: current.rows[0].synthetic, asOfPeriod: current.rows[0].as_of, updatedAt: current.rows[0].updated, currentTrainingYear: Number(current.rows[0].year) }
      : { label: '', synthetic: true, asOfPeriod: run.loadedAt.slice(0, 7), updatedAt: run.loadedAt.slice(0, 10), currentTrainingYear: Number(run.loadedAt.slice(0, 4)) }
    const meta = metaAfter(
      before,
      feeding.rows.map((r) => r.status),
      { asOfPeriod: facts.rows[0].period ?? before.asOfPeriod, years: facts.rows[0].year === null ? [] : [Number(facts.rows[0].year)] },
      run.loadedAt,
    )
    await client.query('update public.dataset_meta set label = $1, synthetic = $2, as_of_period = $3::date, updated_at = $4::date, current_training_year = $5', [
      meta.label, meta.synthetic, `${meta.asOfPeriod}-01`, meta.updatedAt, meta.currentTrainingYear,
    ])
    await client.query('commit')
    return record
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function writeDemand(client: PoolClient, spec: Extract<SourceSpec, { kind: 'demand' }>, outcome: IngestOutcome, run: RunInfo, runId: number) {
  // The column name comes from a fixed table in sources.ts, never from the request.
  const column = METRIC_COLUMN[spec.metric]
  if (run.mode === 'replace') {
    await client.query(`update public.labour_demand set ${column} = null, lineage = lineage - $1`, [spec.metric])
  }
  const facts = outcome.demand
  for (let i = 0; i < facts.length; i += 2000) {
    const batch = facts.slice(i, i + 2000)
    await client.query(
      `insert into public.labour_demand (district_id, sector_id, trade_id, period, ${column}, source, lineage)
       select x.district_id, t.sector_id, x.trade_id, (x.period || '-01')::date, x.value, $5, jsonb_build_object($6::text, $7::bigint)
       from unnest($1::text[], $2::text[], $3::text[], $4::numeric[]) as x(district_id, trade_id, period, value)
       join public.trades t on t.id = x.trade_id
       on conflict (district_id, trade_id, period)
       do update set ${column} = excluded.${column}, lineage = public.labour_demand.lineage || excluded.lineage`,
      [batch.map((f) => f.districtId), batch.map((f) => f.tradeId), batch.map((f) => f.period), batch.map((f) => f.value), spec.id, spec.metric, runId],
    )
  }
  await client.query(
    'delete from public.labour_demand where job_postings is null and hiring_signal is null and employment_registrations is null and industry_demand_signal is null',
  )
}

async function writeTraining(client: PoolClient, outcome: IngestOutcome, run: RunInfo, runId: number) {
  if (run.mode === 'replace') await client.query('delete from public.training_capacity')
  const facts = outcome.training
  for (let i = 0; i < facts.length; i += 2000) {
    const batch = facts.slice(i, i + 2000)
    await client.query(
      `insert into public.training_capacity (district_id, sector_id, trade_id, year, allocated_seats, enrolled, completed, placed, run_id)
       select x.district_id, t.sector_id, x.trade_id, x.year, x.seats, x.enrolled, x.completed, x.placed, $8
       from unnest($1::text[], $2::text[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[]) as x(district_id, trade_id, year, seats, enrolled, completed, placed)
       join public.trades t on t.id = x.trade_id
       on conflict (district_id, trade_id, year)
       do update set allocated_seats = excluded.allocated_seats, enrolled = excluded.enrolled, completed = excluded.completed, placed = excluded.placed, run_id = excluded.run_id`,
      [batch.map((f) => f.districtId), batch.map((f) => f.tradeId), batch.map((f) => f.year), batch.map((f) => f.allocatedSeats),
        batch.map((f) => f.enrolled), batch.map((f) => f.completed), batch.map((f) => f.placed), runId],
    )
  }
}
