import type { NextRequest } from 'next/server'
import { api, NotFoundError } from '@/lib/server/http'
import { tradeView } from '@/lib/server/views'

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return api(async ({ snapshot, filters }) => {
    const { id } = await context.params
    const view = tradeView(snapshot, id, filters)
    if (!view) throw new NotFoundError(`Unknown trade: ${id}`)
    return view
  })(request)
}
