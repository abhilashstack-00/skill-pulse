import type { Snapshot } from '@/lib/domain/types'
import type { Role } from '@/lib/repository'
import type { Session } from './session'

export class AccessError extends Error {
  constructor(public readonly status: 401 | 403 | 503, message: string) {
    super(message)
  }
}

/**
 * What a role may do. Which rows it may see is decided separately by scope.
 *   view             market intelligence: demand, supply, gaps, forecasts, warnings, exports of those
 *   recommendations  planner recommendations and the Action Center
 *   ingest           loading new source data
 */
export type Permission = 'view' | 'recommendations' | 'ingest'

const ALLOWED: Record<Permission, readonly Role[]> = {
  view: ['admin', 'national_planner', 'state_planner', 'district_planner', 'employer'],
  recommendations: ['admin', 'national_planner', 'state_planner', 'district_planner'],
  ingest: ['admin'],
}

export function can(session: Session, permission: Permission): boolean {
  return session.approved && ALLOWED[permission].includes(session.role)
}

export interface GeoScope {
  stateId: string | null
  districtId: string | null
  /**
   * Districts the database itself returns rows for when queried as this user
   * (row level security). Null when there is no signed-in database user, which
   * is the case in demo mode and with the bundled dataset.
   */
  districtIds: ReadonlySet<string> | null
}

/**
 * The geography a session is limited to. Null means no limit at that level.
 *
 * Fails closed: an account that is not approved, has an unknown role, or is a
 * state or district planner with no area assigned, gets nothing. When the
 * database reports which districts the user can read, the scope is checked
 * against it, so application code alone cannot widen access.
 */
export function scopeOf(session: Session, snapshot: Snapshot, visibleDistricts: ReadonlySet<string> | null = null): GeoScope {
  if (!session.approved) throw new AccessError(403, 'This account is waiting for an administrator to approve it.')
  const districts = snapshot.dataset.districts
  switch (session.role) {
    case 'district_planner': {
      if (!session.districtId) throw new AccessError(403, 'This district planner account has no district assigned. Ask an administrator to set one.')
      const district = districts.find((d) => d.id === session.districtId)
      if (!district) throw new AccessError(403, 'The district assigned to this account is not in the dataset.')
      if (visibleDistricts && !visibleDistricts.has(district.id)) throw new AccessError(403, 'The database does not grant this account access to its district.')
      return { stateId: district.stateId, districtId: district.id, districtIds: visibleDistricts }
    }
    case 'state_planner': {
      if (!session.stateId) throw new AccessError(403, 'This state planner account has no state assigned. Ask an administrator to set one.')
      if (!snapshot.dataset.states.some((s) => s.id === session.stateId)) throw new AccessError(403, 'The state assigned to this account is not in the dataset.')
      return { stateId: session.stateId, districtId: null, districtIds: visibleDistricts }
    }
    case 'admin':
    case 'national_planner':
    case 'employer':
      return { stateId: null, districtId: null, districtIds: visibleDistricts }
    default:
      throw new AccessError(403, 'This account has a role the application does not recognise.')
  }
}
