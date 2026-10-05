import { api } from '@/lib/server/http'
import { gapsView } from '@/lib/server/views'

export const GET = api(({ snapshot, filters }) => gapsView(snapshot, filters))
