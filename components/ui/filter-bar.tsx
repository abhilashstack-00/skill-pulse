'use client'

import type { HorizonKey, StatusFilter } from '@/lib/domain/types'
import { useFilters } from '@/lib/filters-context'
import { useI18n } from '@/lib/i18n/context'
import { useMeta } from '@/components/layout/app-shell'
import { Select } from './select'

export type FilterField = 'state' | 'district' | 'sector' | 'trade' | 'status' | 'horizon'

const STATUSES: StatusFilter[] = ['any_shortage', 'severe_shortage', 'shortage', 'balanced', 'any_oversupply', 'oversupply', 'severe_oversupply', 'insufficient_data']
const HORIZONS: HorizonKey[] = ['current', '3M', '6M', '12M']

interface FilterBarProps {
  fields: FilterField[]
  /**
   * Trade shown when none is chosen. When set, the Trade field always has a
   * value and cannot be cleared (used where a screen describes one trade).
   */
  focusTradeId?: string | null
  children?: React.ReactNode
}

/**
 * Shared filter row. Options cascade (a state narrows districts and trades),
 * a planner's scope locks the fields above it, and every change goes to the
 * shared selection so all screens follow.
 */
export function FilterBar({ fields, focusTradeId, children }: FilterBarProps) {
  const { filters, setFilters, resetFilters, activeCount } = useFilters()
  const { meta, names } = useMeta()
  const { t } = useI18n()
  const options = meta?.options
  const session = meta?.session
  const loading = !options
  const focused = focusTradeId !== undefined

  const stateId = session?.stateId ?? filters.stateId
  const districtId = session?.districtId ?? filters.districtId
  const tradeId = filters.tradeId ?? focusTradeId ?? null
  const sectorId = filters.sectorId ?? (focused && tradeId ? options?.trades.find((x) => x.id === tradeId)?.sectorId ?? null : null)

  const inGeography = (cell: { stateId: string; districtId: string }) => (!stateId || cell.stateId === stateId) && (!districtId || cell.districtId === districtId)
  const tradesHere = new Set((options?.cells ?? []).filter(inGeography).map((c) => c.tradeId))
  const exists = (trade: string | null, geo: { stateId?: string | null; districtId?: string | null }) =>
    !trade || (options?.cells ?? []).some((c) => c.tradeId === trade && (!geo.stateId || c.stateId === geo.stateId) && (!geo.districtId || c.districtId === geo.districtId))

  const controls: Record<FilterField, React.ReactNode> = {
    state: (
      <Select
        key="state" label={t('filter.state')} value={stateId} disabled={loading || Boolean(session?.stateId)}
        options={(options?.states ?? []).map((s) => ({ value: s.id, label: names.state(s.id) }))}
        allLabel={session?.stateId ? undefined : t('filter.allStates')}
        onChange={(value) => setFilters({ stateId: value, districtId: null, ...(exists(filters.tradeId, { stateId: value }) ? {} : { tradeId: null }) })}
      />
    ),
    district: (
      <Select
        key="district" label={t('filter.district')} value={districtId} disabled={loading || Boolean(session?.districtId)}
        options={(options?.districts ?? []).filter((d) => !stateId || d.stateId === stateId).map((d) => ({ value: d.id, label: names.district(d.id) }))}
        allLabel={session?.districtId ? undefined : t('filter.allDistricts')}
        onChange={(value) => {
          const district = options?.districts.find((d) => d.id === value)
          setFilters({
            districtId: value,
            ...(district ? { stateId: district.stateId } : {}),
            ...(exists(filters.tradeId, { districtId: value, stateId: district?.stateId ?? stateId }) ? {} : { tradeId: null }),
          })
        }}
      />
    ),
    sector: (
      <Select
        key="sector" label={t('filter.sector')} value={sectorId} disabled={loading}
        options={(options?.sectors ?? []).map((s) => ({ value: s.id, label: names.sector(s.id) }))}
        allLabel={t('filter.allSectors')}
        onChange={(value) => {
          const keepsTrade = filters.tradeId && (!value || options?.trades.find((x) => x.id === filters.tradeId)?.sectorId === value)
          setFilters({ sectorId: value, ...(keepsTrade ? {} : { tradeId: null }) })
        }}
      />
    ),
    trade: (
      <Select
        key="trade" label={t('filter.trade')} value={tradeId} disabled={loading}
        options={(options?.trades ?? [])
          .filter((x) => tradesHere.has(x.id) && (!filters.sectorId || x.sectorId === filters.sectorId))
          .map((x) => ({ value: x.id, label: names.trade(x.id) }))}
        allLabel={focused ? undefined : t('filter.allTrades')}
        onChange={(value) => setFilters({ tradeId: value })}
      />
    ),
    status: (
      <Select
        key="status" label={t('filter.gapType')} value={filters.status} disabled={loading}
        options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
        allLabel={t('filter.allGapTypes')}
        onChange={(value) => setFilters({ status: value as StatusFilter | null })}
      />
    ),
    horizon: (
      <Select
        key="horizon" label={t('filter.horizon')} value={filters.horizon} disabled={loading}
        options={HORIZONS.map((h) => ({ value: h, label: t(`horizon.${h}`) }))}
        onChange={(value) => value && setFilters({ horizon: value as HorizonKey })}
      />
    ),
  }

  const lockedCount = Number(Boolean(session?.stateId && filters.stateId)) + Number(Boolean(session?.districtId && filters.districtId))
  const clearable = activeCount - lockedCount > 0 && fields.some((field) => field !== 'horizon')

  return (
    <div className="filter-bar" role="group" aria-label={t('filter.label')}>
      {fields.map((field) => controls[field])}
      {children}
      {clearable && (
        <button type="button" className="link-btn filter-reset" onClick={() => resetFilters()}>
          {t('common.reset')}
        </button>
      )}
    </div>
  )
}
