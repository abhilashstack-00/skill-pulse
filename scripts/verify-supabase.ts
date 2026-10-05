/**
 * Checks a real Supabase project end to end. Run it once after connecting one:
 *
 *   pnpm db:setup && pnpm pipeline
 *   DEMO_USER_PASSWORD='…' pnpm demo:users
 *   DEMO_USER_PASSWORD='…' pnpm verify:supabase
 *
 * It signs in as each demo user with the public (anon) key, exactly as a
 * browser would, and checks what row level security lets that user read and
 * write; then it checks that the application's own two ways of asking "what
 * can this user see?" give the same answer. It changes nothing.
 *
 * This script could not be run while the project was built (no Supabase
 * project was reachable). Its checks mirror supabase/tests/rls-check.sql,
 * which was run against plain PostgreSQL.
 */
import { createClient } from '@supabase/supabase-js'
import { getPool, PostgresRepository } from '@/lib/repository/postgres'
import { explainTlsError } from '@/lib/repository/ssl'
import { SupabaseRestRepository } from '@/lib/repository/supabase-rest'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const databaseUrl = process.env.DATABASE_URL
const password = process.env.DEMO_USER_PASSWORD
const domain = process.env.DEMO_USER_DOMAIN ?? 'skillpulse.example'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const EXPECTED: { email: string; districts: string[] | 'all'; canWrite: boolean }[] = [
  { email: `admin@${domain}`, districts: 'all', canWrite: true },
  { email: `national@${domain}`, districts: 'all', canWrite: false },
  { email: `telangana@${domain}`, districts: ['hyderabad', 'rangareddy', 'warangal'], canWrite: false },
  { email: `warangal@${domain}`, districts: ['warangal'], canWrite: false },
  { email: `employer@${domain}`, districts: 'all', canWrite: false },
]

async function main() {
  const missing = Object.entries({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey, DEMO_USER_PASSWORD: password }).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) {
    console.error(`Set ${missing.join(', ')} first (see .env.example).`)
    process.exit(1)
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } }

  // 1. Signed out: the public key alone reads nothing.
  const anon = createClient(url as string, anonKey as string, options)
  const signedOut = await anon.from('labour_demand').select('id', { count: 'exact', head: true })
  check('signed out: no demand rows are readable', Boolean(signedOut.error) || (signedOut.count ?? 0) === 0, signedOut.error?.message ?? `${signedOut.count} rows`)

  // 2. The service-role reader (used when DATABASE_URL is not set) reads the whole dataset.
  const rest = new SupabaseRestRepository(createClient(url as string, serviceKey as string, options))
  const viaRest = await rest.loadDataset()
  check('REST reader loads the dataset', viaRest.labourDemand.length > 0 && viaRest.ingestionRuns.length > 0, `${viaRest.labourDemand.length} demand rows, ${viaRest.ingestionRuns.length} loads`)
  const allDistricts = viaRest.districts.map((d) => d.id).sort()

  const postgres = databaseUrl ? new PostgresRepository(databaseUrl) : null
  if (postgres) {
    const viaPg = await postgres.loadDataset()
    check('direct connection and REST reader return the same number of rows', viaPg.labourDemand.length === viaRest.labourDemand.length && viaPg.trainingCapacity.length === viaRest.trainingCapacity.length)
    const rls = await getPool(databaseUrl as string).query<{ n: number }>("select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")
    check('row level security is enabled on every table', rls.rows[0].n === 0, `${rls.rows[0].n} without`)
  } else console.log('note  DATABASE_URL is not set: direct-connection checks skipped')

  // 3. Each demo user, signed in the way the browser signs in.
  for (const expected of EXPECTED) {
    const client = createClient(url as string, anonKey as string, options)
    const signIn = await client.auth.signInWithPassword({ email: expected.email, password: password as string })
    if (signIn.error || !signIn.data.user) {
      check(`${expected.email}: can sign in`, false, signIn.error?.message ?? 'no user')
      continue
    }
    const want = expected.districts === 'all' ? allDistricts : expected.districts
    const rpc = await client.rpc('visible_district_ids')
    const visible = ((rpc.data ?? []) as unknown[]).map((row) => (typeof row === 'string' ? row : String(Object.values(row as object)[0]))).sort()
    check(`${expected.email}: the database shows exactly its districts`, !rpc.error && JSON.stringify(visible) === JSON.stringify(want), rpc.error?.message ?? visible.join(', '))

    const rows = await client.from('labour_demand').select('district_id').limit(5000)
    const seen = [...new Set((rows.data ?? []).map((r) => r.district_id as string))].sort()
    check(`${expected.email}: demand rows come only from those districts`, !rows.error && seen.every((d) => want.includes(d)) && seen.length > 0, rows.error?.message ?? seen.join(', '))

    // An update that changes nothing: allowed for the administrator, zero rows for everyone else.
    const write = await client.from('data_sources').update({ coverage: viaRest.dataSources[0].coverage }).eq('id', viaRest.dataSources[0].id).select('id')
    const wrote = !write.error && (write.data ?? []).length > 0
    check(`${expected.email}: ${expected.canWrite ? 'can' : 'cannot'} write`, wrote === expected.canWrite, write.error?.message ?? `${(write.data ?? []).length} row(s)`)

    const promote = await client.from('profiles').update({ role: 'admin' }).eq('id', signIn.data.user.id).select('id')
    if (!expected.canWrite) check(`${expected.email}: cannot change its own role`, Boolean(promote.error) || (promote.data ?? []).length === 0)

    if (postgres) {
      const viaTransaction = [...(await postgres.visibleDistrictIds(signIn.data.user.id))].sort()
      check(`${expected.email}: the application's direct-connection check agrees`, JSON.stringify(viaTransaction) === JSON.stringify(visible), viaTransaction.join(', '))
    }
    await client.auth.signOut()
  }

  if (postgres) await getPool(databaseUrl as string).end()
  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(explainTlsError(error) ?? (error instanceof Error ? error.message : error))
  process.exit(1)
})
