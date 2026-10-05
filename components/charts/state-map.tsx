'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import india from '@svg-maps/india'
import type { DrilldownData } from '@/lib/client/api'
import { cx, formatNumber } from '@/lib/format'
import { useI18n } from '@/lib/i18n/context'
import { headlineTone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'

/**
 * State outlines from the @svg-maps/india package (CC BY 4.0), keyed by the
 * two-letter state code. Only the states that have pilot data are drawn; the
 * view is fitted to them, so this is a map of the pilot area, not of India.
 */
const OUTLINES = new Map((india as { locations: { id: string; path: string }[] }).locations.map((l) => [l.id.toUpperCase(), l.path]))

interface StateMapProps {
  states: DrilldownData['states']
  selectedId: string | null
  /** States the session may open; others are shown but cannot be selected. */
  selectable: string[]
  onSelect: (stateId: string | null) => void
}

interface Box { x: number; y: number; width: number; height: number }

/** Map of the pilot states, each filled by its headline: mostly shortage, mostly oversupply, mixed or balanced. */
export function StateMap({ states, selectedId, selectable, onSelect }: StateMapProps) {
  const { t } = useI18n()
  const { meta, names } = useMeta()
  const codeOf = new Map((meta?.options.states ?? []).map((s) => [s.id, s.code.toUpperCase()]))
  const drawn = states.map((s) => ({ ...s, outline: OUTLINES.get(codeOf.get(s.stateId) ?? s.stateId.toUpperCase()) ?? null })).filter((s) => s.outline)
  const missing = states.filter((s) => !drawn.some((d) => d.stateId === s.stateId))

  // Fit the view to the drawn states, then place each label on its shape as it
  // is actually rendered, again whenever the card changes size.
  const svgRef = useRef<SVGSVGElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Box | null>(null)
  const [centres, setCentres] = useState<Record<string, { x: number; y: number }>>({})
  const signature = drawn.map((s) => s.stateId).join(',')
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const boxes = [...svg.querySelectorAll<SVGPathElement>('path[data-state]')].map((path) => path.getBBox())
    if (!boxes.length) return
    const pad = 14
    const x0 = Math.min(...boxes.map((b) => b.x)) - pad
    const y0 = Math.min(...boxes.map((b) => b.y)) - pad
    const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad
    const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad
    setView({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
  }, [signature])
  useLayoutEffect(() => {
    const svg = svgRef.current
    const frame = frameRef.current
    if (!svg || !frame || !view) return
    const place = () => {
      const origin = frame.getBoundingClientRect()
      const next: Record<string, { x: number; y: number }> = {}
      svg.querySelectorAll<SVGPathElement>('path[data-state]').forEach((path) => {
        const r = path.getBoundingClientRect()
        next[path.dataset.state as string] = { x: r.left + r.width / 2 - origin.left, y: r.top + r.height / 2 - origin.top }
      })
      setCentres(next)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [view, signature])

  const box = view ?? { x: 0, y: 0, width: 612, height: 696 }
  const summary = (s: (typeof states)[number]) =>
    s.cells === 0
      ? t('common.insufficient')
      : `${t(`status.${s.headline}`)}: ${t('explorer.map.short', { value: formatNumber(s.shortageTotal) })}, ${t('explorer.map.spare', { value: formatNumber(Math.abs(s.surplusTotal)) })}`

  return (
    <div className="map-plot">
      <span className="map-caption">{t('explorer.map.caption')}</span>
      <div className="map-frame" ref={frameRef} style={{ visibility: view ? 'visible' : 'hidden' }}>
        <svg ref={svgRef} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} aria-hidden="true" focusable="false">
          {drawn.map((s) => (
            <path
              key={s.stateId}
              data-state={s.stateId}
              d={s.outline as string}
              className={cx('map-shape', `tone-${s.cells ? headlineTone[s.headline] : 'neutral'}`, selectedId === s.stateId && 'is-selected', selectedId !== null && selectedId !== s.stateId && 'is-dimmed', !selectable.includes(s.stateId) && 'is-locked')}
              onClick={() => selectable.includes(s.stateId) && onSelect(selectedId === s.stateId ? null : s.stateId)}
            />
          ))}
        </svg>
        {drawn.map((s) => {
          const centre = centres[s.stateId]
          if (!centre) return null
          const selected = selectedId === s.stateId
          return (
            <button
              key={s.stateId}
              type="button"
              className={cx('map-label', selectedId !== null && !selected && 'is-dimmed')}
              style={{ left: centre.x, top: centre.y }}
              aria-pressed={selected}
              disabled={!selectable.includes(s.stateId)}
              aria-label={`${names.state(s.stateId)}. ${summary(s)}`}
              onClick={() => onSelect(selected ? null : s.stateId)}
            >
              <span className="map-label-name">{names.state(s.stateId)}</span>
              {/* The two figures the colour stands for, one per line so neighbouring labels do not collide. The status word is in the tooltip and the table below. */}
              {s.cells > 0 && <span className="map-label-sub tone-danger tone-text">{t('explorer.map.short', { value: formatNumber(s.shortageTotal) })}</span>}
              {s.cells > 0 && <span className="map-label-sub tone-warning tone-text">{t('explorer.map.spare', { value: formatNumber(Math.abs(s.surplusTotal)) })}</span>}
              <span className="bubble-tip chart-tooltip">
                <span className="chart-tooltip-title" style={{ display: 'block' }}>{names.state(s.stateId)}</span>
                <span className="chart-tooltip-row"><span>{t('explorer.col.status')}</span><strong>{s.cells ? t(`status.${s.headline}`) : t('common.insufficient')}</strong></span>
                <span className="chart-tooltip-row"><span>{t('explorer.col.short')}</span><strong>{formatNumber(s.shortageTotal)} · {t('common.pairs', { count: s.shortagePairs })}</strong></span>
                <span className="chart-tooltip-row"><span>{t('explorer.col.spare')}</span><strong>{formatNumber(Math.abs(s.surplusTotal))} · {t('common.pairs', { count: s.oversupplyPairs })}</strong></span>
                <span className="chart-tooltip-row"><span>{t('explorer.map.highPriority')}</span><strong>{s.highPriorityPairs}</strong></span>
                <span className="chart-tooltip-row"><span>{t('common.pairs', { count: s.cells })}</span><strong /></span>
              </span>
            </button>
          )
        })}
      </div>
      {missing.length > 0 && <p className="map-missing">{t('explorer.map.noOutline', { names: missing.map((s) => names.state(s.stateId)).join(', ') })}</p>}
    </div>
  )
}
