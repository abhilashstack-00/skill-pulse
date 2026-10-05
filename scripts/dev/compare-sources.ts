// Verifies that the database path and the bundled-file path give identical snapshots.
import { createHash } from 'node:crypto'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { LocalRepository } from '@/lib/repository/local'
import { PostgresRepository } from '@/lib/repository/postgres'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
async function main() {
  const local = await new LocalRepository().loadDataset()
  const pg = await new PostgresRepository(process.env.DATABASE_URL as string).loadDataset()
  const order = <T,>(rows: T[]) => [...rows].map((r) => JSON.stringify(Object.entries(r as object).sort())).sort()
  for (const key of ['states', 'districts', 'sectors', 'trades', 'trainingCentres', 'trainingCapacity', 'labourDemand', 'dataSources'] as const) {
    const same = digest(order(local[key] as unknown[])) === digest(order(pg[key] as unknown[]))
    console.log(`${key.padEnd(18)} local ${String((local[key] as unknown[]).length).padStart(5)}  postgres ${String((pg[key] as unknown[]).length).padStart(5)}  ${same ? 'identical' : 'DIFFERENT'}`)
  }
  console.log('meta', JSON.stringify(local.meta) === JSON.stringify(pg.meta) ? 'identical' : `DIFFERENT ${JSON.stringify(pg.meta)}`)
  const a = buildSnapshot(local), b = buildSnapshot(pg)
  const strip = (s: typeof a) => s.cells.map((c) => ({ k: c.key, h: c.horizons, p: c.priority, w: c.warnings, r: c.recommendation })).sort((x, y) => x.k.localeCompare(y.k))
  console.log('snapshot results', digest(strip(a)) === digest(strip(b)) ? 'identical' : 'DIFFERENT')
  process.exit(0)
}
main()
