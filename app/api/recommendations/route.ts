import { api } from '@/lib/server/http'
import { recommendationsView } from '@/lib/server/views'

export const GET = api(({ snapshot, filters }) => recommendationsView(snapshot, filters), { permission: 'recommendations' })
