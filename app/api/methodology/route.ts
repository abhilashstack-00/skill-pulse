import { api } from '@/lib/server/http'
import { methodologyView } from '@/lib/server/views'

export const GET = api(({ snapshot }) => methodologyView(snapshot))
