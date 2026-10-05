import type { Snapshot } from '@/lib/domain/types'
import type { Role } from '@/lib/repository'
import type { Session } from './session'

export type Permission = 'view' | 'recommendations' | 'export'

const PLANNERS: Role[] = ['admin', 'national_planner', 'state_planner', 'district_planner']

/** What each role may do. Row scope (state / district) is applied separately. */
export function can(session: Session, permission: Permission): boolean {
  if (permission === 'view') return true
  return PLANNERS.includes(session.role)
}

export interface GeoScope {
  stateId: string | null
  districtId: string | null
}

/**
 * The geography a session is limited to. Null means no limit at that level.
 * A state or district planner whose account has no area assigned gets nothing:
 * a missing assignment must never widen access.
 */
export function scopeOf(session: Session, snapshot: Snapshot): GeoScope {
  if (session.role === 'district_planner') {
    if (!session.districtId) throw new AccessError(403, 'This district planner account has no district assigned. Ask an administrator to set one.')
    const district = snapshot.dataset.districts.find((d) => d.id === session.districtId)
    if (!district) throw new AccessError(403, 'The district assigned to this account is not in the dataset.')
    return { stateId: district.stateId, districtId: district.id }
  }
  if (session.role === 'state_planner') {
    if (!session.stateId) throw new AccessError(403, 'This state planner account has no state assigned. Ask an administrator to set one.')
    return { stateId: session.stateId, districtId: null }
  }
  return { stateId: null, districtId: null }
}

export class AccessError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message)
  }
}
