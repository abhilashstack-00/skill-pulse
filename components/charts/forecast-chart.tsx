'use client'

import { Area, CartesianGrid, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ForecastPoint } from '@/lib/types'
import { signed } from '@/lib/format'
import { axisTick, ChartTooltip, EndLabel, niceDomain, seriesColor } from './chart-kit'

/** Observed gap, forecast gap and its confidence band. */
export function ForecastChart({ data, skillName }: { data: ForecastPoint[]; skillName: string }) {
  const values = data.flatMap((p) => [p.actual, p.forecast, ...(p.band ?? [])]).filter((v): v is number => v !== null)
  const domain = niceDomain(values, 5)
  const last = data.length - 1
  const nowIndex = data.reduce((found, p, i) => (p.actual !== null ? i : found), 0)
  const hasForecast = last > nowIndex
  const end = data[last]
  const endValue = end.forecast ?? end.actual ?? 0

  return (
    <div className="chart-box" role="img" aria-label={`${skillName} gap index: ${signed(data[nowIndex].actual ?? 0)} in ${data[nowIndex].label}${hasForecast ? `, forecast ${signed(endValue)} by ${end.label}` : ''}.`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 44, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} tickMargin={10} interval="preserveStartEnd" minTickGap={20} />
          <YAxis domain={domain} tick={axisTick} tickLine={false} axisLine={false} width={44} tickCount={6} tickFormatter={(v: number) => signed(v)} />
          {domain[0] < 0 && domain[1] > 0 && <ReferenceLine y={0} stroke="#98a2b3" />}
          {hasForecast && (
            <ReferenceLine x={data[nowIndex].label} stroke="#98a2b3" strokeDasharray="3 3" label={{ value: 'Today', position: 'insideTopRight', fontSize: 11, fill: '#667085', dx: -4 }} />
          )}
          <Tooltip
            cursor={{ stroke: '#98a2b3', strokeWidth: 1 }}
            content={<ChartTooltip rows={[{ key: 'actual', label: 'Actual gap', color: seriesColor.gap, signed: true }, { key: 'forecast', label: 'Forecast gap', color: seriesColor.gap, signed: true }, { key: 'band', label: 'Confidence band' }]} />}
          />
          <Area type="monotone" dataKey="band" stroke="none" fill={seriesColor.gap} fillOpacity={0.14} isAnimationActive={false} activeDot={false} connectNulls={false} />
          <Line type="monotone" dataKey="actual" stroke={seriesColor.gap} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-secondary)' }} isAnimationActive={false}>
            {!hasForecast && <LabelList dataKey="actual" content={<EndLabel last={last} format={signed} />} />}
          </Line>
          <Line type="monotone" dataKey="forecast" stroke={seriesColor.gap} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-secondary)' }} isAnimationActive={false}>
            <LabelList dataKey="forecast" content={<EndLabel last={last} format={signed} />} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
