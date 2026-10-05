import type { IndexWeight, MethodologyStep } from '@/lib/types'

/**
 * Prototype methodology — configurable weights and thresholds.
 * These explain the approach visually; no scoring engine runs in the frontend.
 */

export const pipelineSteps: MethodologyStep[] = [
  { id: 'data', label: 'Data', description: 'Collect demand signals and training supply records from the source catalogue.' },
  { id: 'normalize', label: 'Normalize', description: 'Map every record to a common skill, location and time grain, then scale it to 0–100.' },
  { id: 'measure', label: 'Measure', description: 'Combine the weighted components into a Demand Index and a Supply Index, then subtract to get the Gap Index.' },
  { id: 'forecast', label: 'Forecast', description: 'Project demand and supply 3, 6 and 12 months ahead with a confidence level.' },
  { id: 'prioritize', label: 'Prioritize', description: 'Rank mismatches by gap size, direction of travel and the workforce affected.' },
  { id: 'recommend', label: 'Recommend', description: 'Turn each priority signal into a reviewable planning action with its evidence attached.' },
]

export const demandWeights: IndexWeight[] = [
  { label: 'Vacancy volume', weight: 40 },
  { label: 'Demand growth', weight: 25 },
  { label: 'Employer activity', weight: 20 },
  { label: 'Historical persistence', weight: 15 },
]

export const supplyWeights: IndexWeight[] = [
  { label: 'Training capacity', weight: 35 },
  { label: 'Completion', weight: 25 },
  { label: 'Certification', weight: 20 },
  { label: 'Workforce availability', weight: 20 },
]

export const gapFormula = {
  title: 'Gap Index = Demand Index − Supply Index',
  method: 'Demand − Supply index',
  note: 'Prototype methodology · weights and thresholds are configurable and should be validated against historical outcomes.',
}

/** Classification thresholds on the Gap Index (index points). */
export const thresholds = {
  /** |gap| below this is treated as balanced. */
  balanced: 5,
  /** Gap magnitude at or above this is medium priority. */
  medium: 10,
  /** Gap magnitude at or above this is high priority. */
  high: 18,
}
