import { api } from '@/lib/server/http'

export const GET = api(({ snapshot }) => snapshot.dataset.sectors)
