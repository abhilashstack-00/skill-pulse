'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { HorizonKey, StatusFilter } from '@/lib/domain/types'

export interface Filters {
  stateId: string | null
  districtId: string | null
  sectorId: string | null
  tradeId: string | null
  status: StatusFilter | null
  horizon: HorizonKey
}

const initialFilters: Filters = { stateId: null, districtId: null, sectorId: null, tradeId: null, status: null, horizon: '12M' }

interface FiltersContextValue {
  filters: Filters
  /** Merge a partial update into the shared selection. */
  setFilters: (patch: Partial<Filters>) => void
  /** Replace the selection with defaults plus an optional patch (the horizon is kept). */
  resetFilters: (patch?: Partial<Filters>) => void
  activeCount: number
}

const FiltersContext = createContext<FiltersContextValue | null>(null)

/**
 * One selection (state, district, sector, trade, gap type, horizon) shared by
 * every screen, so the dashboard, charts, tables, rankings and alerts always
 * describe the same slice of the same data.
 */
export function FiltersProvider({ children }: { children: React.ReactNode }) {
  const [filters, setState] = useState<Filters>(initialFilters)

  const setFilters = useCallback((patch: Partial<Filters>) => setState((current) => ({ ...current, ...patch })), [])
  const resetFilters = useCallback((patch: Partial<Filters> = {}) => setState((current) => ({ ...initialFilters, horizon: current.horizon, ...patch })), [])

  const value = useMemo(() => {
    const { stateId, districtId, sectorId, tradeId, status } = filters
    return { filters, setFilters, resetFilters, activeCount: [stateId, districtId, sectorId, tradeId, status].filter(Boolean).length }
  }, [filters, setFilters, resetFilters])

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
}

export function useFilters(): FiltersContextValue {
  const context = useContext(FiltersContext)
  if (!context) throw new Error('useFilters must be used inside FiltersProvider')
  return context
}

/** The filters as query parameters for the API. */
export function toQuery(f: Filters, include: (keyof Filters)[] = ['stateId', 'districtId', 'sectorId', 'tradeId', 'status', 'horizon']) {
  return Object.fromEntries(include.map((key) => [key, f[key]]))
}
