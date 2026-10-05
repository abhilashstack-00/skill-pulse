/**
 * Intelligence pipeline: read the stored data, run every engine, and write
 * the results to the derived tables (demand_forecasts, supply_forecasts,
 * gap_analysis) so SQL clients and other systems can use them.
 *
 *   pnpm pipeline          write to the database at DATABASE_URL
 *   pnpm pipeline --sql    write supabase/derived.sql instead (no database needed)
 */
import { writeFileSync } from 'node:fs'
import { Client } from 'pg'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { getRepository } from '@/lib/repository'
import { derivedRows } from '@/lib/server/derived'
import { insert } from './lib/sql'
import { pgSsl } from '../lib/repository/ssl'

async function main() {
  const repository = getRepository()
  const snapshot = buildSnapshot(await repository.loadDataset())
  const derived = derivedRows(snapshot)
  const tables = ['demand_forecasts', 'supply_forecasts', 'gap_analysis'] as const
  const sql = [
    '-- Derived by `pnpm pipeline` from the intelligence layer. Do not edit by hand.',
    'begin;',
    `truncate public.gap_analysis, public.supply_forecasts, public.demand_forecasts restart identity;`,
    ...tables.map((t) => insert(t, derived[t].columns, derived[t].rows)),
    'commit;',
    '',
  ].join('\n\n')

  console.log(`source: ${repository.kind}; cells: ${snapshot.cells.length}; as of ${snapshot.meta.asOfPeriod}`)
  if (process.argv.includes('--sql') || !process.env.DATABASE_URL) {
    writeFileSync('supabase/derived.sql', sql)
    console.log('wrote supabase/derived.sql')
    return
  }
  const url = process.env.DATABASE_URL
  const client = new Client({ connectionString: url, ssl: pgSsl(url) })
  await client.connect()
  try {
    await client.query(sql)
    for (const t of tables) console.log(`${t}: ${derived[t].rows.length} rows written`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
