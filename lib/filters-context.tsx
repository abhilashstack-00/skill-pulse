'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { Filters } from '@/lib/types'

const initialFilters: Filters = {
  stateId: null,
  districtId: null,
  sector: null,
  skillId: null,
  gapType: null,
  period: '12M',
}

interface FiltersContextValue {
  filters: Filters
  /** Merge a partial update into the shared selection. */
  setFilters: (patch: Partial<Filters>) => void
  /** Replace the selection with defaults plus an optional patch. */
  resetFilters: (patch?: Partial<Filters>) => void
  activeCount: number
}

const FiltersContext = createContext<FiltersContextValue | null>(null)

/**
 * The selection (state, district, sector, skill, gap type, period) is shared
 * across screens so a planner keeps their context while moving from the
 * overview to a skill, its forecast and the related action.
 */
export function FiltersProvider({ children }: { children: React.ReactNode }) {
  const [filters, setState] = useState<Filters>(initialFilters)

  const setFilters = useCallback((patch: Partial<Filters>) => setState((current) => ({ ...current, ...patch })), [])
  const resetFilters = useCallback((patch: Partial<Filters> = {}) => setState({ ...initialFilters, ...patch }), [])

  const value = useMemo(() => {
    const { stateId, districtId, sector, skillId, gapType } = filters
    const activeCount = [stateId, districtId, sector, skillId, gapType].filter(Boolean).length
    return { filters, setFilters, resetFilters, activeCount }
  }, [filters, setFilters, resetFilters])

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
}

export function useFilters(): FiltersContextValue {
  const context = useContext(FiltersContext)
  if (!context) throw new Error('useFilters must be used inside FiltersProvider')
  return context
}
