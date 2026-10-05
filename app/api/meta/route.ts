import { api } from '@/lib/server/http'
import { metaView } from '@/lib/server/views'

export const GET = api(({ snapshot, session, scope }) => metaView(snapshot, session, scope))
