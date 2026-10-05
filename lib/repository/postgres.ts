import { Pool, types } from 'pg'
import type { Dataset } from '@/lib/domain/types'
import { STORED_TABLES, TABLE_ORDER, tablesToDataset, type RawTables, type Row } from './map'
import { asRole, type Profile, type Repository } from './index'
import { pgSsl } from './ssl'

// Keep dates as 'YYYY-MM-DD' text (no time-zone shifts) and numerics as numbers.
types.setTypeParser(types.builtins.DATE, (value) => value)
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value))
types.setTypeParser(types.builtins.INT8, (value) => Number(value))

declare global {
  // Reused across hot reloads and requests so connections are not leaked.
  var __skillpulsePool: Pool | undefined
}

export function getPool(connectionString: string): Pool {
  if (!globalThis.__skillpulsePool) {
    globalThis.__skillpulsePool = new Pool({ connectionString, max: 4, ssl: pgSsl(connectionString) })
  }
  return globalThis.__skillpulsePool
}

/** Reads the stored tables straight from PostgreSQL (Supabase connection string). */
export class PostgresRepository implements Repository {
  readonly kind = 'postgres' as const
  constructor(private readonly connectionString: string) {}

  async loadDataset(): Promise<Dataset> {
    const pool = getPool(this.connectionString)
    const tables = {} as RawTables
    await Promise.all(
      STORED_TABLES.map(async (table) => {
        const result = await pool.query<Row>(`select * from public.${table} order by ${TABLE_ORDER[table]}`)
        tables[table] = result.rows
      }),
    )
    return tablesToDataset(tables)
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const result = await getPool(this.connectionString).query<Row>(
      'select id, full_name, role, approved, state_id, district_id from public.profiles where id = $1',
      [userId],
    )
    const row = result.rows[0]
    return row
      ? {
          id: String(row.id), fullName: (row.full_name as string | null) ?? null, role: asRole(row.role), approved: row.approved === true,
          stateId: (row.state_id as string | null) ?? null, districtId: (row.district_id as string | null) ?? null,
        }
      : null
  }

  /**
   * Asks the database which districts this user can read, inside a transaction
   * that drops to the `authenticated` role and carries the user's id the way a
   * Supabase request does. The row level security policies answer, not this code.
   */
  async visibleDistrictIds(userId: string): Promise<Set<string>> {
    const client = await getPool(this.connectionString).connect()
    try {
      await client.query('begin')
      await client.query('set local role authenticated')
      await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [
        userId,
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ])
      const result = await client.query<{ id: string }>('select id from public.visible_district_ids() as id')
      await client.query('commit')
      return new Set(result.rows.map((r) => r.id))
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}
