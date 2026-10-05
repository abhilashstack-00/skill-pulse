'use client'

import { ArrowRight, ArrowUp } from 'lucide-react'
import type { CellRow } from '@/lib/server/views'
import { cx, formatNumber, signed, signedPct } from '@/lib/format'
import { useI18n } from '@/lib/i18n/context'
import { gapTone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'

/** Largest bubble diameter in px; areas scale with the size of the gap. */
const MAX_DIAMETER = 70
const MIN_DIAMETER = 22
const NOMINAL = { width: 1000, height: 245 }
const LABEL_SIDES = ['below', 'above', 'right', 'left'] as const
type LabelSide = (typeof LABEL_SIDES)[number]

const position = (value: number, min: number, max: number) => Math.min(92, Math.max(8, ((value - min) / (max - min || 1)) * 100))

/** x = demand trend, y = change in training capacity, bubble area = size of the gap. */
export function BubbleRadar({ data, onSelect }: { data: CellRow[]; onSelect: (row: CellRow) => void }) {
  const { t } = useI18n()
  const { names } = useMeta()
  const xs = data.map((d) => d.demandTrendPct as number)
  const ys = data.map((d) => d.capacityChangePct as number)
  const pad = (lo: number, hi: number) => [Math.min(lo, 0) - 6, Math.max(hi, 0) + 6] as const
  const [xMin, xMax] = pad(Math.min(...xs), Math.max(...xs))
  const [yMin, yMax] = pad(Math.min(...ys), Math.max(...ys))
  const largest = Math.max(...data.map((d) => Math.abs(d.gap as number)), 1)

  const placed = data.map((row) => ({
    row,
    x: position(row.demandTrendPct as number, xMin, xMax),
    y: 100 - position(row.capacityChangePct as number, yMin, yMax),
    size: Math.max(MIN_DIAMETER, Math.round(MAX_DIAMETER * Math.sqrt(Math.abs(row.gap as number) / largest))),
  }))

  // Label placement: try below, above, right, then left of the bubble and keep the first
  // spot that does not cover another bubble or an earlier label. Positions are estimated
  // on a nominal plot size, which is close enough to keep neighbouring labels apart.
  type Box = { l: number; t: number; r: number; b: number }
  const hit = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
  const bubbles = placed.map((p) => {
    const cx0 = (p.x / 100) * NOMINAL.width
    const cy0 = (p.y / 100) * NOMINAL.height
    return { key: p.row.key, cx: cx0, cy: cy0, r: p.size / 2, box: { l: cx0 - p.size / 2, t: cy0 - p.size / 2, r: cx0 + p.size / 2, b: cy0 + p.size / 2 } }
  })
  // The two axis captions already occupy the top-left and bottom-right corners.
  const labelBoxes: Box[] = [
    { l: 0, t: 0, r: 150, b: 34 },
    { l: NOMINAL.width - 210, t: NOMINAL.height - 32, r: NOMINAL.width, b: NOMINAL.height },
  ]
  const side = new Map<string, LabelSide>()
  for (const [index, p] of placed.entries()) {
    const me = bubbles[index]
    const width = Math.max(names.trade(p.row.tradeId).length, names.district(p.row.districtId).length) * 6.4
    const height = 28
    const candidates: Record<LabelSide, Box> = {
      below: { l: me.box.l - 10, t: me.box.b + 8, r: me.box.l - 10 + width, b: me.box.b + 8 + height },
      above: { l: me.box.l - 10, t: me.box.t - 6 - height, r: me.box.l - 10 + width, b: me.box.t - 6 },
      right: { l: me.box.r + 8, t: me.cy - height / 2, r: me.box.r + 8 + width, b: me.cy + height / 2 },
      left: { l: me.box.l - 8 - width, t: me.cy - height / 2, r: me.box.l - 8, b: me.cy + height / 2 },
    }
    const free = (box: Box) =>
      box.l >= 0 && box.r <= NOMINAL.width && box.t >= 0 && box.b <= NOMINAL.height &&
      !bubbles.some((other) => other.key !== me.key && hit(box, other.box)) &&
      !labelBoxes.some((other) => hit(box, other))
    const chosen = LABEL_SIDES.find((s) => free(candidates[s])) ?? 'below'
    side.set(p.row.key, chosen)
    labelBoxes.push(candidates[chosen])
  }

  return (
    <>
      <div className="radar-plot plot-surface">
      <span className="axis-label is-y">{t('overview.radar.y')} <ArrowUp aria-hidden="true" /></span>
      <span className="axis-label is-x">{t('overview.radar.x')} <ArrowRight aria-hidden="true" /></span>
      {placed.map(({ row, x, y, size }) => {
        const label = `${names.trade(row.tradeId)} · ${names.district(row.districtId)}`
        return (
          <button
            key={row.key}
            type="button"
            className={cx('bubble', `tone-${gapTone(row.status)}`)}
            style={{ left: `${x}%`, top: `${y}%`, '--size': `${size}px` } as React.CSSProperties}
            aria-label={`${label}: ${t('overview.radar.x')} ${signedPct(row.demandTrendPct as number)}, ${t('overview.radar.y')} ${signedPct(row.capacityChangePct as number)}, ${t('ev.gap')} ${signed(row.gap as number)}. ${t('common.openTrade')}`}
            onClick={() => onSelect(row)}
          >
            <span className={cx('bubble-label', `is-${side.get(row.key) ?? 'below'}`)}>
              {names.trade(row.tradeId)}
              <small>{names.district(row.districtId)}</small>
            </span>
            <span className="bubble-tip chart-tooltip">
              <span className="chart-tooltip-title" style={{ display: 'block' }}>{label}</span>
              <span className="chart-tooltip-row"><span>{t('overview.radar.x')}</span><strong>{signedPct(row.demandTrendPct as number)}</strong></span>
              <span className="chart-tooltip-row"><span>{t('overview.radar.y')}</span><strong>{signedPct(row.capacityChangePct as number)}</strong></span>
              <span className="chart-tooltip-row"><span>{t('ev.gap')}</span><strong>{signed(row.gap as number)}</strong></span>
              <span className="chart-tooltip-row"><span>{t('ev.gapPct')}</span><strong>{row.gapPercentage === null ? '—' : signedPct(row.gapPercentage)}</strong></span>
              <span className="chart-tooltip-row"><span>{t('skill.kpi.priority')}</span><strong>{row.priorityScore === null ? '—' : formatNumber(row.priorityScore, 1)}</strong></span>
            </span>
          </button>
        )
      })}
      </div>
      <ul className="radar-legend">
        {placed.map(({ row }) => (
          <li key={row.key}>
            <span className={cx('radar-legend-dot', `tone-${gapTone(row.status)}`)} aria-hidden="true" />
            <span>{names.trade(row.tradeId)} · {names.district(row.districtId)}</span>
            <strong className={`tone-${gapTone(row.status)}`}>{signed(row.gap as number)}</strong>
          </li>
        ))}
      </ul>
    </>
  )
}
