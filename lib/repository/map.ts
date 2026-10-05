import type { Dataset } from '@/lib/domain/types'

/** Rows exactly as PostgreSQL / PostgREST return them (snake_case). */
export type Row = Record<string, unknown>

export interface RawTables {
  dataset_meta: Row[]
  states: Row[]
  districts: Row[]
  sectors: Row[]
  trades: Row[]
  training_centres: Row[]
  training_capacity: Row[]
  labour_demand: Row[]
  data_sources: Row[]
}

export const STORED_TABLES = [
  'dataset_meta', 'states', 'districts', 'sectors', 'trades', 'training_centres', 'training_capacity', 'labour_demand', 'data_sources',
] as const

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown): number => Number(v)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
/** Date, 'YYYY-MM-DD' or 'YYYY-MM' → that string form. */
const isoDate = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : text(v).slice(0, 10)
const period = (v: unknown): string => isoDate(v).slice(0, 7)

/** Database rows → domain dataset. The only place column names are translated. */
export function tablesToDataset(t: RawTables): Dataset {
  const meta = t.dataset_meta[0]
  if (!meta) throw new Error('dataset_meta is empty: run the seed (pnpm db:setup) first.')
  return {
    meta: {
      label: text(meta.label),
      synthetic: Boolean(meta.synthetic),
      asOfPeriod: period(meta.as_of_period),
      updatedAt: isoDate(meta.updated_at),
      currentTrainingYear: num(meta.current_training_year),
    },
    states: t.states.map((r) => ({ id: text(r.id), name: text(r.name), nameHi: text(r.name_hi) || text(r.name), code: text(r.code) })),
    districts: t.districts.map((r) => ({ id: text(r.id), stateId: text(r.state_id), name: text(r.name), nameHi: text(r.name_hi) || text(r.name), code: text(r.code) })),
    sectors: t.sectors.map((r) => ({ id: text(r.id), name: text(r.name), nameHi: text(r.name_hi) || text(r.name), code: text(r.code) })),
    trades: t.trades.map((r) => ({ id: text(r.id), sectorId: text(r.sector_id), name: text(r.name), nameHi: text(r.name_hi) || text(r.name), ncoCode: text(r.nco_code), nsqfLevel: num(r.nsqf_level) })),
    trainingCentres: t.training_centres.map((r) => ({
      id: text(r.id), name: text(r.name), districtId: text(r.district_id), sectorId: text(r.sector_id),
      status: r.status === 'inactive' ? 'inactive' : 'active', capacity: num(r.capacity),
    })),
    trainingCapacity: t.training_capacity.map((r) => ({
      districtId: text(r.district_id), sectorId: text(r.sector_id), tradeId: text(r.trade_id), year: num(r.year),
      allocatedSeats: num(r.allocated_seats), enrolled: numOrNull(r.enrolled), completed: numOrNull(r.completed), placed: numOrNull(r.placed),
    })),
    labourDemand: t.labour_demand.map((r) => ({
      districtId: text(r.district_id), sectorId: text(r.sector_id), tradeId: text(r.trade_id), period: period(r.period),
      jobPostings: numOrNull(r.job_postings), hiringSignal: numOrNull(r.hiring_signal),
      employmentRegistrations: numOrNull(r.employment_registrations), industryDemandSignal: numOrNull(r.industry_demand_signal),
      source: text(r.source),
    })),
    dataSources: t.data_sources.map((r) => ({
      id: text(r.id), name: text(r.name), description: text(r.description),
      sourceType: text(r.source_type) as Dataset['dataSources'][number]['sourceType'],
      lastUpdated: r.last_updated ? isoDate(r.last_updated) : null,
      status: text(r.status) as Dataset['dataSources'][number]['status'],
      coverage: text(r.coverage), granularity: text(r.granularity), feeds: text(r.feeds),
      recordsIn: numOrNull(r.records_in), recordsMapped: numOrNull(r.records_mapped),
    })),
  }
}

/** Stable ordering so the same data always produces the same snapshot. */
export const TABLE_ORDER: Record<(typeof STORED_TABLES)[number], string> = {
  dataset_meta: 'id',
  states: 'id',
  districts: 'id',
  sectors: 'id',
  trades: 'id',
  training_centres: 'id',
  training_capacity: 'id',
  labour_demand: 'id',
  data_sources: 'id',
}
