'use client'

import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TrendPoint } from '@/lib/types'
import { axisTick, ChartTooltip, EndLabel, niceDomain, seriesColor } from './chart-kit'

/** Demand and supply index over the last 12 months. */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const domain = niceDomain(data.flatMap((p) => [p.demand, p.supply]))
  const last = data.length - 1

  return (
    <div className="chart-box" role="img" aria-label={`Demand index ${data[last].demand} and supply index ${data[last].supply} in ${data[last].label}, shown monthly from ${data[0].label}.`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 40, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} tickMargin={10} interval="preserveStartEnd" minTickGap={28} />
          <YAxis domain={domain} tick={axisTick} tickLine={false} axisLine={false} width={44} tickCount={5} />
          <Tooltip
            cursor={{ stroke: '#98a2b3', strokeWidth: 1 }}
            content={<ChartTooltip rows={[{ key: 'demand', label: 'Demand', color: seriesColor.demand }, { key: 'supply', label: 'Supply', color: seriesColor.supply }, { key: 'gap', label: 'Gap', signed: true }]} />}
          />
          <Line type="monotone" dataKey="demand" name="Demand" stroke={seriesColor.demand} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-secondary)' }} isAnimationActive={false}>
            <LabelList dataKey="demand" content={<EndLabel last={last} />} />
          </Line>
          <Line type="monotone" dataKey="supply" name="Supply" stroke={seriesColor.supply} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-secondary)' }} isAnimationActive={false}>
            <LabelList dataKey="supply" content={<EndLabel last={last} />} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
