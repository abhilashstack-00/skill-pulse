import { NextResponse, type NextRequest } from 'next/server'
import type { Snapshot } from '@/lib/domain/types'
import { AccessError, can, scopeOf, type GeoScope, type Permission } from './access'
import { parseFilters, ValidationError, type Filters } from './filters'
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

/**
 * Wraps a route handler: authenticates, loads the snapshot, applies the
 * session's scope to the filters, and turns errors into HTTP statuses.
 */
export function api(handler: (ctx: ApiContext) => unknown | Promise<unknown>, options: { permission?: Permission } = {}) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      const session = await getSession()
      if (!session) return fail(401, 'Sign in to use the SkillPulse API.')
      if (options.permission && !can(session, options.permission)) return fail(403, 'Your role does not have access to this resource.')
      const snapshot = await getSnapshot()
      const url = new URL(request.url)
      const scope = scopeOf(session, snapshot)
      const filters = parseFilters(url.searchParams, snapshot, scope)
      const result = await handler({ request, url, snapshot, session, scope, filters })
      if (result instanceof Response) return result
      return NextResponse.json({ data: result, meta: provenance(snapshot) }, { headers: noStore })
    } catch (error) {
      if (error instanceof AccessError) return fail(error.status, error.message)
      if (error instanceof ValidationError) return fail(400, error.message)
      if (error instanceof NotFoundError) return fail(404, error.message)
      console.error('[api]', error)
      return fail(500, 'The request could not be completed.')
    }
  }
}

/** Refuse access to a district or state outside the session's scope. */
export function assertInScope(scope: GeoScope, target: { stateId?: string | null; districtId?: string | null }) {
  if (scope.districtId && target.districtId && target.districtId !== scope.districtId) throw new AccessError(403, 'That district is outside your access scope.')
  if (scope.stateId && target.stateId && target.stateId !== scope.stateId) throw new AccessError(403, 'That state is outside your access scope.')
}
