import { createClient } from '@supabase/supabase-js'
import type { Dataset } from '@/lib/domain/types'
import { env } from '@/lib/config/env'
import { LocalRepository } from './local'
import { PostgresRepository } from './postgres'
import { SupabaseRestRepository } from './supabase-rest'

export type Role = 'admin' | 'national_planner' | 'state_planner' | 'district_planner' | 'employer'

export interface Profile {
  id: string
  fullName: string | null
  role: Role
  stateId: string | null
  districtId: string | null
}

/** The data layer's whole surface: stored rows in, nothing computed. */
export interface Repository {
  readonly kind: 'postgres' | 'supabase-rest' | 'local'
  loadDataset(): Promise<Dataset>
  getProfile(userId: string): Promise<Profile | null>
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
