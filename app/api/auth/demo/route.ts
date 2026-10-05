import { NextResponse, type NextRequest } from 'next/server'
import { demoAccountAvailable, env } from '@/lib/config/env'
import { getRepository } from '@/lib/repository'
import { addressKey, crossSite, overLimit } from '@/lib/server/http'
import { createSupabaseServerClient, isEvaluatorAccount } from '@/lib/server/session'

/**
 * "Continue with Demo Account": signs the browser in as the evaluator account.
 *
 * This is an ordinary Supabase Auth password sign-in, made here on the server
 * so the account's password never reaches the browser. Supabase issues a normal
 * session, the same cookies as the sign-in form are set, and from then on every
 * request is checked exactly like any other signed-in user's: proxy.ts, the API
 * wrapper, the profile's role and the database's row level security.
 *
 * Nothing here grants access by itself. If the account is missing, unapproved,
 * or not the restricted account it is meant to be, the sign-in is undone.
 */

/** Sign-ins allowed per address per minute. One click is one sign-in; this only blunts a script. */
const DEMO_SIGN_INS_PER_MINUTE = 10

const noStore = { 'Cache-Control': 'private, no-store' }
/** One answer for every failure: the reason is logged on the server, never sent to the visitor. */
const unavailable = (status: number) => NextResponse.json({ error: 'Demo access is temporarily unavailable.' }, { status, headers: noStore })

export async function POST(request: NextRequest) {
  if (!demoAccountAvailable) return unavailable(404)
  if (crossSite(request)) return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403, headers: noStore })
  if (overLimit(`demo:${addressKey(request)}`, DEMO_SIGN_INS_PER_MINUTE)) return unavailable(429)

  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: env.demoAccountEmail as string,
      password: env.demoAccountPassword as string,
    })
    if (error || !data.user) {
      console.error('[demo sign-in] Supabase refused the evaluator account:', error?.name ?? 'no user', error?.status ?? '')
      return unavailable(503)
    }

    // The settings must point at the restricted evaluator account and nothing else.
    // A mistake here (say, an administrator's address) must not hand out that account.
    const profile = await getRepository().getProfile(data.user.id)
    const restricted = isEvaluatorAccount(data.user) && profile?.approved === true && profile.role === 'national_planner'
    if (!restricted) {
      await supabase.auth.signOut({ scope: 'local' })
      console.error('[demo sign-in] The configured account is not an approved national planner marked as the evaluator account. Signed out again.')
      return unavailable(503)
    }
    return NextResponse.json({ ok: true }, { headers: noStore })
  } catch (error) {
    // The message is logged, not the object: it could carry request details.
    console.error('[demo sign-in]', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error')
    return unavailable(503)
  }
}
