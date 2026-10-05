/**
 * Creates the evaluator account behind "Continue with Demo Account": one real
 * Supabase Auth user, a national planner, approved, and marked as the
 * evaluator account so the application treats it as read-only.
 *
 *   DEMO_ACCOUNT_EMAIL='evaluator@your-domain' DEMO_ACCOUNT_PASSWORD='long-random-value' pnpm demo:evaluator
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
 * Set the same two DEMO_ACCOUNT_* values on the server that runs the app, and
 * nowhere else: nobody types this password, the server signs in with it.
 * Use a password of its own, not the one shared by the other demo users.
 *
 * Safe to run again: an existing account keeps its id, and its password, mark
 * and profile are set to the values given here.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const email = process.env.DEMO_ACCOUNT_EMAIL?.trim().toLowerCase()
const password = process.env.DEMO_ACCOUNT_PASSWORD
const FULL_NAME = 'SIH Evaluator'
/** Must match EVALUATOR_ACCOUNT_TYPE in lib/server/session.ts. */
const ACCOUNT_TYPE = 'evaluator_demo'

if (!url || !serviceKey) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).')
  process.exit(1)
}
if (!email || !password || password.length < 20) {
  console.error('Set DEMO_ACCOUNT_EMAIL, and DEMO_ACCOUNT_PASSWORD to a random value of at least 20 characters. No default is provided on purpose.')
  process.exit(1)
}

async function main() {
  const headers = { apikey: serviceKey as string, Authorization: `Bearer ${serviceKey as string}`, 'Content-Type': 'application/json' }
  const authUrl = `${(url as string).replace(/\/+$/, '')}/auth/v1/admin/users`
  const fail = (what: string, body: { msg?: string; message?: string }, response: Response) => new Error(`${what}: ${body.msg ?? body.message ?? response.statusText}`)

  let id: string | undefined
  for (let page = 1; !id; page += 1) {
    const response = await fetch(`${authUrl}?page=${page}&per_page=200`, { headers })
    const body = await response.json() as { users?: { email?: string; id: string }[]; msg?: string; message?: string }
    if (!response.ok) throw fail('Could not list users', body, response)
    id = (body.users ?? []).find((user) => user.email?.toLowerCase() === email)?.id
    if ((body.users ?? []).length < 200) break
  }

  const account = { password, email_confirm: true, user_metadata: { full_name: FULL_NAME }, app_metadata: { account_type: ACCOUNT_TYPE } }
  const response = id
    ? await fetch(`${authUrl}/${id}`, { method: 'PUT', headers, body: JSON.stringify(account) })
    : await fetch(authUrl, { method: 'POST', headers, body: JSON.stringify({ email, ...account }) })
  const body = await response.json() as { id?: string; msg?: string; message?: string }
  if (!response.ok || !body.id) throw fail(`Could not ${id ? 'update' : 'create'} ${email}`, body, response)

  const supabase = createClient(url as string, serviceKey as string, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: body.id, full_name: FULL_NAME, role: 'national_planner', state_id: null, district_id: null, approved: true }, { onConflict: 'id' })
  if (error) throw new Error(`Could not set the profile for ${email}: ${error.message}`)

  console.log(`${id ? 'updated' : 'created'}  ${email}  national_planner, approved, marked ${ACCOUNT_TYPE} (read-only)`)
  console.log('Now set DEMO_ACCOUNT_EMAIL and DEMO_ACCOUNT_PASSWORD on the server that runs the app.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
