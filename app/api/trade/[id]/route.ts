import type { NextRequest } from 'next/server'
import { api, NotFoundError } from '@/lib/server/http'
import { tradeView } from '@/lib/server/views'

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return api(async ({ snapshot, filters, session }) => {
    const { id } = await context.params
    // Recommendations and suggested actions are planner material: the same rule as /api/recommendations.
    const view = tradeView(snapshot, id, filters, session)
    if (!view) throw new NotFoundError(`Unknown trade: ${id}`)
    return view
  })(request)
}
