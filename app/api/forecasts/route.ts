import { api } from '@/lib/server/http'
import { forecastsView } from '@/lib/server/views'

export const GET = api(({ snapshot, filters }) => forecastsView(snapshot, filters))
