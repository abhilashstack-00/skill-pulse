import { z } from 'zod'
import { ValidationError } from '@/lib/server/filters'
import { api } from '@/lib/server/http'
import { priorityView } from '@/lib/server/views'

const groupBy = z.enum(['cell', 'trade', 'district'])

export const GET = api(({ snapshot, filters, url }) => {
  const parsed = groupBy.safeParse(url.searchParams.get('groupBy') ?? 'cell')
  if (!parsed.success) throw new ValidationError('groupBy must be cell, trade or district')
  return priorityView(snapshot, filters, parsed.data)
})
