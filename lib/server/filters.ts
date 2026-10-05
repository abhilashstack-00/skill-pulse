import { z } from 'zod'
import type { CellAnalysis, HorizonKey, Snapshot, StatusFilter } from '@/lib/domain/types'
import { AccessError, type GeoScope } from './access'

export interface Filters {
  stateId: string | null
  districtId: string | null
  sectorId: string | null
  tradeId: string | null
  horizon: HorizonKey
  status: StatusFilter | null
}

export class ValidationError extends Error {}

const id = z.string().trim().min(1).max(64).optional()
const schema = z.object({
  stateId: id,
  districtId: id,
  sectorId: id,
  tradeId: id,
  horizon: z.enum(['current', '3M', '6M', '12M']).optional(),
  status: z.enum(['severe_shortage', 'shortage', 'balanced', 'oversupply', 'severe_oversupply', 'insufficient_data', 'any_shortage', 'any_oversupply']).optional(),
})

/**
 * Read filters from the query string, check every id exists, and narrow them
 * to what the session is allowed to see. Asking for something outside the
 * session's scope is refused rather than silently changed.
 */
export function parseFilters(params: URLSearchParams, snapshot: Snapshot, scope: GeoScope): Filters {
  const parsed = schema.safeParse(Object.fromEntries([...params.entries()].filter(([, v]) => v !== '')))
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const q = parsed.data
  const d = snapshot.dataset
  const known = (list: { id: string }[], value: string | undefined, name: string) => {
    if (value !== undefined && !list.some((x) => x.id === value)) throw new ValidationError(`Unknown ${name}: ${value}`)
  }
  known(d.states, q.stateId, 'stateId')
  known(d.districts, q.districtId, 'districtId')
  known(d.sectors, q.sectorId, 'sectorId')
  known(d.trades, q.tradeId, 'tradeId')

  let stateId = q.stateId ?? null
  const districtId = q.districtId ?? null
  if (districtId) {
    const parent = d.districts.find((x) => x.id === districtId)?.stateId ?? null
    if (stateId && parent !== stateId) throw new ValidationError('districtId does not belong to stateId')
    stateId = parent
  }
  if (scope.stateId && stateId && stateId !== scope.stateId) throw new AccessError(403, 'That state is outside your access scope.')
  if (scope.districtId && districtId && districtId !== scope.districtId) throw new AccessError(403, 'That district is outside your access scope.')

  return {
    stateId: scope.stateId ?? stateId,
    districtId: scope.districtId ?? districtId,
    sectorId: q.sectorId ?? null,
    tradeId: q.tradeId ?? null,
    horizon: q.horizon ?? '12M',
    status: q.status ?? null,
  }
}

/** Cells matching the geography, sector and trade filters (status is applied by the caller). */
export function filterCells(snapshot: Snapshot, f: Pick<Filters, 'stateId' | 'districtId' | 'sectorId' | 'tradeId'>): CellAnalysis[] {
  return snapshot.cells.filter(
    (c) =>
      (!f.stateId || c.stateId === f.stateId) &&
      (!f.districtId || c.districtId === f.districtId) &&
      (!f.sectorId || c.sectorId === f.sectorId) &&
      (!f.tradeId || c.tradeId === f.tradeId),
  )
}
