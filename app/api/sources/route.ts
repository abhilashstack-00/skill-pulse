import { api } from '@/lib/server/http'
import { sourcesView } from '@/lib/server/views'

export const GET = api(({ snapshot }) => sourcesView(snapshot))
