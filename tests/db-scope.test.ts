import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/lib/server/session'

/**
 * lib/server/db-scope.ts asks the database, as the signed-in user, which
 * districts row level security lets them read. The database side is tested in
 * tests/db.integration.test.ts; this file tests the code around it with a fake
 * repository and a fake Supabase client. It has never run against Supabase.
 */
const state = vi.hoisted(() => ({
  kind: 'postgres' as 'postgres' | 'supabase-rest' | 'local',
  fromDatabase: null as Set<string> | null,
  databaseCalls: [] as string[],
  rpc: { data: null as unknown, error: null as { message: string } | null },
  rpcCalls: [] as string[],
  supabaseUrl: 'https://example.supabase.co' as string | undefined,
}))

vi.mock('@/lib/config/env', () => ({ env: { get supabaseUrl() { return state.supabaseUrl } } }))
vi.mock('@/lib/repository', () => ({
  getRepository: () => ({
    get kind() { return state.kind },
    visibleDistrictIds: async (userId: string) => { state.databaseCalls.push(userId); return state.fromDatabase },
  }),
}))
vi.mock('@/lib/server/session', () => ({
  createSupabaseServerClient: async () => ({ rpc: async (name: string) => { state.rpcCalls.push(name); return state.rpc } }),
}))

import { clearScopeCache, visibleDistrictIds } from '@/lib/server/db-scope'

const session = (over: Partial<Session> = {}): Session => ({ userId: 'user-1', name: 'n', email: null, role: 'state_planner', stateId: 'TG', districtId: null, approved: true, demo: false, ...over })

beforeEach(() => {
  clearScopeCache()
  Object.assign(state, { kind: 'postgres', fromDatabase: null, databaseCalls: [], rpc: { data: null, error: null }, rpcCalls: [], supabaseUrl: 'https://example.supabase.co' })
})

describe('scope reported by the database', () => {
  it('has nobody to ask as in demo mode', async () => {
    expect(await visibleDistrictIds(session({ demo: true, userId: null }))).toBeNull()
    expect(state.databaseCalls).toEqual([])
  })

  it('asks the database as the user, and remembers the answer for that user only', async () => {
    state.fromDatabase = new Set(['hyderabad', 'warangal'])
    expect([...(await visibleDistrictIds(session()))!]).toEqual(['hyderabad', 'warangal'])
    await visibleDistrictIds(session())
    expect(state.databaseCalls).toEqual(['user-1']) // second call answered from memory
    state.fromDatabase = new Set(['pune'])
    expect([...(await visibleDistrictIds(session({ userId: 'user-2' })))!]).toEqual(['pune'])
    expect([...(await visibleDistrictIds(session()))!]).toEqual(['hyderabad', 'warangal']) // user 1 does not get user 2's answer
    clearScopeCache()
    expect([...(await visibleDistrictIds(session()))!]).toEqual(['pune'])
  })

  it('keeps an empty answer empty: no visible districts is not the same as no restriction', async () => {
    state.fromDatabase = new Set()
    const ids = await visibleDistrictIds(session())
    expect(ids).not.toBeNull()
    expect(ids!.size).toBe(0)
  })

  it('without a direct connection, calls the function through the API with the user\'s own token', async () => {
    state.kind = 'supabase-rest'
    state.rpc = { data: ['warangal', { visible_district_ids: 'hyderabad' }, { visible_district_ids: null }], error: null }
    expect([...(await visibleDistrictIds(session()))!].sort()).toEqual(['hyderabad', 'warangal'])
    expect(state.rpcCalls).toEqual(['visible_district_ids'])
  })

  it('fails the request rather than fall back to the unrestricted view when the database cannot answer', async () => {
    state.kind = 'supabase-rest'
    state.rpc = { data: null, error: { message: 'permission denied' } }
    await expect(visibleDistrictIds(session())).rejects.toThrow(/Could not read the districts/)
    // And a failure is not remembered as an answer.
    state.rpc = { data: ['pune'], error: null }
    expect([...(await visibleDistrictIds(session()))!]).toEqual(['pune'])
  })
})
