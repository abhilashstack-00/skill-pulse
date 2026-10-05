'use client'

import { Area, CartesianGrid, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMonth, formatNumber } from '@/lib/format'
import { useI18n } from '@/lib/i18n/context'
import { axisTick, ChartTooltip, EndLabel, niceDomain, seriesColor } from './chart-kit'

interface DemandSupplyChartProps {
  /** Observed monthly demand. */
  history: { period: string; volume: number }[]
  /** Forecast monthly demand with its interval (empty for the current view). */
  forecast: { period: string; value: number; lower: number; upper: number }[]
  /** Training capacity per month, drawn as a level line for comparison. */
  supplyPerMonth: number | null
  /** Months of history to show before the forecast. */
  historyMonths?: number
}

interface ChartRow {
  period: string
  label: string
  actual: number | null
  forecast: number | null
  band: [number, number] | null
  capacity: number | null
}

/** Monthly demand (observed, then forecast with its interval) against training capacity. */
export function DemandSupplyChart({ history, forecast, supplyPerMonth, historyMonths = 12 }: DemandSupplyChartProps) {
  const { t, locale } = useI18n()
  const past = history.slice(-historyMonths)
  const rows: ChartRow[] = past.map((p) => ({ period: p.period, label: formatMonth(p.period, locale), actual: p.volume, forecast: null, band: null, capacity: supplyPerMonth }))
  const now = rows[rows.length - 1]
  if (now && forecast.length) {
    // Join the forecast to the last observed month so the line is continuous.
    now.forecast = now.actual
    now.band = [now.actual as number, now.actual as number]
  }
  for (const f of forecast) rows.push({ period: f.period, label: formatMonth(f.period, locale), actual: null, forecast: f.value, band: [f.lower, f.upper], capacity: supplyPerMonth })
  if (!rows.length) return null

  const values = rows.flatMap((r) => [r.actual, r.forecast, r.capacity, ...(r.band ?? [])]).filter((v): v is number => v !== null)
  const domain = niceDomain(values)
  const last = rows.length - 1
  const end = rows[last]
  const summary =
    `${t('forecast.legend.actual')}: ${formatNumber(Math.round(now?.actual ?? 0))} (${now?.label}).` +
    (forecast.length ? ` ${t('forecast.legend.forecast')}: ${formatNumber(Math.round(end.forecast ?? 0))} (${end.label}).` : '') +
    (supplyPerMonth !== null ? ` ${t('forecast.legend.capacity')}: ${formatNumber(Math.round(supplyPerMonth))}.` : '')

  return (
    <div className="chart-box" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 48, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} tickMargin={10} interval="preserveStartEnd" minTickGap={24} />
          <YAxis domain={domain} tick={axisTick} tickLine={false} axisLine={false} width={48} tickCount={6} tickFormatter={(v: number) => formatNumber(v)} />
          {forecast.length > 0 && now && (
            <ReferenceLine x={now.label} stroke="#98a2b3" strokeDasharray="3 3" label={{ value: t('forecast.today'), position: 'insideTopRight', fontSize: 11, fill: '#667085', dx: -4 }} />
          )}
          <Tooltip
            cursor={{ stroke: '#98a2b3', strokeWidth: 1 }}
            content={
              <ChartTooltip
                rows={[
                  { key: 'actual', label: t('forecast.legend.actual'), color: seriesColor.demand },
                  { key: 'forecast', label: t('forecast.legend.forecast'), color: seriesColor.demand },
                  { key: 'band', label: t('forecast.legend.band') },
                  { key: 'capacity', label: t('forecast.legend.capacity'), color: seriesColor.supply },
                ]}
              />
            }
          />
          <Area type="monotone" dataKey="band" stroke="none" fill={seriesColor.demand} fillOpacity={0.14} isAnimationActive={false} activeDot={false} connectNulls={false} />
          {supplyPerMonth !== null && (
            <Line type="linear" dataKey="capacity" stroke={seriesColor.supply} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false}>
              <LabelList dataKey="capacity" content={<EndLabel last={last} />} />
            </Line>
          )}
          <Line type="monotone" dataKey="actual" stroke={seriesColor.demand} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-secondary)' }} isAnimationActive={false}>
            {!forecast.length && <LabelList dataKey="actual" content={<EndLabel last={last} />} />}
          </Line>
          <Line type="monotone" dataKey="forecast" stroke={seriesColor.demand} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-secondary)' }} isAnimationActive={false}>
            <LabelList dataKey="forecast" content={<EndLabel last={last} />} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
