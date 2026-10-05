import { z } from 'zod'
import { EXPORT_DATASETS, exportRows, toCsv } from '@/lib/server/export'
import { ValidationError } from '@/lib/server/filters'
import { api, provenance } from '@/lib/server/http'

const query = z.object({ dataset: z.enum(EXPORT_DATASETS).default('gaps'), format: z.enum(['csv', 'json']).default('csv') })

/** GET /api/export?dataset=gaps|forecasts|priority|alerts|recommendations|demand|supply&format=csv|json + filters */
export const GET = api(
  ({ snapshot, filters, url }) => {
    const parsed = query.safeParse({ dataset: url.searchParams.get('dataset') ?? undefined, format: url.searchParams.get('format') ?? undefined })
    if (!parsed.success) throw new ValidationError(`dataset must be one of ${EXPORT_DATASETS.join(', ')}; format must be csv or json`)
    const { dataset, format } = parsed.data
    const rows = exportRows(snapshot, dataset, filters)
    if (format === 'json') return { dataset, rows }
    const name = `skillpulse-${dataset}-${snapshot.meta.asOfPeriod}.csv`
    return new Response(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
        'X-Data-Label': provenance(snapshot).dataLabel,
      },
    })
  },
  { permission: 'export' },
)
