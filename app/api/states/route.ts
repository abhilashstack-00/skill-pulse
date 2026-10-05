import { api } from '@/lib/server/http'

export const GET = api(({ snapshot, scope }) => snapshot.dataset.states.filter((s) => !scope.stateId || s.id === scope.stateId))
