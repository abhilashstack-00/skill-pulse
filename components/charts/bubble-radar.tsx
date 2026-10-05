'use client'

import { ArrowRight, ArrowUp } from 'lucide-react'
import type { SkillMetrics } from '@/lib/types'
import { gapTone } from '@/lib/services/derive'
import { cx, formatNumber, signed } from '@/lib/format'

/** Axis ranges of the radar, in % growth over 6 months. */
const X_DOMAIN: [number, number] = [-30, 40]
const Y_DOMAIN: [number, number] = [-12, 12]
/** Diameter in px of a bubble representing REFERENCE_GAP workers. */
const REFERENCE_DIAMETER = 70
const REFERENCE_GAP = 4900

const position = (value: number, [min, max]: [number, number]) => Math.min(94, Math.max(6, ((value - min) / (max - min)) * 100))

interface BubbleRadarProps {
  data: SkillMetrics[]
  onSelect: (metrics: SkillMetrics) => void
}

/** x = demand growth, y = supply growth, bubble area = workforce gap. */
export function BubbleRadar({ data, onSelect }: BubbleRadarProps) {
  return (
    <div className="radar-plot plot-surface">
      <span className="axis-label is-y">Supply Growth <ArrowUp aria-hidden="true" /></span>
      <span className="axis-label is-x">Demand Growth <ArrowRight aria-hidden="true" /></span>
      {data.map((m) => {
        const size = Math.max(22, Math.round(REFERENCE_DIAMETER * Math.sqrt(m.workforceGap / REFERENCE_GAP)))
        return (
          <button
            key={m.skill.id}
            type="button"
            className={cx('bubble', `tone-${gapTone(m.gapIndex)}`)}
            style={{ left: `${position(m.demandGrowth, X_DOMAIN)}%`, top: `${100 - position(m.supplyGrowth, Y_DOMAIN)}%`, '--size': `${size}px` } as React.CSSProperties}
            aria-label={`${m.skill.name}, ${m.state.name}: demand growth ${signed(m.demandGrowth, '%')}, supply growth ${signed(m.supplyGrowth, '%')}, workforce gap ${formatNumber(m.workforceGap)}. Open skill intelligence.`}
            onClick={() => onSelect(m)}
          >
            <span className="bubble-label">{m.skill.shortName}</span>
            <span className="bubble-tip chart-tooltip">
              <span className="chart-tooltip-title" style={{ display: 'block' }}>{m.skill.name} · {m.state.name}</span>
              <span className="chart-tooltip-row"><span>Demand growth</span><strong>{signed(m.demandGrowth, '%')}</strong></span>
              <span className="chart-tooltip-row"><span>Supply growth</span><strong>{signed(m.supplyGrowth, '%')}</strong></span>
              <span className="chart-tooltip-row"><span>Workforce gap</span><strong>{formatNumber(m.workforceGap)}</strong></span>
              <span className="chart-tooltip-row"><span>Gap index</span><strong>{signed(m.gapIndex)}</strong></span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
