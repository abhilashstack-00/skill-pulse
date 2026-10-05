import type { Snapshot } from '@/lib/domain/types'
import { derivedRows } from './derived'

/** Minimal shape of a pg client, so this file does not depend on a connection. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>
}

const TABLES = ['demand_forecasts', 'supply_forecasts', 'gap_analysis'] as const

/**
 * Rewrites the three derived tables from a snapshot. These tables are a copy of
 * the engine's results for SQL and BI clients; the application computes from
 * the fact tables and does not read them. They are refreshed by `pnpm pipeline`
 * and automatically after every data load, and dataset_meta.derived_at records when.
 */
export async function writeDerived(client: Queryable, snapshot: Snapshot): Promise<Record<(typeof TABLES)[number], number>> {
  const derived = derivedRows(snapshot)
  await client.query('truncate public.gap_analysis, public.supply_forecasts, public.demand_forecasts restart identity')
  const counts = {} as Record<(typeof TABLES)[number], number>
  for (const table of TABLES) {
    const { columns, rows } = derived[table]
    counts[table] = rows.length
    for (let i = 0; i < rows.length; i += 300) {
      const batch = rows.slice(i, i + 300)
      const placeholders = batch.map((row, r) => `(${row.map((_, c) => `$${r * columns.length + c + 1}`).join(', ')})`).join(', ')
      await client.query(`insert into public.${table} (${columns.join(', ')}) values ${placeholders}`, batch.flat())
    }
  }
  await client.query('update public.dataset_meta set derived_at = now()')
  return counts
}
