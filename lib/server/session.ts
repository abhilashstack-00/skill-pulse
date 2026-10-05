import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { authEnabled, env } from '@/lib/config/env'
import { getRepository, type Role } from '@/lib/repository'

export interface Session {
  userId: string | null
  name: string
  email: string | null
  role: Role
  stateId: string | null
  districtId: string | null
  /** True when Supabase Auth is not configured and a demo role is in use. */
  demo: boolean
}

export const ROLES: Role[] = ['admin', 'national_planner', 'state_planner', 'district_planner', 'employer']
export const DEMO_ROLE_COOKIE = 'sp_demo_role'

/** Stand-in identities used only when sign-in is not configured. */
export const DEMO_PROFILES: Record<Role, Omit<Session, 'demo' | 'userId' | 'email'>> = {
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
    const store = await cookies()
    const requested = store.get(DEMO_ROLE_COOKIE)?.value as Role | undefined
    const role = requested && ROLES.includes(requested) ? requested : 'national_planner'
    return { ...DEMO_PROFILES[role], userId: null, email: null, demo: true }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  const profile = await getRepository().getProfile(data.user.id)
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    name: profile?.fullName ?? data.user.email ?? 'Signed-in user',
    // No profile row means no granted role: fall back to the least privileged one.
    role: profile?.role ?? 'employer',
    stateId: profile?.stateId ?? null,
    districtId: profile?.districtId ?? null,
    demo: false,
  }
}
