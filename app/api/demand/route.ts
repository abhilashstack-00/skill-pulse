import { api } from '@/lib/server/http'
import { demandView } from '@/lib/server/views'

export const GET = api(({ snapshot, filters }) => demandView(snapshot, filters))
