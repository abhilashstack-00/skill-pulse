/**
 * Intelligence pipeline: read the stored data, run every engine, and write the
 * results to the derived tables (demand_forecasts, supply_forecasts,
 * gap_analysis) for SQL and BI clients. The application does not read these
 * tables; it computes the same figures from the fact tables. They are also
 * refreshed automatically after every data load.
 *
 *   pnpm pipeline          write to the database at DATABASE_URL
 *   pnpm pipeline --sql    write supabase/derived.sql instead (no database needed)
 */
import { writeFileSync } from 'node:fs'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { getRepository } from '@/lib/repository'
import { getPool } from '@/lib/repository/postgres'
import { explainTlsError } from '@/lib/repository/ssl'
import { derivedRows } from '@/lib/server/derived'
import { writeDerived } from '@/lib/server/derived-write'
import { insert } from './lib/sql'

async function main() {
  const repository = getRepository()
  const snapshot = buildSnapshot(await repository.loadDataset())
  console.log(`source: ${repository.kind}; pairs: ${snapshot.cells.length}; as of ${snapshot.meta.asOfPeriod}`)
  const url = process.env.DATABASE_URL
  if (process.argv.includes('--sql') || !url) {
    const derived = derivedRows(snapshot)
    const tables = ['demand_forecasts', 'supply_forecasts', 'gap_analysis'] as const
    const sql = [
      '-- Derived by `pnpm pipeline --sql` from the intelligence layer. Do not edit by hand.',
      'begin;',
      'truncate public.gap_analysis, public.supply_forecasts, public.demand_forecasts restart identity;',
      ...tables.map((t) => insert(t, derived[t].columns, derived[t].rows)),
      'update public.dataset_meta set derived_at = now();',
      'commit;',
      '',
    ].join('\n\n')
    writeFileSync('supabase/derived.sql', sql)
    console.log('wrote supabase/derived.sql')
    return
  }
  const pool = getPool(url)
  const client = await pool.connect()
  try {
    await client.query('begin')
    const counts = await writeDerived(client, snapshot)
    await client.query('commit')
    for (const [table, rows] of Object.entries(counts)) console.log(`${table}: ${rows} rows written`)
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(explainTlsError(error) ?? error)
  process.exit(1)
})
