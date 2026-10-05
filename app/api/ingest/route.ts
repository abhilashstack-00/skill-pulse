import { demoWritesAllowed, env } from '@/lib/config/env'
import { valuesReplaced, type RunInfo } from '@/lib/ingest/apply'
import { applyToDatabase } from '@/lib/ingest/apply-db'
import { IngestError, ingestExtract } from '@/lib/ingest/ingest'
import { SOURCE_SPECS, specFor } from '@/lib/ingest/sources'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { getRepository } from '@/lib/repository'
import { getPool } from '@/lib/repository/postgres'
import { AccessError, can } from '@/lib/server/access'
import { writeDerived } from '@/lib/server/derived-write'
import { ValidationError } from '@/lib/server/filters'
import { api } from '@/lib/server/http'
import { resetSnapshot } from '@/lib/server/snapshot'
import { runView } from '@/lib/server/views'

const MAX_BYTES = 5 * 1024 * 1024
const TOO_LARGE = 'The file is larger than 5 MB. Split it by month and load the parts one after another: a later file replaces the values of any district, trade and month it repeats.'

/** GET /api/ingest — the load history (detail depends on the role) and what each source's file must contain. */
export const GET = api(({ snapshot, session }) => ({
  canLoad: can(session, 'ingest'),
  /** Loading through the app writes to the database; the bundled file is updated with `pnpm ingest`. */
  writable: Boolean(env.databaseUrl) && (!session.demo || demoWritesAllowed),
  specs: SOURCE_SPECS.map((s) => ({ id: s.id, kind: s.kind, columns: Object.values(s.columns) })),
  runs: [...snapshot.dataset.ingestionRuns].sort((a, b) => b.id - a.id).map((run) => runView(run, session)),
}))

/**
 * POST /api/ingest — check or load one source file (multipart form).
 *   source       id of the source the file comes from
 *   file         the CSV file
 *   mode         merge (default) | replace
 *   synthetic    "false" to declare the file is not synthetic or test data
 *   countLoose   "true" to count rows matched by a looser rule (default: hold them for review)
 *   monthFirst   "true" to read 03/04/2026 as 4 March
 *   dryRun       "true" to get the report without writing anything
 * Administrators only.
 */
export const POST = api(
  async ({ request, snapshot, session }) => {
    if (!request.headers.get('content-type')?.includes('multipart/form-data')) throw new ValidationError('Send the file as multipart form data.')
    // Refuse an oversized body before reading it.
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES + 64 * 1024) throw new ValidationError(TOO_LARGE)
    const form = await request.formData()
    const spec = specFor(String(form.get('source') ?? ''))
    if (!spec) throw new ValidationError(`source must be one of ${SOURCE_SPECS.map((s) => s.id).join(', ')}`)
    const file = form.get('file')
    if (!(file instanceof File)) throw new ValidationError('Attach the CSV file as "file".')
    if (file.size === 0) throw new ValidationError('The file is empty.')
    if (file.size > MAX_BYTES) throw new ValidationError(TOO_LARGE)
    const mode = form.get('mode') === 'replace' ? 'replace' : 'merge'
    const dryRun = form.get('dryRun') === 'true'
    const loadedAt = new Date().toISOString()

    let outcome
    try {
      outcome = ingestExtract(spec, await file.text(), snapshot.dataset, {
        looseMatches: form.get('countLoose') === 'true' ? 'count' : 'hold',
        today: loadedAt.slice(0, 7),
        dateOrder: form.get('monthFirst') === 'true' ? 'mdy' : undefined,
      })
    } catch (error) {
      if (error instanceof IngestError) throw new ValidationError(error.message)
      throw error
    }
    // What the load would overwrite, so nobody finds out afterwards.
    const replaces = valuesReplaced(snapshot.dataset, spec, outcome, mode)
    if (dryRun) return { written: false, report: outcome.report, run: null, replaces }

    if (!env.databaseUrl) {
      throw new AccessError(403, 'The application is running on the bundled dataset, which it cannot change. Connect a database (DATABASE_URL), or load the file with `pnpm ingest`.')
    }
    if (session.demo && !demoWritesAllowed) {
      throw new AccessError(403, 'Demo mode has no real users, so it cannot change stored data. Sign-in must be configured, or DEMO_WRITES=on set for a throw-away database.')
    }
    if (outcome.report.rowsMapped === 0) throw new ValidationError('No row in the file could be mapped, so nothing was loaded. Check the report with a dry run.')
    const run: RunInfo = {
      fileName: file.name.replace(/[^\w. ()-]+/g, '_').slice(0, 120) || 'upload.csv',
      loadedAt,
      loadedBy: session.email ?? (session.demo ? `demo ${session.role}` : session.name),
      mode,
      synthetic: form.get('synthetic') !== 'false',
    }
    const pool = getPool(env.databaseUrl)
    const record = await applyToDatabase(pool, spec, outcome, run)
    // The rows are stored. Whatever happens next, every request must now see them.
    resetSnapshot()
    const fresh = buildSnapshot(await getRepository().loadDataset())
    // Refresh the copy kept for SQL clients. If that fails the load still stands; say so rather than report an error.
    let derivedRefreshed = true
    const client = await pool.connect()
    try {
      await client.query('begin')
      await writeDerived(client, fresh)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      derivedRefreshed = false
      console.error('[ingest] derived tables were not refreshed:', error instanceof Error ? error.message : 'unknown error')
    } finally {
      client.release()
    }
    return { written: true, report: outcome.report, run: record, asOfPeriod: fresh.meta.asOfPeriod, derivedRefreshed, replaces }
  },
  { permission: 'ingest' },
)
