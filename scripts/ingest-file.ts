/**
 * Load one source file through the ingestion layer.
 *
 *   pnpm ingest --source job-portals --file path/to/file.csv [--replace] [--real] [--count-loose] [--month-first] [--dry-run]
 *
 *   --source   job-portals | employment-exchange | industry-hiring | industry-survey | training-capacity
 *   --replace  remove everything this source loaded before (default: merge into it)
 *   --real     declare that the file is not synthetic or test data. Nobody verifies this.
 *   --count-loose   count rows matched by a looser rule than an exact alias (default: hold them for review)
 *   --month-first   read 03/04/2026 as 4 March (default: 3 April)
 *   --dry-run  show the report and write nothing
 *
 * With DATABASE_URL set it writes to the database and refreshes the derived
 * tables; without it, it updates the bundled data/pilot/dataset.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Dataset } from '@/lib/domain/types'
import { applyToDataset, type RunInfo } from '@/lib/ingest/apply'
import { applyToDatabase } from '@/lib/ingest/apply-db'
import { IngestError, ingestExtract } from '@/lib/ingest/ingest'
import { SOURCE_SPECS, specFor } from '@/lib/ingest/sources'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { getPool, PostgresRepository } from '@/lib/repository/postgres'
import { explainTlsError } from '@/lib/repository/ssl'
import { writeDerived } from '@/lib/server/derived-write'

const args = process.argv.slice(2)
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const flag = (name: string) => args.includes(`--${name}`)

async function main() {
  const spec = specFor(option('source') ?? '')
  const file = option('file')
  if (!spec || !file) {
    console.error(`Usage: pnpm ingest --source <${SOURCE_SPECS.map((s) => s.id).join('|')}> --file <path> [--replace] [--real] [--count-loose] [--month-first] [--dry-run]`)
    process.exit(1)
  }
  const run: RunInfo = { fileName: basename(file), loadedAt: new Date().toISOString(), loadedBy: 'command line', mode: flag('replace') ? 'replace' : 'merge', synthetic: !flag('real') }
  const url = process.env.DATABASE_URL
  const bundled = join(process.cwd(), 'data/pilot/dataset.json')
  const before: Dataset = url ? await new PostgresRepository(url).loadDataset() : (JSON.parse(readFileSync(bundled, 'utf8')) as Dataset)
  const outcome = ingestExtract(spec, readFileSync(file, 'utf8'), before, {
    looseMatches: flag('count-loose') ? 'count' : 'hold',
    today: run.loadedAt.slice(0, 7),
    dateOrder: flag('month-first') ? 'mdy' : undefined,
  })
  console.log(JSON.stringify(outcome.report, null, 2))
  if (flag('dry-run')) {
    console.log('\nDry run: nothing was written.')
    return
  }
  if (url) {
    const record = await applyToDatabase(getPool(url), spec, outcome, run)
    const snapshot = buildSnapshot(await new PostgresRepository(url).loadDataset())
    const client = await getPool(url).connect()
    let counts
    try {
      await client.query('begin')
      counts = await writeDerived(client, snapshot)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
    console.log(`\nRun ${record.id} written to the database (${run.mode}). Derived tables refreshed: ${JSON.stringify(counts)}`)
    await getPool(url).end()
  } else {
    writeFileSync(bundled, JSON.stringify(applyToDataset(before, spec, outcome, run)))
    console.log(`\nRun written to data/pilot/dataset.json (${run.mode}). Restart the app to see it.`)
  }
}

main().catch((error) => {
  console.error(error instanceof IngestError ? error.message : explainTlsError(error) ?? error)
  process.exit(1)
})
