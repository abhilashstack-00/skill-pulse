import { signed } from '@/lib/format'

/** Shared chart styling so every chart reads as one family. */

export const seriesColor = {
  demand: 'var(--series-demand)',
  supply: 'var(--series-supply)',
  gap: 'var(--primary)',
}

export const axisTick = { fontSize: 11, fill: '#667085' }

/** Round a value range out to multiples of `step` with a little headroom. */
export function niceDomain(values: number[], step = 10): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const low = Math.floor((min - 2) / step) * step
  const high = Math.ceil((max + 2) / step) * step
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
        const text = Array.isArray(value)
          ? `${signed(Number(value[0]))} to ${signed(Number(value[1]))}`
          : row.signed ? signed(value) : String(value)
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
  format?: (value: number) => string
}

/** Direct label on the final point of a line. */
export function EndLabel({ last, index, x, y, value, format }: EndLabelProps) {
  if (index !== last || value == null || x == null || y == null) return null
  const text = format ? format(Number(value)) : String(value)
  return (
    <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={11} fontWeight={600} fill="#142033">
      {text}
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
