import type { SupabaseClient } from '@supabase/supabase-js'
import type { Dataset } from '@/lib/domain/types'
import { STORED_TABLES, TABLE_ORDER, tablesToDataset, type RawTables, type Row } from './map'
import { asRole, type Profile, type Repository } from './index'

const PAGE = 1000

/**
 * Reads the stored tables through Supabase's REST API with the service-role
 * key (server only). Used when no direct connection string is configured.
 */
export class SupabaseRestRepository implements Repository {
  readonly kind = 'supabase-rest' as const
  constructor(private readonly client: SupabaseClient) {}

  private async all(table: string, orderBy: string): Promise<Row[]> {
    const rows: Row[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client.from(table).select('*').order(orderBy, { ascending: true }).range(from, from + PAGE - 1)
      if (error) throw new Error(`Supabase read of ${table} failed: ${error.message}`)
      rows.push(...((data ?? []) as Row[]))
      if (!data || data.length < PAGE) return rows
    }
  }

  async loadDataset(): Promise<Dataset> {
    const tables = {} as RawTables
    await Promise.all(STORED_TABLES.map(async (table) => { tables[table] = await this.all(table, TABLE_ORDER[table]) }))
    return tablesToDataset(tables)
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.client.from('profiles').select('id, full_name, role, approved, state_id, district_id').eq('id', userId).maybeSingle()
    if (error) throw new Error(`Supabase read of profiles failed: ${error.message}`)
    return data
      ? { id: data.id, fullName: data.full_name ?? null, role: asRole(data.role), approved: data.approved === true, stateId: data.state_id ?? null, districtId: data.district_id ?? null }
      : null
  }

  /** This client uses the service-role key, which bypasses row level security; the per-user question is asked in lib/server/db-scope.ts. */
  async visibleDistrictIds(): Promise<null> {
    return null
  }
}
