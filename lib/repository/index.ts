import { createClient } from '@supabase/supabase-js'
import type { Dataset } from '@/lib/domain/types'
import { env } from '@/lib/config/env'
import { LocalRepository } from './local'
import { PostgresRepository } from './postgres'
import { SupabaseRestRepository } from './supabase-rest'

export const ROLES = ['admin', 'national_planner', 'state_planner', 'district_planner', 'employer'] as const
export type Role = (typeof ROLES)[number]

export interface Profile {
  id: string
  fullName: string | null
  /** Null when the stored role is not one the application knows. */
  role: Role | null
  /** New sign-ups are not approved until an administrator says so. */
  approved: boolean
  stateId: string | null
  districtId: string | null
}

export const asRole = (value: unknown): Role | null => ROLES.find((r) => r === value) ?? null

/** The data layer's whole surface: stored rows in, nothing computed. */
export interface Repository {
  readonly kind: 'postgres' | 'supabase-rest' | 'local'
  loadDataset(): Promise<Dataset>
  getProfile(userId: string): Promise<Profile | null>
  /**
   * District ids the database returns rows for when it is queried AS this user,
   * so row level security decides. Null when the repository has no per-user
   * database identity to ask with.
   */
  visibleDistrictIds(userId: string): Promise<Set<string> | null>
}

let cached: Repository | undefined

/**
 * Picks the data source from the environment:
 *   DATABASE_URL                      → PostgreSQL (Supabase connection string)
 *   Supabase URL + service-role key   → Supabase REST
 *   neither                           → bundled pilot dataset
 */
export function getRepository(): Repository {
  if (cached) return cached
  if (env.databaseUrl) cached = new PostgresRepository(env.databaseUrl)
  else if (env.supabaseUrl && env.supabaseServiceRoleKey) {
    cached = new SupabaseRestRepository(createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }))
  } else cached = new LocalRepository()
  return cached
}
