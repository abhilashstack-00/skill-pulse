import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Dataset } from '@/lib/domain/types'
import { applyToDataset } from '@/lib/ingest/apply'
import { applyToDatabase } from '@/lib/ingest/apply-db'
import { ingestExtract } from '@/lib/ingest/ingest'
import { specFor } from '@/lib/ingest/sources'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { getPool, PostgresRepository } from '@/lib/repository/postgres'
import { writeDerived } from '@/lib/server/derived-write'

/**
 * Tests against a real PostgreSQL database. They run only when
 * TEST_DATABASE_URL is set, and that database must be DISPOSABLE: it is
 * re-seeded when the tests finish.
 *
 *   createdb skillpulse_test
 *   DATABASE_URL=postgres://localhost/skillpulse_test pnpm db:setup --local-shim
 *   TEST_DATABASE_URL=postgres://localhost/skillpulse_test pnpm test
 */
const url = process.env.TEST_DATABASE_URL
const bundled = JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset

const USERS = {
  admin: '10000000-0000-0000-0000-000000000001',
  national: '10000000-0000-0000-0000-000000000002',
  telangana: '10000000-0000-0000-0000-000000000003',
  warangal: '10000000-0000-0000-0000-000000000004',
  employer: '10000000-0000-0000-0000-000000000005',
  pending: '10000000-0000-0000-0000-000000000006',
} as const

describe.skipIf(!url)('PostgreSQL', () => {
  const repository = new PostgresRepository(url as string)
  const pool = () => getPool(url as string)
  const reseed = () => pool().query(readFileSync('supabase/seed.sql', 'utf8'))

  beforeAll(async () => {
    await reseed()
    const ids = Object.values(USERS)
    await pool().query('delete from auth.users where id = any($1::uuid[])', [ids])
    await pool().query('insert into auth.users (id, email) select unnest($1::uuid[]), unnest($2::text[])', [ids, ids.map((_, i) => `user${i}@example.test`)])
    await pool().query("update public.profiles set role = 'admin', approved = true where id = $1", [USERS.admin])
    await pool().query("update public.profiles set role = 'national_planner', approved = true where id = $1", [USERS.national])
    await pool().query("update public.profiles set role = 'state_planner', state_id = 'TG', approved = true where id = $1", [USERS.telangana])
    await pool().query("update public.profiles set role = 'district_planner', state_id = 'TG', district_id = 'warangal', approved = true where id = $1", [USERS.warangal])
    await pool().query('update public.profiles set approved = true where id = $1', [USERS.employer])
  })

  afterAll(async () => {
    await pool().query('delete from auth.users where id = any($1::uuid[])', [Object.values(USERS)])
    await reseed()
    await pool().end()
  })

  it('reads back exactly the dataset the seed was built from', async () => {
    const stored = await repository.loadDataset()
    // Key order is not meaningful (jsonb does not keep it), so compare with keys sorted at every level.
    const canonical = (value: unknown): unknown =>
      Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
      : value
    const sorted = <T,>(rows: T[]) => rows.map((r) => JSON.stringify(canonical(r))).sort()
    for (const key of ['states', 'districts', 'sectors', 'trades', 'trainingCentres', 'trainingCapacity', 'labourDemand', 'dataSources', 'ingestionRuns'] as const) {
      expect(sorted(stored[key] as unknown[]), key).toEqual(sorted(bundled[key] as unknown[]))
    }
    expect(stored.meta).toEqual(bundled.meta)
  })

  it('computes the same results from the database as from the bundled file', async () => {
    const strip = (d: Dataset) => buildSnapshot(d).cells.map((c) => ({ k: c.key, h: c.horizons, p: c.priority, w: c.warnings, r: c.recommendation })).sort((a, b) => a.k.localeCompare(b.k))
    expect(strip(await repository.loadDataset())).toEqual(strip(bundled))
  })

  it('asks the database, as each user, which districts row level security lets them read', async () => {
    const visible = async (id: string) => [...(await repository.visibleDistrictIds(id))].sort()
    expect(await visible(USERS.national)).toEqual(bundled.districts.map((d) => d.id).sort())
    expect(await visible(USERS.admin)).toHaveLength(7)
    expect(await visible(USERS.employer)).toHaveLength(7)
    expect(await visible(USERS.telangana)).toEqual(['hyderabad', 'rangareddy', 'warangal'])
    expect(await visible(USERS.warangal)).toEqual(['warangal'])
    expect(await visible(USERS.pending)).toEqual([]) // signed up, not approved
    expect(await visible('20000000-0000-0000-0000-000000000000')).toEqual([]) // no such user
  })

  it('does not leave the connection in the user\'s role afterwards', async () => {
    await repository.visibleDistrictIds(USERS.warangal)
    for (let i = 0; i < 6; i++) {
      const { rows } = await pool().query<{ n: number }>('select count(distinct district_id)::int as n from public.labour_demand')
      expect(rows[0].n).toBe(7)
    }
  })

  it('reads profiles with role, approval and scope', async () => {
    expect(await repository.getProfile(USERS.warangal)).toMatchObject({ role: 'district_planner', approved: true, stateId: 'TG', districtId: 'warangal' })
    expect(await repository.getProfile(USERS.pending)).toMatchObject({ role: 'employer', approved: false })
    expect(await repository.getProfile('20000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('loads a file in one transaction: rows, lineage, the run, the source and the as-of month', async () => {
    const spec = specFor('job-portals')!
    const before = await repository.loadDataset()
    const text = 'posting_date,job_title,city,industry,openings\n2026-10-12,Solar PV Installer,Hanamkonda,Green Jobs,75\n2026-09-12,Solar Technician,Warangal,Renewable Energy,61\n2026-10-12,Astrologer,Warangal,Services,3\n'
    const outcome = ingestExtract(spec, text, before, { today: '2026-11' })
    const record = await applyToDatabase(pool(), spec, outcome, { fileName: 'october.csv', loadedAt: '2026-11-02T10:00:00.000Z', loadedBy: 'integration test', mode: 'merge', synthetic: true })
    expect(record).toMatchObject({ id: 6, sourceId: 'job-portals', rowsRead: 3, rowsMapped: 2, rowsRejected: 1 })

    const after = await repository.loadDataset()
    const row = (period: string) => after.labourDemand.find((r) => r.districtId === 'warangal' && r.tradeId === 'solar-technician' && r.period === period)!
    const old = before.labourDemand.find((r) => r.districtId === 'warangal' && r.tradeId === 'solar-technician' && r.period === '2026-09')!
    // September: postings replaced by this load, the other three signals untouched and still attributed to their own loads.
    expect(row('2026-09')).toMatchObject({ jobPostings: 61, employmentRegistrations: old.employmentRegistrations, hiringSignal: old.hiringSignal, industryDemandSignal: old.industryDemandSignal })
    expect(row('2026-09').lineage).toEqual({ ...old.lineage, jobPostings: 6 })
    // October: a new row with only the signal this source provides.
    expect(row('2026-10')).toMatchObject({ jobPostings: 75, employmentRegistrations: null, hiringSignal: null, sectorId: 'renewable-energy', lineage: { jobPostings: 6 } })
    expect(after.labourDemand.length).toBe(before.labourDemand.length + 1)
    // One pair's October row does not move "today" for the other 85 pairs: the as-of month stays where most pairs have data.
    expect(after.meta).toMatchObject({ asOfPeriod: '2026-09', updatedAt: '2026-11-02', synthetic: true })
    // The in-memory loader (used for the bundled file) applies the same rule and reaches the same result.
    expect(applyToDataset(before, spec, outcome, { fileName: 'october.csv', loadedAt: '2026-11-02T10:00:00.000Z', loadedBy: 'integration test', mode: 'merge', synthetic: true }).meta).toEqual(after.meta)
    expect(after.dataSources.find((s) => s.id === 'job-portals')).toMatchObject({ lastUpdated: '2026-11-02', recordsIn: 3, recordsMapped: 2, status: 'prototype_synthetic' })
    expect(after.ingestionRuns.at(-1)).toMatchObject({ id: 6, fileName: 'october.csv', loadedBy: 'integration test' })
    expect(after.ingestionRuns.at(-1)?.rejects[0]).toMatchObject({ reason: 'occupation_unknown', example: 'Astrologer' })

    // The copy kept for SQL clients follows the new rows.
    const snapshot = buildSnapshot(after)
    await writeDerived(pool(), snapshot)
    const cell = snapshot.cells.find((c) => c.key === 'warangal|solar-technician')!
    const derived = await pool().query<{ demand: number | null }>("select demand from public.gap_analysis where district_id = 'warangal' and trade_id = 'solar-technician' and horizon = '12M'")
    expect(derived.rows[0].demand).toBe(cell.horizons['12M'].demand)
    const stamp = await pool().query<{ fresh: boolean }>("select derived_at > now() - interval '1 minute' as fresh from public.dataset_meta")
    expect(stamp.rows[0].fresh).toBe(true)
  })

  it('replace removes what the source loaded before, and real data flips the labels only then', async () => {
    const spec = specFor('training-capacity')!
    const refs = await repository.loadDataset()
    const text = 'training_year,district,trade,sector,allocated_seats,enrolled,completed,placed\n2026-27,Warangal,Solar Technician,Renewable Energy,900,850,,\n'
    const outcome = ingestExtract(spec, text, refs, { today: '2026-11' })
    await applyToDatabase(pool(), spec, outcome, { fileName: 'real-merge.csv', loadedAt: '2026-11-03T10:00:00.000Z', loadedBy: 'integration test', mode: 'merge', synthetic: false })
    let d = await repository.loadDataset()
    expect(d.trainingCapacity.length).toBe(bundled.trainingCapacity.length) // one row updated in place
    expect(d.dataSources.find((s) => s.id === 'training-capacity')?.status).toBe('prototype_synthetic') // synthetic rows remain beside it

    await applyToDatabase(pool(), spec, outcome, { fileName: 'real-replace.csv', loadedAt: '2026-11-04T10:00:00.000Z', loadedBy: 'integration test', mode: 'replace', synthetic: false })
    d = await repository.loadDataset()
    expect(d.trainingCapacity).toHaveLength(1)
    expect(d.trainingCapacity[0]).toMatchObject({ districtId: 'warangal', tradeId: 'solar-technician', year: 2026, allocatedSeats: 900, enrolled: 850, completed: null })
    expect(d.dataSources.find((s) => s.id === 'training-capacity')?.status).toBe('uploaded')
    expect(d.meta.synthetic).toBe(true) // the demand sources are still synthetic, so the dataset as a whole still is
  })

  it('rolls everything back when a load fails part-way', async () => {
    const spec = specFor('job-portals')!
    const before = await repository.loadDataset()
    const outcome = ingestExtract(spec, 'posting_date,job_title,city,industry,openings\n2026-10-12,Mason,Pune,Construction,5\n', before, { today: '2026-11' })
    // A trade that does not exist makes the insert fail on its foreign key... the join drops it, so break the value instead.
    outcome.demand[0].value = -1 // violates the check on job_postings
    await expect(applyToDatabase(pool(), spec, outcome, { fileName: 'bad.csv', loadedAt: '2026-11-05T10:00:00.000Z', loadedBy: 'integration test', mode: 'replace', synthetic: true })).rejects.toThrow()
    const after = await repository.loadDataset()
    expect(after.ingestionRuns.length).toBe(before.ingestionRuns.length) // no run recorded
    expect(after.labourDemand.filter((r) => r.jobPostings !== null).length).toBe(before.labourDemand.filter((r) => r.jobPostings !== null).length) // "replace" did not wipe anything
  })
})
