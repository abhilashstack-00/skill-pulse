import { api } from '@/lib/server/http'

export const GET = api(({ snapshot, filters }) =>
  snapshot.dataset.districts.filter(
    (d) => (!filters.stateId || d.stateId === filters.stateId) && (!filters.districtId || d.id === filters.districtId) && (!filters.districtIds || filters.districtIds.has(d.id)),
  ),
)
