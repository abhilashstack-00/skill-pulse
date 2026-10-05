import { api } from '@/lib/server/http'
import { supplyView } from '@/lib/server/views'

export const GET = api(({ snapshot, filters }) => supplyView(snapshot, filters))
