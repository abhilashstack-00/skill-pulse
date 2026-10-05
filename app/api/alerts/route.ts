import { api } from '@/lib/server/http'
import { alertsView } from '@/lib/server/views'

export const GET = api(({ snapshot, filters }) => alertsView(snapshot, filters))
