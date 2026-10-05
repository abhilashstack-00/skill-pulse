import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Continue with Demo Account". The Supabase client and the profile lookup are
 * replaced; the route, the permission table and the sign-out route are real.
 * What is checked: the route only ever performs a real password sign-in as the
 * configured account, refuses anything that is not the restricted evaluator
 * account, and tells the visitor nothing about why it failed.
 */

const state = vi.hoisted(() => ({
  available: true,
  env: { demoAccountEmail: 'evaluator@skillpulse.test' as string | undefined, demoAccountPassword: 'server-only-secret' as string | undefined, rateLimitPerMinute: 100000 },
  signIn: { user: null as unknown, error: null as unknown, throws: false },
  current: null as unknown,
  profile: null as unknown,
  signInCalls: [] as unknown[],
  signOutCalls: [] as unknown[],
}))

vi.mock('@/lib/config/env', () => ({
  env: state.env,
  authEnabled: true,
  demoModeAllowed: false,
  get demoAccountAvailable() { return state.available },
}))
vi.mock('@/lib/repository', () => ({
  getRepository: () => ({ getProfile: async () => state.profile }),
  ROLES: ['admin', 'national_planner', 'state_planner', 'district_planner', 'employer'],
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      signInWithPassword: async (credentials: unknown) => {
        state.signInCalls.push(credentials)
        if (state.signIn.throws) throw new Error('connect ECONNREFUSED db.internal:5432 password=hunter2')
        return { data: { user: state.signIn.user }, error: state.signIn.error }
      },
      getUser: async () => ({ data: { user: state.current }, error: null }),
      signOut: async (options?: unknown) => { state.signOutCalls.push(options ?? 'default'); return { error: null } },
    },
  }),
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined, get: () => undefined }) }))

import { POST as demoSignIn } from '@/app/api/auth/demo/route'
import { POST as signOut } from '@/app/api/auth/signout/route'
import { can } from '@/lib/server/access'
import type { Session } from '@/lib/server/session'

const EVALUATOR = { id: 'e0000000-0000-0000-0000-000000000001', email: 'evaluator@skillpulse.test', app_metadata: { account_type: 'evaluator_demo' } }
const PLANNER_PROFILE = { id: EVALUATOR.id, fullName: 'Evaluator', role: 'national_planner', approved: true, stateId: null, districtId: null }

let address = 0
const post = (headers: Record<string, string> = {}) =>
  demoSignIn(new NextRequest('http://localhost/api/auth/demo', { method: 'POST', headers: { host: 'localhost', 'x-forwarded-for': `10.0.0.${++address}`, ...headers } }))

beforeEach(() => {
  state.available = true
  state.signIn = { user: EVALUATOR, error: null, throws: false }
  state.current = null
  state.profile = PLANNER_PROFILE
  state.signInCalls.length = 0
  state.signOutCalls.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('demo sign-in route', () => {
  it('signs in as the configured account with a real password sign-in', async () => {
    const response = await post()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(state.signInCalls).toEqual([{ email: 'evaluator@skillpulse.test', password: 'server-only-secret' }])
    expect(state.signOutCalls).toEqual([])
  })

  it('never sends the account or its password back', async () => {
    const response = await post()
    const text = JSON.stringify([await response.json(), [...response.headers.entries()]])
    expect(text).not.toContain('server-only-secret')
    expect(text).not.toContain('evaluator@skillpulse.test')
  })

  it('does not exist when the evaluator account is not configured', async () => {
    state.available = false
    const response = await post()
    expect(response.status).toBe(404)
    expect(state.signInCalls).toEqual([])
  })

  it('refuses a request from another site', async () => {
    const response = await post({ origin: 'https://elsewhere.example' })
    expect(response.status).toBe(403)
    expect(state.signInCalls).toEqual([])
  })

  it('answers with one plain message when Supabase refuses, with no detail', async () => {
    state.signIn = { user: null, error: { name: 'AuthApiError', status: 400, message: 'Invalid login credentials for evaluator@skillpulse.test' }, throws: false }
    const response = await post()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Demo access is temporarily unavailable.' })
  })

  it('answers with the same message when the sign-in throws', async () => {
    state.signIn.throws = true
    const response = await post()
    expect(response.status).toBe(503)
    const text = JSON.stringify(await response.json())
    expect(text).toBe('{"error":"Demo access is temporarily unavailable."}')
    expect(text).not.toContain('hunter2')
  })

  it.each([
    ['an administrator', EVALUATOR, { ...PLANNER_PROFILE, role: 'admin' }],
    ['an unapproved account', EVALUATOR, { ...PLANNER_PROFILE, approved: false }],
    ['an account with no profile', EVALUATOR, null],
    ['an account not marked as the evaluator account', { ...EVALUATOR, app_metadata: {} }, PLANNER_PROFILE],
  ])('signs out again and fails when the settings point at %s', async (_name, user, profile) => {
    state.signIn.user = user
    state.profile = profile
    const response = await post()
    expect(response.status).toBe(503)
    expect(state.signOutCalls).toEqual([{ scope: 'local' }])
  })

  it('stops repeated sign-ins from one address', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i += 1) statuses.push((await demoSignIn(new NextRequest('http://localhost/api/auth/demo', { method: 'POST', headers: { host: 'localhost', 'x-forwarded-for': '10.9.9.9' } }))).status)
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses.slice(10)).toEqual([429, 429])
  })
})

describe('sign-out', () => {
  it('ends only this browser\'s session for the shared evaluator account', async () => {
    state.current = EVALUATOR
    await signOut()
    expect(state.signOutCalls).toEqual([{ scope: 'local' }])
  })

  it('is unchanged for every other account', async () => {
    state.current = { id: 'u', email: 'planner@example.test', app_metadata: {} }
    await signOut()
    expect(state.signOutCalls).toEqual(['default'])
  })
})

describe('evaluator permissions', () => {
  const session = (over: Partial<Session>): Session => ({ userId: 'u', name: 'n', email: null, role: 'national_planner', stateId: null, districtId: null, approved: true, demo: false, evaluator: true, ...over })

  it('reads market intelligence and recommendations as a national planner', () => {
    expect(can(session({}), 'view')).toBe(true)
    expect(can(session({}), 'recommendations')).toBe(true)
  })

  it('can never load data, even if its profile were changed to administrator', () => {
    expect(can(session({}), 'ingest')).toBe(false)
    expect(can(session({ role: 'admin' }), 'ingest')).toBe(false)
    expect(can(session({ role: 'admin', evaluator: false }), 'ingest')).toBe(true)
  })
})

describe('nothing secret is written into browser code', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })

  it('no client component or client module reads the evaluator account settings', () => {
    const offenders = [...files('components'), ...files('lib/client'), ...files('lib/i18n'), ...files('lib/hooks')]
      .filter((path) => /DEMO_ACCOUNT|demoAccountEmail|demoAccountPassword|SERVICE_ROLE|SUPABASE_SECRET/.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the settings are not public variables', () => {
    const source = readFileSync('lib/config/env.ts', 'utf8')
    expect(source).toContain("value('DEMO_ACCOUNT_PASSWORD')")
    expect(source).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(DEMO|PASSWORD|SECRET|SERVICE)/)
  })
})
