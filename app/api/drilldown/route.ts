import { api } from '@/lib/server/http'
import { drilldownView } from '@/lib/server/views'

export const GET = api(({ snapshot, filters, scope }) => drilldownView(snapshot, filters, scope))
