'use client'

import type { StatePressure } from '@/lib/services/skillpulse'
import { pressureLabel } from '@/lib/services/derive'
import { cx, signed } from '@/lib/format'

interface StateMapProps {
  states: StatePressure[]
  selectedId: string | null
  onSelect: (stateId: string | null) => void
}

/** Schematic pilot map: one node per state, coloured by net shortage pressure. */
export function StateMap({ states, selectedId, onSelect }: StateMapProps) {
  return (
    <div className="map-plot">
      <span className="map-caption">India · Pilot view</span>
      {states.map(({ state, meanGap, level, skillCount }) => {
        const selected = selectedId === state.id
        return (
          <button
            key={state.id}
            type="button"
            className={cx('map-node', selectedId !== null && !selected && 'is-dimmed')}
            data-level={level}
            style={{ '--x': state.map.x, '--y': state.map.y } as React.CSSProperties}
            aria-pressed={selected}
            aria-label={`${state.name}: ${pressureLabel[level]}${meanGap !== null ? `, average gap ${signed(meanGap)} across ${skillCount} skills` : ''}`}
            onClick={() => onSelect(selected ? null : state.id)}
          >
            <span className="map-node-label">{state.name}</span>
            <span className="bubble-tip chart-tooltip">
              <span className="chart-tooltip-title" style={{ display: 'block' }}>{state.name}</span>
              <span className="chart-tooltip-row"><span>Pressure</span><strong>{pressureLabel[level]}</strong></span>
              {meanGap !== null && <span className="chart-tooltip-row"><span>Average gap</span><strong>{signed(meanGap)}</strong></span>}
              <span className="chart-tooltip-row"><span>Skills in view</span><strong>{skillCount}</strong></span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
