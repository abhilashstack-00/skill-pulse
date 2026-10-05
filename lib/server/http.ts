import { NextResponse, type NextRequest } from 'next/server'
import type { Snapshot } from '@/lib/domain/types'
import { AccessError, can, scopeOf, type GeoScope, type Permission } from './access'
import { parseFilters, ValidationError, type Filters } from './filters'
import { env } from '@/lib/config/env'
import { visibleDistrictIds } from './db-scope'
import { getSession, type Session } from './session'
import { getSnapshot } from './snapshot'

export interface ApiContext {
  request: NextRequest
  url: URL
  snapshot: Snapshot
  session: Session
  scope: GeoScope
  filters: Filters
}

export class NotFoundError extends Error {}

const noStore = { 'Cache-Control': 'private, no-store' }
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: noStore })

/** Provenance attached to every API response. */
export function provenance(snapshot: Snapshot) {
  return {
    dataLabel: snapshot.meta.label,
    synthetic: snapshot.meta.synthetic,
    asOfPeriod: snapshot.meta.asOfPeriod,
    updatedAt: snapshot.meta.updatedAt,
    methodologyVersion: snapshot.methodologyVersion,
  }
}

/* Rate limit: a fixed window per client, kept in memory. Enough to blunt a runaway
   script against one instance; a deployment behind several instances needs a shared store. */
const WINDOW_MS = 60_000
const hits = new Map<string, { windowStart: number; count: number }>()

function overLimit(key: string): boolean {
  const now = Date.now()
  const entry = hits.get(key)
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.windowStart >= WINDOW_MS) hits.delete(k)
    hits.set(key, { windowStart: now, count: 1 })
    return false
  }
  entry.count += 1
  return entry.count > env.rateLimitPerMinute
}

/**
 * The address the request claims to come from. X-Forwarded-For is set by the
 * proxy in front of the app; without a proxy a client can put anything in it,
 * and every client without the header shares one bucket. Good enough to slow
 * a runaway script, not a defence against someone trying.
 */
const addressKey = (request: NextRequest) => `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'}`

/** True when the request names an origin that is not this site. A missing header is allowed: same-origin GET-style clients omit it. */
function crossSite(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (origin === null) return false
  try {
    return new URL(origin).host !== request.headers.get('host')
  } catch {
    // "null" (sandboxed frames, some redirects) and anything else that is not a URL.
    return true
  }
}

export interface ApiOptions {
  permission?: Permission
}

/**
 * Wraps a route handler: authenticates, checks the role, asks the database what
 * the user may read, applies that scope to the filters, and turns errors into
 * HTTP statuses. Every data route goes through here.
 */
export function api(handler: (ctx: ApiContext) => unknown | Promise<unknown>, options: ApiOptions = {}) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      // By address first, before any work is done for the request (checking a session costs a call to the auth server).
      if (overLimit(addressKey(request))) return fail(429, 'Too many requests. Try again in a minute.')
      const session = await getSession()
      if (!session) return fail(401, 'Sign in to use the SkillPulse API.')
      // Then by user, so one account cannot get more by changing address.
      if (session.userId && overLimit(`user:${session.userId}`)) return fail(429, 'Too many requests. Try again in a minute.')
      // Anything that changes data must come from this site's own pages.
      if (request.method !== 'GET' && request.method !== 'HEAD' && crossSite(request)) return fail(403, 'Cross-site request refused.')
      if (!session.approved) return fail(403, 'This account is waiting for an administrator to approve it.')
      if (!can(session, options.permission ?? 'view')) return fail(403, 'Your role does not have access to this resource.')
      const snapshot = await getSnapshot()
      const url = new URL(request.url)
      const scope = scopeOf(session, snapshot, await visibleDistrictIds(session))
      const filters = parseFilters(url.searchParams, snapshot, scope)
      const result = await handler({ request, url, snapshot, session, scope, filters })
      if (result instanceof Response) return result
      return NextResponse.json({ data: result, meta: provenance(snapshot) }, { headers: noStore })
    } catch (error) {
      if (error instanceof AccessError) return fail(error.status, error.message)
      if (error instanceof ValidationError) return fail(400, error.message)
      if (error instanceof NotFoundError) return fail(404, error.message)
      // The message is logged, not the object: database errors can carry row contents.
      console.error('[api]', request.nextUrl.pathname, error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error')
      return fail(500, 'The request could not be completed.')
    }
  }
}

/** Refuse access to a district or state outside the session's scope. */
export function assertInScope(scope: GeoScope, target: { stateId?: string | null; districtId?: string | null }) {
  if (scope.districtId && target.districtId && target.districtId !== scope.districtId) throw new AccessError(403, 'That district is outside your access scope.')
  if (scope.stateId && target.stateId && target.stateId !== scope.stateId) throw new AccessError(403, 'That state is outside your access scope.')
  if (scope.districtIds && target.districtId && !scope.districtIds.has(target.districtId)) throw new AccessError(403, 'That district is outside your access scope.')
}
