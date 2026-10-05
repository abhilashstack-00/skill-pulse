/**
 * Creates the schema and loads the pilot seed into the database at DATABASE_URL.
 *
 *   pnpm db:setup                 migrations + seed
 *   pnpm db:setup --local-shim    also create a stand-in for Supabase's auth
 *                                 schema first (plain PostgreSQL, testing only)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { pgSsl } from '../lib/repository/ssl'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, or export it in your shell.')
  process.exit(1)
}
const files = [
  ...(process.argv.includes('--local-shim') ? ['supabase/local/auth-shim.sql'] : []),
  ...readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => join('supabase/migrations', f)),
  'supabase/seed.sql',
]

async function main() {
  const client = new Client({ connectionString: url, ssl: pgSsl(url as string) })
  await client.connect()
  try {
    for (const file of files) {
      await client.query(readFileSync(file, 'utf8'))
      console.log(`applied ${file}`)
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
  console.error(error)
  process.exit(1)
})
