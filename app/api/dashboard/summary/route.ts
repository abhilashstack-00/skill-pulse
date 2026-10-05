import { api } from '@/lib/server/http'
import { summaryView } from '@/lib/server/views'

export const GET = api(({ snapshot, filters }) => summaryView(snapshot, filters))
