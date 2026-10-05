import { env } from '@/lib/config/env'
import { getRepository } from '@/lib/repository'
import { createSupabaseServerClient, type Session } from './session'

const REUSE_MS = 60_000
const cache = new Map<string, { at: number; ids: Set<string> }>()

/**
 * Districts the database returns rows for when asked AS the signed-in user.
 *
 * This is what puts row level security in the request path: the application
 * computes from one shared snapshot, but before it answers a signed-in user it
 * asks the database, under that user's identity, which districts the policies
 * let them read, and then never returns anything outside that set.
 *
 *   DATABASE_URL            a transaction switched to the `authenticated` role
 *                           with the user's id in the JWT claims
 *   Supabase REST only      an RPC made with the user's own access token
 *   demo mode / bundled     there is no database user to ask as: returns null
 */
export async function visibleDistrictIds(session: Session): Promise<ReadonlySet<string> | null> {
  if (session.demo || !session.userId) return null
  const cached = cache.get(session.userId)
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.ids

  const repository = getRepository()
  let ids = await repository.visibleDistrictIds(session.userId)
  if (!ids && repository.kind === 'supabase-rest' && env.supabaseUrl) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc('visible_district_ids')
    if (error) throw new Error(`Could not read the districts visible to this user: ${error.message}`)
    ids = new Set(((data ?? []) as unknown[]).map((row) => (typeof row === 'string' ? row : String((row as { visible_district_ids?: unknown }).visible_district_ids ?? ''))).filter(Boolean))
  }
  if (!ids) return null
  cache.set(session.userId, { at: Date.now(), ids })
  return ids
}

/** Forget cached answers, for example after an administrator changes a profile. */
export function clearScopeCache(): void {
  cache.clear()
}
