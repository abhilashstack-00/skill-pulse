import { api } from '@/lib/server/http'

export const GET = api(({ snapshot, scope }) =>
  snapshot.dataset.states.filter(
    (s) => (!scope.stateId || s.id === scope.stateId) && (!scope.districtIds || snapshot.dataset.districts.some((d) => d.stateId === s.id && scope.districtIds!.has(d.id))),
  ),
)
