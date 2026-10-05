import { formatNumber, signed } from '@/lib/format'

/** Shared chart styling so every chart reads as one family. */

export const seriesColor = {
  demand: 'var(--series-demand)',
  supply: 'var(--series-supply)',
}

export const axisTick = { fontSize: 11, fill: '#667085' }

/** Round a value range out to a tidy axis with a little headroom. */
export function niceDomain(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, max * 0.1, 1)
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((s) => span / s <= 5) ?? 20000
  const low = Math.max(0, Math.floor((min - span * 0.08) / step) * step)
  const high = Math.ceil((max + span * 0.08) / step) * step
  return [low, high === low ? low + step : high]
}

interface TooltipRow {
  key: string
  label: string
  color?: string
  signed?: boolean
}

interface ChartTooltipProps {
  rows: TooltipRow[]
  active?: boolean
  label?: string | number
  payload?: readonly { payload?: Record<string, unknown> }[]
}

export function ChartTooltip({ rows, active, label, payload }: ChartTooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{label}</div>
      {rows.map((row) => {
        const raw = point[row.key]
        const value = Array.isArray(raw) ? raw : typeof raw === 'number' ? raw : null
        if (value === null) return null
        const one = (n: number) => (row.signed ? signed(n) : formatNumber(Math.round(n)))
        const text = Array.isArray(value) ? `${one(Number(value[0]))} – ${one(Number(value[1]))}` : one(value)
        return (
          <div className="chart-tooltip-row" key={row.key}>
            <span className="legend-item">
              {row.color && <span className="legend-key" style={{ '--key': row.color } as React.CSSProperties} />}
              {row.label}
            </span>
            <strong>{text}</strong>
          </div>
        )
      })}
    </div>
  )
}

interface EndLabelProps {
  last: number
  index?: number
  x?: number | string
  y?: number | string
  value?: number | string | null
}

/** Direct label on the final point of a line. */
export function EndLabel({ last, index, x, y, value }: EndLabelProps) {
  if (index !== last || value == null || x == null || y == null) return null
  return (
    <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={11} fontWeight={600} fill="#142033">
      {formatNumber(Math.round(Number(value)))}
    </text>
  )
}

export function Legend({ items, className }: { items: { label: string; color: string; kind?: 'line' | 'dashed' | 'band' | 'dot' }[]; className?: string }) {
  return (
    <div className={['legend', className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <span className="legend-item" key={item.label}>
          <span
            className={['legend-key', item.kind && item.kind !== 'line' ? `is-${item.kind}` : ''].join(' ')}
            style={{ '--key': item.color } as React.CSSProperties}
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}
