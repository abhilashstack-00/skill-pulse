/**
 * Creates one Supabase Auth user per role and sets each user's role and scope
 * in public.profiles. Run once after `pnpm db:setup` on a Supabase project.
 *
 *   DEMO_USER_PASSWORD='choose-a-password' pnpm demo:users
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local).
 * Safe to run again: existing users are kept and only their profile is updated.
 * The users it creates are approved; anyone who signs up on their own is not,
 * and sees nothing until an administrator sets profiles.approved.
 *
 * Not exercised against a live Supabase project during development (the build
 * sandbox could not reach Supabase). It uses only the documented admin API.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.DEMO_USER_PASSWORD
const domain = process.env.DEMO_USER_DOMAIN ?? 'skillpulse.example'

if (!url || !serviceKey) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).')
  process.exit(1)
}
if (!password || password.length < 10) {
  console.error('Set DEMO_USER_PASSWORD to a password of at least 10 characters. No default is provided on purpose.')
  process.exit(1)
}

const USERS = [
  { email: `admin@${domain}`, full_name: 'Demo administrator', role: 'admin', state_id: null, district_id: null },
  { email: `national@${domain}`, full_name: 'Demo national planner', role: 'national_planner', state_id: null, district_id: null },
  { email: `telangana@${domain}`, full_name: 'Demo state planner (Telangana)', role: 'state_planner', state_id: 'TG', district_id: null },
  { email: `warangal@${domain}`, full_name: 'Demo district planner (Warangal)', role: 'district_planner', state_id: 'TG', district_id: 'warangal' },
  { email: `employer@${domain}`, full_name: 'Demo employer', role: 'employer', state_id: null, district_id: null },
] as const

async function main() {
  const supabase = createClient(url as string, serviceKey as string, { auth: { persistSession: false, autoRefreshToken: false } })
  const authHeaders = {
    apikey: serviceKey as string,
    Authorization: `Bearer ${serviceKey as string}`,
    'Content-Type': 'application/json',
  }
  const authUrl = `${(url as string).replace(/\/+$/, '')}/auth/v1/admin/users`

  const existing = new Map<string, string>()
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${authUrl}?page=${page}&per_page=200`, { headers: authHeaders })
    const body = await response.json() as { users?: { email?: string; id: string }[]; msg?: string; message?: string }
    if (!response.ok) throw new Error(`Could not list users: ${body.msg ?? body.message ?? response.statusText}`)
    for (const user of body.users ?? []) if (user.email) existing.set(user.email.toLowerCase(), user.id)
    if ((body.users ?? []).length < 200) break
  }

  for (const user of USERS) {
    let id = existing.get(user.email)
    if (!id) {
      const response = await fetch(authUrl, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          email: user.email,
          password: password as string,
          email_confirm: true,
          user_metadata: { full_name: user.full_name },
        }),
      })
      const body = await response.json() as { id?: string; msg?: string; message?: string }
      if (!response.ok || !body.id) throw new Error(`Could not create ${user.email}: ${body.msg ?? body.message ?? response.statusText}`)
      id = body.id
    }
    const { error } = await supabase
      .from('profiles')
      .upsert({ id, full_name: user.full_name, role: user.role, state_id: user.state_id, district_id: user.district_id, approved: true }, { onConflict: 'id' })
    if (error) throw new Error(`Could not set the profile for ${user.email}: ${error.message}`)
    console.log(`${existing.has(user.email) ? 'kept   ' : 'created'}  ${user.email.padEnd(34)} ${user.role}`)
  }
  console.log('\nSign in at /login with any of these addresses and the password you supplied.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
