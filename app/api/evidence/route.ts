import { ValidationError } from '@/lib/server/filters'
import { api, NotFoundError } from '@/lib/server/http'
import { evidenceView } from '@/lib/server/views'

/** GET /api/evidence?districtId=…&tradeId=… — the stored rows and every intermediate figure behind one pair. */
export const GET = api(({ snapshot, filters, session }) => {
  // The filters have already been checked against the session's scope.
  if (!filters.districtId || !filters.tradeId) throw new ValidationError('districtId and tradeId are both required.')
  const view = evidenceView(snapshot, filters.districtId, filters.tradeId, session)
  if (!view) throw new NotFoundError('There is no data for that district and trade.')
  return view
})
