import type { NextRequest } from 'next/server'
import { api, assertInScope, NotFoundError } from '@/lib/server/http'
import { districtView } from '@/lib/server/views'

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return api(async ({ snapshot, filters, scope }) => {
    const { id } = await context.params
    const district = snapshot.dataset.districts.find((d) => d.id === id)
    if (!district) throw new NotFoundError(`Unknown district: ${id}`)
    assertInScope(scope, { stateId: district.stateId, districtId: district.id })
    return districtView(snapshot, id, filters)
  })(request)
}
