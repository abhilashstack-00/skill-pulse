import { DEMAND_INDEX } from '@/lib/config/methodology'
import type { IndexResult, WeightedComponent } from '@/lib/domain/types'
import { clamp, round, scaleCount } from './math'

export interface DemandComponentsRaw {
  /** Openings posted on job portals (count, current average). */
  jobPostings: number | null
  /** Employer hiring-intent score, already 0–100. */
  hiringSignal: number | null
  /** Vacancies registered on employment exchanges (count, current average). */
  employmentRegistrations: number | null
  /** Industry demand outlook score, already 0–100. */
  industryDemandSignal: number | null
}

export interface DemandReferences {
  jobPostings: number
  employmentRegistrations: number
}

type Weights = Record<keyof DemandComponentsRaw, number>

/** Bring each demand component onto the 0–100 scale. Missing stays missing. */
export function normalizeDemandComponents(raw: DemandComponentsRaw, refs: DemandReferences): Record<keyof DemandComponentsRaw, number | null> {
  return {
    jobPostings: raw.jobPostings === null ? null : scaleCount(raw.jobPostings, refs.jobPostings),
    hiringSignal: raw.hiringSignal === null ? null : clamp(raw.hiringSignal, 0, 100),
    employmentRegistrations: raw.employmentRegistrations === null ? null : scaleCount(raw.employmentRegistrations, refs.employmentRegistrations),
    industryDemandSignal: raw.industryDemandSignal === null ? null : clamp(raw.industryDemandSignal, 0, 100),
  }
}

/**
 * Demand Index = Σ weight × normalised component.
 * Returns null (never a guess) when any component is missing.
 */
export function weightedIndex(
  normalized: Record<string, number | null>,
  weights: Record<string, number>,
  raw: Record<string, number | null> = normalized,
  references: Record<string, number | null> = {},
): IndexResult {
  const components: WeightedComponent[] = Object.keys(weights).map((key) => {
    const value = normalized[key] ?? null
    return {
      key,
      weight: weights[key],
      raw: raw[key] ?? null,
      reference: references[key] ?? null,
      normalized: value === null ? null : round(value, 1),
      contribution: value === null ? null : round(weights[key] * value, 2),
    }
  })
  const missing = components.filter((c) => c.normalized === null).map((c) => c.key)
  if (missing.length) return { value: null, components, missing }
  const value = Object.keys(weights).reduce((total, key) => total + weights[key] * (normalized[key] as number), 0)
  return { value: round(value, 1), components, missing }
}

export function computeDemandIndex(raw: DemandComponentsRaw, refs: DemandReferences, weights: Weights = DEMAND_INDEX.weights): IndexResult {
  const normalized = normalizeDemandComponents(raw, refs)
  return weightedIndex(normalized, weights, { ...raw }, { jobPostings: refs.jobPostings, employmentRegistrations: refs.employmentRegistrations })
}
