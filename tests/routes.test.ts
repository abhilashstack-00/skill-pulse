import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dataset } from '@/lib/domain/types'
import type { Session } from '@/lib/server/session'

/**
 * Route-level tests: every API route is called the way the browser calls it,
 * as every role, and the whole response is searched for anything outside that
 * role's scope. The session and the database's answer about visible districts
 * are the only things replaced; the handlers, the wrapper, the filters, the
 * views and the engines are the real ones.
 */

const state = vi.hoisted(() => ({
  session: null as unknown,
  visible: null as Set<string> | null,
  env: { databaseUrl: undefined as string | undefined, supabaseUrl: undefined, supabaseAnonKey: undefined, supabaseServiceRoleKey: undefined, snapshotTtlSeconds: 300, rateLimitPerMinute: 100000 },
}))

vi.mock('@/lib/config/env', () => ({ env: state.env, authEnabled: false, demoModeAllowed: true }))
vi.mock('@/lib/server/session', () => ({
  getSession: async () => state.session,
  createSupabaseServerClient: async () => { throw new Error('not used in these tests') },
  ROLES: ['admin', 'national_planner', 'state_planner', 'district_planner', 'employer'],
  DEMO_ROLE_COOKIE: 'sp_demo_role',
}))
vi.mock('@/lib/server/db-scope', () => ({ visibleDistrictIds: async () => state.visible, clearScopeCache: () => undefined }))

import { GET as alerts } from '@/app/api/alerts/route'
import { GET as summary } from '@/app/api/dashboard/summary/route'
import { GET as demand } from '@/app/api/demand/route'
import { GET as district } from '@/app/api/district/[id]/route'
import { GET as districts } from '@/app/api/districts/route'
import { GET as drilldown } from '@/app/api/drilldown/route'
import { GET as evidence } from '@/app/api/evidence/route'
import { GET as exportRoute } from '@/app/api/export/route'
import { GET as forecasts } from '@/app/api/forecasts/route'
import { GET as gaps } from '@/app/api/gaps/route'
import { GET as ingestInfo, POST as ingest } from '@/app/api/ingest/route'
import { GET as meta } from '@/app/api/meta/route'
import { GET as methodology } from '@/app/api/methodology/route'
import { GET as priority } from '@/app/api/priority/route'
import { GET as recommendations } from '@/app/api/recommendations/route'
import { GET as sectors } from '@/app/api/sectors/route'
import { GET as sources } from '@/app/api/sources/route'
import { GET as states } from '@/app/api/states/route'
import { GET as supply } from '@/app/api/supply/route'
import { GET as trade } from '@/app/api/trade/[id]/route'
import { GET as trades } from '@/app/api/trades/route'
import { GET as summaryAlias } from '@/app/api/summary/route'
import { GET as prioritiesAlias } from '@/app/api/priorities/route'
import { GET as dataSourcesAlias } from '@/app/api/data-sources/route'

const dataset = JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset
const stateOf = new Map(dataset.districts.map((d) => [d.id, d.stateId]))
const ALL_DISTRICTS = dataset.districts.map((d) => d.id)

let counter = 0
const sessionFor = (over: Partial<Session>): Session => ({
  userId: `user-${++counter}`, name: 'Test user', email: 'test@example.test', role: 'national_planner', stateId: null, districtId: null, approved: true, demo: false, evaluator: false, ...over,
})

type Handler = (request: NextRequest) => Promise<Response>
const call = (handler: Handler, path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => handler(new NextRequest(`http://localhost${path}`, init))
const withId = (handler: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>, id: string): Handler => (request) => handler(request, { params: Promise.resolve({ id }) })

/** Every read route, with the query the screens send. */
const READ_ROUTES: { name: string; handler: Handler; path: string }[] = [
  { name: 'meta', handler: meta, path: '/api/meta' },
  { name: 'dashboard/summary', handler: summary, path: '/api/dashboard/summary' },
  { name: 'demand', handler: demand, path: '/api/demand' },
  { name: 'supply', handler: supply, path: '/api/supply' },
  { name: 'gaps', handler: gaps, path: '/api/gaps' },
  { name: 'forecasts', handler: forecasts, path: '/api/forecasts' },
  { name: 'priority', handler: priority, path: '/api/priority' },
  { name: 'priority by district', handler: priority, path: '/api/priority?groupBy=district' },
  { name: 'alerts', handler: alerts, path: '/api/alerts' },
  { name: 'states', handler: states, path: '/api/states' },
  { name: 'districts', handler: districts, path: '/api/districts' },
  { name: 'sectors', handler: sectors, path: '/api/sectors' },
  { name: 'trades', handler: trades, path: '/api/trades' },
  { name: 'trade/solar-technician', handler: withId(trade, 'solar-technician'), path: '/api/trade/solar-technician' },
  { name: 'drilldown', handler: drilldown, path: '/api/drilldown' },
  { name: 'methodology', handler: methodology, path: '/api/methodology' },
  { name: 'sources', handler: sources, path: '/api/sources' },
  { name: 'export gaps', handler: exportRoute, path: '/api/export?dataset=gaps&format=json' },
  { name: 'export forecasts', handler: exportRoute, path: '/api/export?dataset=forecasts&format=json' },
  { name: 'export alerts', handler: exportRoute, path: '/api/export?dataset=alerts&format=json' },
  { name: 'ingest history', handler: ingestInfo, path: '/api/ingest' },
  { name: 'summary', handler: summaryAlias, path: '/api/summary' },
  { name: 'priorities', handler: prioritiesAlias, path: '/api/priorities' },
  { name: 'data-sources', handler: dataSourcesAlias, path: '/api/data-sources' },
]
const PLANNER_ROUTES: typeof READ_ROUTES = [
  { name: 'recommendations', handler: recommendations, path: '/api/recommendations' },
  { name: 'export recommendations', handler: exportRoute, path: '/api/export?dataset=recommendations&format=json' },
]

/** Every district and state id that appears anywhere in a response. */
function placesIn(value: unknown, found = { districts: new Set<string>(), states: new Set<string>() }) {
  if (Array.isArray(value)) for (const item of value) placesIn(item, found)
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    for (const [key, v] of Object.entries(o)) {
      if (typeof v === 'string') {
        if ((key === 'districtId' || key === 'peakDistrictId') && v) found.districts.add(v)
        if (key === 'stateId' && v) found.states.add(v)
        const pair = v.split('|')
        if (pair.length === 2 && stateOf.has(pair[0])) found.districts.add(pair[0])
        // Export rows name places by their display names.
        if (key === 'district') found.districts.add(dataset.districts.find((d) => d.name === v)?.id ?? `unknown:${v}`)
        if (key === 'state') found.states.add(dataset.states.find((s) => s.name === v)?.id ?? `unknown:${v}`)
      }
      placesIn(v, found)
    }
    // Option lists: { id, stateId } is a district, { id, code } without stateId inside "states" is a state.
    if (typeof o.id === 'string' && stateOf.has(o.id)) found.districts.add(o.id)
  }
  return found
}

beforeEach(() => {
  state.session = sessionFor({})
  state.visible = null
  state.env.databaseUrl = undefined
})

describe('signed out or not approved', () => {
  it('answers 401 on every route when there is no session', async () => {
    state.session = null
    for (const route of [...READ_ROUTES, ...PLANNER_ROUTES]) expect((await call(route.handler, route.path)).status, route.name).toBe(401)
  })

  it('answers 403 on every route for an account awaiting approval, whatever its role', async () => {
    for (const role of ['admin', 'national_planner', 'employer'] as const) {
      state.session = sessionFor({ role, approved: false })
      for (const route of [...READ_ROUTES, ...PLANNER_ROUTES]) {
        const response = await call(route.handler, route.path)
        expect(response.status, `${role} ${route.name}`).toBe(403)
        expect(JSON.stringify(await response.json())).not.toMatch(/districtId|demand/)
      }
    }
  })

  it('answers 403 for planners with no area assigned', async () => {
    for (const session of [sessionFor({ role: 'state_planner' }), sessionFor({ role: 'district_planner' })]) {
      state.session = session
      for (const route of READ_ROUTES) expect((await call(route.handler, route.path)).status, route.name).toBe(403)
    }
  })
})

describe('scope: nothing outside a role\'s area leaves the server', () => {
  const cases: { label: string; session: Partial<Session>; districts: string[] }[] = [
    { label: 'district planner (Warangal)', session: { role: 'district_planner', districtId: 'warangal' }, districts: ['warangal'] },
    { label: 'district planner (Pune)', session: { role: 'district_planner', districtId: 'pune' }, districts: ['pune'] },
    { label: 'state planner (Telangana)', session: { role: 'state_planner', stateId: 'TG' }, districts: ['hyderabad', 'rangareddy', 'warangal'] },
    { label: 'state planner (Karnataka)', session: { role: 'state_planner', stateId: 'KA' }, districts: ['bengaluru-urban', 'mysuru'] },
  ]

  it.each(cases)('$label: every route returns only its own districts and states', async ({ session, districts }) => {
    const allowedStates = new Set(districts.map((d) => stateOf.get(d)))
    for (const route of [...READ_ROUTES, ...PLANNER_ROUTES]) {
      state.session = sessionFor(session)
      const response = await call(route.handler, route.path)
      expect(response.status, route.name).toBe(200)
      const found = placesIn(await response.json())
      for (const id of found.districts) expect(districts, `${route.name} leaked district ${id}`).toContain(id)
      for (const id of found.states) expect([...allowedStates], `${route.name} leaked state ${id}`).toContain(id)
    }
  })

  it.each(cases)('$label: asking for somewhere else is refused on every filterable route', async ({ session, districts }) => {
    const outside = ALL_DISTRICTS.find((d) => !districts.includes(d) && stateOf.get(d) !== stateOf.get(districts[0]))!
    for (const route of [...READ_ROUTES, ...PLANNER_ROUTES]) {
      state.session = sessionFor(session)
      const separator = route.path.includes('?') ? '&' : '?'
      expect((await call(route.handler, `${route.path}${separator}districtId=${outside}`)).status, `${route.name} districtId`).toBe(403)
      state.session = sessionFor(session)
      expect((await call(route.handler, `${route.path}${separator}stateId=${stateOf.get(outside)}`)).status, `${route.name} stateId`).toBe(403)
    }
    state.session = sessionFor(session)
    expect((await call(withId(district, outside), `/api/district/${outside}`)).status).toBe(403)
    state.session = sessionFor(session)
    expect((await call(evidence, `/api/evidence?districtId=${outside}&tradeId=mason`)).status).toBe(403)
  })

  it('district planner: totals on the map are their own district, not the state', async () => {
    state.session = sessionFor({ role: 'district_planner', districtId: 'warangal' })
    const body = (await (await call(drilldown, '/api/drilldown')).json()).data
    state.session = sessionFor({ role: 'district_planner', districtId: 'warangal' })
    const own = (await (await call(summary, '/api/dashboard/summary')).json()).data.totals
    expect(body.states).toHaveLength(1)
    expect(body.states[0]).toMatchObject({ stateId: 'TG', demand: own.demand, supply: own.supply })
    state.session = sessionFor({})
    const national = (await (await call(drilldown, '/api/drilldown')).json()).data
    expect(national.states.find((s: { stateId: string }) => s.stateId === 'TG').demand).toBeGreaterThan(own.demand)
  })

  it('unrestricted roles see every district', async () => {
    for (const role of ['admin', 'national_planner', 'employer'] as const) {
      state.session = sessionFor({ role })
      const found = placesIn(await (await call(gaps, '/api/gaps')).json())
      expect([...found.districts].sort()).toEqual([...ALL_DISTRICTS].sort())
    }
  })

  it('what the database lets the user read is the outer limit, for every role', async () => {
    // Row level security answers "Pune and Nagpur only" for this user: even a national role gets no more.
    for (const route of [...READ_ROUTES, ...PLANNER_ROUTES]) {
      state.session = sessionFor({ role: 'national_planner' })
      state.visible = new Set(['pune', 'nagpur'])
      const response = await call(route.handler, route.path)
      expect(response.status, route.name).toBe(200)
      const found = placesIn(await response.json())
      for (const id of found.districts) expect(['pune', 'nagpur'], `${route.name} leaked ${id}`).toContain(id)
      for (const id of found.states) expect(id, route.name).toBe('MH')
    }
    state.session = sessionFor({ role: 'national_planner' })
    expect((await call(gaps, '/api/gaps?districtId=warangal')).status).toBe(403)
    // A district planner whose district the database does not grant gets nothing.
    state.session = sessionFor({ role: 'district_planner', districtId: 'warangal' })
    expect((await call(gaps, '/api/gaps')).status).toBe(403)
  })
})

describe('permissions', () => {
  it('employer: market intelligence yes, planner recommendations nowhere', async () => {
    for (const route of READ_ROUTES) {
      state.session = sessionFor({ role: 'employer' })
      const response = await call(route.handler, route.path)
      expect(response.status, route.name).toBe(200)
      const text = JSON.stringify(await response.json())
      expect(text, route.name).not.toMatch(/increase_capacity|fill_seats_first|reduce_or_redirect|review_allocation/)
    }
    for (const route of PLANNER_ROUTES) {
      state.session = sessionFor({ role: 'employer' })
      expect((await call(route.handler, route.path)).status, route.name).toBe(403)
    }
    state.session = sessionFor({ role: 'employer' })
    const view = (await (await call(withId(trade, 'solar-technician'), '/api/trade/solar-technician?districtId=warangal')).json()).data
    expect(view.recommendations).toBeNull()
    state.session = sessionFor({ role: 'employer' })
    expect((await (await call(meta, '/api/meta')).json()).data.session.permissions).toEqual({ recommendations: false, export: true, ingest: false })
  })

  it('planners get recommendations, including on the trade route', async () => {
    for (const role of ['admin', 'national_planner'] as const) {
      for (const route of PLANNER_ROUTES) {
        state.session = sessionFor({ role })
        expect((await call(route.handler, route.path)).status, `${role} ${route.name}`).toBe(200)
      }
      state.session = sessionFor({ role })
      const view = (await (await call(withId(trade, 'solar-technician'), '/api/trade/solar-technician?districtId=warangal')).json()).data
      expect(view.recommendations[0].action).toBe('increase_capacity')
    }
  })

  const upload = (fields: Record<string, string>, csv = 'posting_date,job_title,city,industry,openings\n2026-09-10,Mason,Pune,Construction,35\n2026-09-11,Astrologer,Pune,Services,2\n') => {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, value)
    form.set('file', new File([csv], 'upload.csv', { type: 'text/csv' }))
    return call(ingest, '/api/ingest', { method: 'POST', body: form })
  }

  it('only an administrator can load data', async () => {
    for (const role of ['national_planner', 'state_planner', 'district_planner', 'employer'] as const) {
      state.session = sessionFor({ role, stateId: 'TG', districtId: 'warangal' })
      expect((await upload({ source: 'job-portals', dryRun: 'true' })).status, role).toBe(403)
    }
    state.session = sessionFor({ role: 'admin' })
    const response = await upload({ source: 'job-portals', dryRun: 'true' })
    expect(response.status).toBe(200)
    const body = (await response.json()).data
    expect(body.written).toBe(false)
    expect(body.report).toMatchObject({ rowsRead: 2, rowsMapped: 1, rowsRejected: 1 })
    expect(body.report.rejects[0]).toMatchObject({ reason: 'occupation_unknown', example: 'Astrologer' })
  })

  it('validates an upload before doing anything with it', async () => {
    state.session = sessionFor({ role: 'admin' })
    expect((await upload({ source: 'no-such-source', dryRun: 'true' })).status).toBe(400)
    state.session = sessionFor({ role: 'admin' })
    expect((await upload({ source: 'job-portals', dryRun: 'true' }, 'a,b\n1,2\n')).status).toBe(400)
    state.session = sessionFor({ role: 'admin' })
    expect((await upload({ source: 'job-portals', dryRun: 'true' }, '')).status).toBe(400)
    state.session = sessionFor({ role: 'admin' })
    expect((await call(ingest, '/api/ingest', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(400)
  })

  it('refuses to write when there is no database, and says how to load the file instead', async () => {
    state.session = sessionFor({ role: 'admin' })
    const response = await upload({ source: 'job-portals' })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/pnpm ingest/)
  })

  it('refuses a request that changes data from another site', async () => {
    state.session = sessionFor({ role: 'admin' })
    const form = new FormData()
    form.set('source', 'job-portals')
    const response = await call(ingest, '/api/ingest', { method: 'POST', body: form, headers: { origin: 'https://evil.example', host: 'localhost' } })
    expect(response.status).toBe(403)
  })
})

describe('route names', () => {
  it('serves the summary, priorities and data sources under both names with the same answer', async () => {
    for (const [first, second, path, other] of [[summary, summaryAlias, '/api/dashboard/summary?stateId=TG', '/api/summary?stateId=TG'], [priority, prioritiesAlias, '/api/priority?groupBy=trade', '/api/priorities?groupBy=trade'], [sources, dataSourcesAlias, '/api/sources', '/api/data-sources']] as const) {
      state.session = sessionFor({})
      const a = await (await call(first, path)).json()
      state.session = sessionFor({})
      const b = await (await call(second, other)).json()
      expect(b, other).toEqual(a)
    }
    state.session = sessionFor({})
    expect((await call(prioritiesAlias, '/api/priorities?groupBy=colour')).status).toBe(400)
  })
})

describe('input, provenance and limits', () => {
  it('rejects unknown ids and bad values with 400, unknown resources with 404', async () => {
    for (const path of ['/api/gaps?districtId=atlantis', '/api/gaps?horizon=24M', '/api/gaps?status=fine', '/api/export?dataset=secrets', '/api/priority?groupBy=colour', '/api/evidence?districtId=pune']) {
      state.session = sessionFor({})
      const handler = path.startsWith('/api/export') ? exportRoute : path.startsWith('/api/priority') ? priority : path.startsWith('/api/evidence') ? evidence : gaps
      expect((await call(handler, path)).status, path).toBe(400)
    }
    state.session = sessionFor({})
    expect((await call(withId(trade, 'astrologer'), '/api/trade/astrologer')).status).toBe(404)
    state.session = sessionFor({})
    expect((await call(withId(district, 'atlantis'), '/api/district/atlantis')).status).toBe(404)
    state.session = sessionFor({})
    expect((await call(evidence, '/api/evidence?districtId=warangal&tradeId=wind-turbine-technician')).status).toBe(404)
  })

  it('labels every answer with where the data came from, and forbids caching', async () => {
    for (const route of READ_ROUTES) {
      state.session = sessionFor({})
      const response = await call(route.handler, route.path)
      expect(response.headers.get('cache-control'), route.name).toBe('private, no-store')
      expect((await response.json()).meta, route.name).toMatchObject({ dataLabel: 'Prototype synthetic pilot data', synthetic: true, asOfPeriod: '2026-09' })
    }
    state.session = sessionFor({})
    const csv = await call(exportRoute, '/api/export?dataset=gaps&districtId=warangal')
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(csv.headers.get('x-data-label')).toBe('Prototype synthetic pilot data')
    expect(await csv.text()).toContain('Prototype synthetic pilot data')
  })

  it('limits how fast one address, and one user, can call the API', async () => {
    state.env.rateLimitPerMinute = 5
    const from = (address: string) => ({ headers: { 'x-forwarded-for': address } })
    // One address, a different user each time: stopped by address, before any session is looked up.
    const byAddress: number[] = []
    for (let i = 0; i < 8; i++) {
      state.session = sessionFor({ userId: `address-test-${i}` })
      byAddress.push((await call(states, '/api/states', from('203.0.113.7'))).status)
    }
    // One user, a different address each time: stopped by user.
    const user = sessionFor({ userId: 'user-test' })
    const byUser: number[] = []
    for (let i = 0; i < 8; i++) {
      state.session = user
      byUser.push((await call(states, '/api/states', from(`198.51.100.${i}`))).status)
    }
    state.env.rateLimitPerMinute = 100000
    expect(byAddress).toEqual([200, 200, 200, 200, 200, 429, 429, 429])
    expect(byUser).toEqual([200, 200, 200, 200, 200, 429, 429, 429])
  })

  it('refuses an unreadable Origin header instead of failing', async () => {
    for (const origin of ['null', 'not a url']) {
      state.session = sessionFor({ role: 'admin' })
      const form = new FormData()
      form.set('source', 'job-portals')
      expect((await call(ingest, '/api/ingest', { method: 'POST', body: form, headers: { origin, host: 'localhost' } })).status, origin).toBe(403)
    }
  })

  it('gives the evidence for one pair, straight from the stored rows', async () => {
    state.session = sessionFor({ role: 'district_planner', districtId: 'warangal' })
    const body = (await (await call(evidence, '/api/evidence?districtId=warangal&tradeId=solar-technician')).json()).data
    const stored = dataset.labourDemand.filter((r) => r.districtId === 'warangal' && r.tradeId === 'solar-technician')
    expect(body.demandRows).toHaveLength(stored.length)
    expect(body.demandRows.at(-1)).toMatchObject({ period: '2026-09', jobPostings: stored.find((r) => r.period === '2026-09')?.jobPostings })
    expect(body.runs.length).toBe(5)
  })
})
