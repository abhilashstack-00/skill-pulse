/**
 * Creates or updates the schema in the database at DATABASE_URL.
 *
 *   pnpm db:setup                 migrations; and the pilot seed if the database has no data yet
 *   pnpm db:setup --reset         migrations, then REPLACE everything loaded with the pilot seed
 *   pnpm db:setup --local-shim    also create a stand-in for Supabase's auth
 *                                 schema first (plain PostgreSQL, testing only)
 *
 * Without --reset it never removes data: files loaded through the app survive
 * a schema update.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { explainTlsError, pgSsl } from '../lib/repository/ssl'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, or export it in your shell.')
  process.exit(1)
}
const reset = process.argv.includes('--reset')
const files = [
  ...(process.argv.includes('--local-shim') ? ['supabase/local/auth-shim.sql'] : []),
  ...readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => join('supabase/migrations', f)),
]
const SEED = 'supabase/seed.sql'
/** The seed manages its own transaction; strip it so everything stays in the caller's. */
const read = (file: string) => readFileSync(file, 'utf8').replace(/^\s*(begin|commit);\s*$/gim, '')

async function main() {
  const client = new Client({ connectionString: url, ssl: pgSsl(url as string) })
  await client.connect()
  try {
    // All or nothing: a half-applied set of migrations could leave an older, looser policy in force.
    await client.query('begin')
    try {
      for (const file of files) {
        await client.query(read(file))
        console.log(`applied ${file}`)
      }
      const existing = await client.query<{ n: number }>('select (select count(*) from public.dataset_meta)::int + (select count(*) from public.ingestion_runs)::int as n')
      if (reset || existing.rows[0].n === 0) {
        await client.query(read(SEED))
        console.log(`applied ${SEED}${reset ? ' (--reset: previous data replaced)' : ''}`)
      } else {
        console.log('The database already has data, so the seed was not loaded. Use --reset to replace everything with the pilot seed.')
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      console.error('Nothing was changed: the setup was rolled back.')
      throw error
    }
    const counts = await client.query(
      `select (select count(*) from public.labour_demand) as demand_rows,
              (select count(*) from public.training_capacity) as training_rows,
              (select count(*) from public.trades) as trades,
              (select count(*) from public.districts) as districts`,
    )
    console.log('loaded', counts.rows[0])
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(explainTlsError(error) ?? (error instanceof Error ? error.message : error))
  process.exit(1)
})
