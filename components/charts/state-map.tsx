'use client'

import type { DrilldownData } from '@/lib/client/api'
import { cx, signed, signedPct } from '@/lib/format'
import { useI18n } from '@/lib/i18n/context'
import { useMeta } from '@/components/layout/app-shell'

/** Schematic positions of the pilot states, in % of the map area. Not a projection. */
const POSITION: Record<string, { x: number; y: number }> = {
  TG: { x: 66.5, y: 50.8 },
  KA: { x: 50.6, y: 60.8 },
  MH: { x: 44.3, y: 44.8 },
}

const LEVEL: Record<string, 'shortage' | 'balanced' | 'oversupply' | 'none'> = {
  severe_shortage: 'shortage', shortage: 'shortage', balanced: 'balanced', oversupply: 'oversupply', severe_oversupply: 'oversupply', insufficient_data: 'none',
}

interface StateMapProps {
  states: DrilldownData['states']
  selectedId: string | null
  /** States the session may open; others are shown but cannot be selected. */
  selectable: string[]
  onSelect: (stateId: string | null) => void
}

/** Schematic pilot map: one node per state, coloured by its gap status. */
export function StateMap({ states, selectedId, selectable, onSelect }: StateMapProps) {
  const { t } = useI18n()
  const { names } = useMeta()
  return (
    <div className="map-plot">
      <span className="map-caption">{t('explorer.map.caption')}</span>
      {states.map((s, index) => {
        const selected = selectedId === s.stateId
        const at = POSITION[s.stateId] ?? { x: 20 + index * 15, y: 30 }
        const hasData = s.cells > 0
        return (
          <button
            key={s.stateId}
            type="button"
            className={cx('map-node', selectedId !== null && !selected && 'is-dimmed')}
            data-level={hasData ? LEVEL[s.status] : 'none'}
            style={{ '--x': at.x, '--y': at.y } as React.CSSProperties}
            aria-pressed={selected}
            disabled={!selectable.includes(s.stateId)}
            aria-label={`${names.state(s.stateId)}: ${hasData ? t(`status.${s.status}`) : t('common.insufficient')}${s.gapPercentage !== null ? `, ${signedPct(s.gapPercentage)}` : ''}`}
            onClick={() => onSelect(selected ? null : s.stateId)}
          >
            <span className="map-node-label">
              {names.state(s.stateId)}
              {s.gapPercentage !== null && <span className="map-node-sub">{t(`status.${s.status}`)} · {signedPct(s.gapPercentage)}</span>}
            </span>
            <span className="bubble-tip chart-tooltip">
              <span className="chart-tooltip-title" style={{ display: 'block' }}>{names.state(s.stateId)}</span>
              <span className="chart-tooltip-row"><span>{t('explorer.col.status')}</span><strong>{hasData ? t(`status.${s.status}`) : t('common.insufficient')}</strong></span>
              {s.gap !== null && <span className="chart-tooltip-row"><span>{t('explorer.col.gap')}</span><strong>{signed(s.gap)}</strong></span>}
              {s.gapPercentage !== null && <span className="chart-tooltip-row"><span>{t('explorer.col.gapPct')}</span><strong>{signedPct(s.gapPercentage)}</strong></span>}
              <span className="chart-tooltip-row"><span>{t('common.pairs', { count: s.cells })}</span><strong /></span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
