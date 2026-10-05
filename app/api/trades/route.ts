import { api } from '@/lib/server/http'

export const GET = api(({ snapshot, filters }) => snapshot.dataset.trades.filter((t) => !filters.sectorId || t.sectorId === filters.sectorId))
