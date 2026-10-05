'use client'

import type { FilterOptions, Filters, GapStatus, SkillMetrics, TrendPeriod } from '@/lib/types'
import { useFilters } from '@/lib/filters-context'
import { Select } from './select'

export type FilterField = 'state' | 'district' | 'sector' | 'skill' | 'period' | 'gapType'

interface FilterBarProps {
  fields: FilterField[]
  options: FilterOptions | undefined
  /**
   * When set, the bar describes one focused skill: State, Sector and Skill
   * always show that skill's values and cannot be cleared.
   */
  focus?: SkillMetrics | null
  children?: React.ReactNode
}

/**
 * Shared filter row. Options cascade (a state narrows districts and skills)
 * and every change goes to the shared selection, so other screens follow.
 */
export function FilterBar({ fields, options, focus, children }: FilterBarProps) {
  const { filters, setFilters, resetFilters, activeCount } = useFilters()
  const focused = focus !== undefined
  const loading = !options

  const stateId = filters.stateId ?? focus?.state.id ?? null
  const sector = filters.sector ?? focus?.skill.sector ?? null
  const skillId = filters.skillId ?? focus?.skill.id ?? null

  const districts = (options?.districts ?? []).filter((d) => !stateId || d.stateId === stateId)
  const skills = (options?.skills ?? []).filter(
    (s) =>
      (!filters.stateId || s.stateId === filters.stateId) &&
      (!filters.districtId || s.districtId === filters.districtId) &&
      (!filters.sector || s.sector === filters.sector),
  )

  const pickSkill = (value: string | null) => {
    const skill = options?.skills.find((s) => s.value === value)
    if (focused && skill) {
      setFilters({ skillId: skill.value, stateId: skill.stateId, sector: skill.sector, districtId: null })
    } else {
      setFilters({ skillId: value })
    }
  }

  const controls: Record<FilterField, React.ReactNode> = {
    state: (
      <Select
        key="state" label="State" value={stateId} options={options?.states ?? []} disabled={loading}
        allLabel={focused ? undefined : 'All states'}
        onChange={(value) => setFilters({ stateId: value, districtId: null, skillId: null, ...(focused ? { sector: null } : {}) })}
      />
    ),
    district: (
      <Select
        key="district" label={focused ? 'All Districts' : 'District'} value={filters.districtId} options={districts} disabled={loading}
        allLabel={focused ? 'All Districts' : 'All districts'}
        onChange={(value) => {
          const district = options?.districts.find((d) => d.value === value)
          setFilters({ districtId: value, skillId: null, ...(district ? { stateId: district.stateId } : {}), ...(focused ? { sector: null } : {}) })
        }}
      />
    ),
    sector: (
      <Select
        key="sector" label="Sector" value={sector} options={options?.sectors ?? []} disabled={loading}
        allLabel={focused ? undefined : 'All sectors'}
        onChange={(value) => setFilters({ sector: value, skillId: null, ...(focused ? { stateId: null, districtId: null } : {}) })}
      />
    ),
    skill: (
      <Select
        key="skill" label="Skill" value={skillId} options={focused ? (options?.skills ?? []) : skills} disabled={loading}
        allLabel={focused ? undefined : 'All skills'}
        onChange={pickSkill}
      />
    ),
    period: (
      <Select
        key="period" label="Period" value={filters.period} options={options?.periods ?? []} disabled={loading}
        onChange={(value) => value && setFilters({ period: value as TrendPeriod })}
      />
    ),
    gapType: (
      <Select
        key="gapType" label="Gap Type" value={filters.gapType} options={options?.gapTypes ?? []} disabled={loading}
        allLabel="All gap types"
        onChange={(value) => setFilters({ gapType: value as GapStatus | null })}
      />
    ),
  }

  const clearable = !focused && fields.some((field) => field !== 'period' && isActive(filters, field))

  return (
    <div className="filter-bar" role="group" aria-label="Filters">
      {fields.map((field) => controls[field])}
      {children}
      {clearable && activeCount > 0 && (
        <button type="button" className="link-btn filter-reset" onClick={() => resetFilters({ period: filters.period })}>
          Reset
        </button>
      )}
    </div>
  )
}

function isActive(filters: Filters, field: FilterField): boolean {
  switch (field) {
    case 'state': return !!filters.stateId
    case 'district': return !!filters.districtId
    case 'sector': return !!filters.sector
    case 'skill': return !!filters.skillId
    case 'gapType': return !!filters.gapType
    default: return false
  }
}
