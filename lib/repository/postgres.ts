import { Pool, types } from 'pg'
import type { Dataset } from '@/lib/domain/types'
import { STORED_TABLES, TABLE_ORDER, tablesToDataset, type RawTables, type Row } from './map'
import type { Profile, Repository } from './index'
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
      'select id, full_name, role, state_id, district_id from public.profiles where id = $1',
      [userId],
    )
    const row = result.rows[0]
    return row
      ? { id: String(row.id), fullName: (row.full_name as string | null) ?? null, role: row.role as Profile['role'], stateId: (row.state_id as string | null) ?? null, districtId: (row.district_id as string | null) ?? null }
      : null
  }
}
