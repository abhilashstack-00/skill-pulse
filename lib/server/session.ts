import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { authEnabled, demoModeAllowed, env } from '@/lib/config/env'
import { getRepository, ROLES as ROLE_LIST, type Role } from '@/lib/repository'
import { AccessError } from './access'

export interface Session {
  userId: string | null
  name: string
  email: string | null
  role: Role
  stateId: string | null
  districtId: string | null
  /** False for a sign-up no administrator has approved yet; such a session sees nothing. */
  approved: boolean
  /** True when Supabase Auth is not configured and a demo role is in use. */
  demo: boolean
}

export const ROLES: readonly Role[] = ROLE_LIST
export const DEMO_ROLE_COOKIE = 'sp_demo_role'

/** Stand-in identities used only when sign-in is not configured. */
export const DEMO_PROFILES: Record<Role, Omit<Session, 'demo' | 'userId' | 'email' | 'approved'>> = {
  admin: { name: 'Demo administrator', role: 'admin', stateId: null, districtId: null },
  national_planner: { name: 'Demo national planner', role: 'national_planner', stateId: null, districtId: null },
  state_planner: { name: 'Demo state planner', role: 'state_planner', stateId: 'TG', districtId: null },
  district_planner: { name: 'Demo district planner', role: 'district_planner', stateId: 'TG', districtId: 'warangal' },
  employer: { name: 'Demo employer', role: 'employer', stateId: null, districtId: null },
}

/** Supabase client bound to the request's cookies (server components and route handlers). */
export async function createSupabaseServerClient() {
  const store = await cookies()
  return createServerClient(env.supabaseUrl as string, env.supabaseAnonKey as string, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) store.set(name, value, options)
        } catch {
          // Called from a server component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  })
}

/** The signed-in user with role and scope, or null when not signed in. */
export async function getSession(): Promise<Session | null> {
  if (!authEnabled) {
    if (!demoModeAllowed) {
      throw new AccessError(503, 'Sign-in is not configured. Set the Supabase settings, or set DEMO_MODE=on to run the open demo on purpose.')
    }
    const store = await cookies()
    const requested = store.get(DEMO_ROLE_COOKIE)?.value as Role | undefined
    const role = requested && ROLES.includes(requested) ? requested : 'national_planner'
    return { ...DEMO_PROFILES[role], userId: null, email: null, approved: true, demo: true }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  const profile = await getRepository().getProfile(data.user.id)
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    name: profile?.fullName ?? data.user.email ?? 'Signed-in user',
    // No profile, an unknown role or no approval all mean the same thing: no access yet.
    role: profile?.role ?? 'employer',
    stateId: profile?.stateId ?? null,
    districtId: profile?.districtId ?? null,
    approved: Boolean(profile && profile.role && profile.approved),
    demo: false,
  }
}
