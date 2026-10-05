import type { DemandMetric } from '@/lib/domain/types'
import type { DateOrder } from '@/lib/intelligence/normalization/normalize'

/**
 * What each source's file looks like. A source describes the same facts in its
 * own columns; this is the one place where those columns are named. Adding a
 * source means adding an entry here (and its aliases in the mapping tables),
 * not touching the engines or the screens.
 */
interface BaseSpec {
  /** Id in data_sources. */
  id: string
  /** File name in data/pilot/raw, without extension. */
  rawFile: string
  dateOrder: DateOrder
}

export interface DemandSourceSpec extends BaseSpec {
  kind: 'demand'
  /** Which demand signal this source feeds. */
  metric: DemandMetric
  /** Counts for the same pair and month are added; 0–100 scores are averaged. */
  combine: 'sum' | 'average'
  columns: { period: string; occupation: string; place: string; value: string; ncoCode?: string; sector?: string }
}

export interface TrainingSourceSpec extends BaseSpec {
  kind: 'training'
  columns: { year: string; occupation: string; place: string; seats: string; enrolled: string; completed: string; placed: string; sector?: string }
}

export type SourceSpec = DemandSourceSpec | TrainingSourceSpec

export const SOURCE_SPECS: SourceSpec[] = [
  {
    id: 'job-portals', rawFile: 'job_portal', kind: 'demand', metric: 'jobPostings', combine: 'sum', dateOrder: 'dmy',
    columns: { period: 'posting_date', occupation: 'job_title', place: 'city', sector: 'industry', value: 'openings' },
  },
  {
    id: 'employment-exchange', rawFile: 'employment_exchange', kind: 'demand', metric: 'employmentRegistrations', combine: 'sum', dateOrder: 'dmy',
    columns: { period: 'period', occupation: 'occupation', ncoCode: 'nco_code', place: 'district', value: 'vacancies' },
  },
  {
    id: 'industry-hiring', rawFile: 'industry_hiring', kind: 'demand', metric: 'hiringSignal', combine: 'average', dateOrder: 'dmy',
    columns: { period: 'month', occupation: 'role', place: 'location', sector: 'sector', value: 'hiring_intent_score' },
  },
  {
    id: 'industry-survey', rawFile: 'industry_survey', kind: 'demand', metric: 'industryDemandSignal', combine: 'average', dateOrder: 'dmy',
    columns: { period: 'survey_month', occupation: 'trade', place: 'district', value: 'outlook_score' },
  },
  {
    id: 'training-capacity', rawFile: 'training_capacity', kind: 'training', dateOrder: 'dmy',
    columns: { year: 'training_year', occupation: 'trade', place: 'district', sector: 'sector', seats: 'allocated_seats', enrolled: 'enrolled', completed: 'completed', placed: 'placed' },
  },
]

export const specFor = (sourceId: string): SourceSpec | null => SOURCE_SPECS.find((s) => s.id === sourceId) ?? null

/** Database column for each demand signal. */
export const METRIC_COLUMN: Record<DemandMetric, string> = {
  jobPostings: 'job_postings',
  hiringSignal: 'hiring_signal',
  employmentRegistrations: 'employment_registrations',
  industryDemandSignal: 'industry_demand_signal',
}
