'use client'

import type {
  alertsView, drilldownView, evidenceView, forecastsView, gapsView, metaView, methodologyView, recommendationsView, RunView, sourcesView, summaryView, tradeView,
} from '@/lib/server/views'
import type { HorizonKey, IngestionRun, StatusFilter } from '@/lib/domain/types'
import type { IngestReport } from '@/lib/ingest/ingest'

/**
 * Browser-side client for the SkillPulse API. Screens call these functions
 * and nothing else; every number they show comes from the server.
 */

export type MetaData = ReturnType<typeof metaView>
export type SummaryData = ReturnType<typeof summaryView>
export type DrilldownData = ReturnType<typeof drilldownView>
export type GapsData = ReturnType<typeof gapsView>
export type ForecastData = ReturnType<typeof forecastsView>
export type AlertsData = ReturnType<typeof alertsView>
export type RecommendationsData = ReturnType<typeof recommendationsView>
export type TradeData = NonNullable<ReturnType<typeof tradeView>>
export type MethodologyData = ReturnType<typeof methodologyView>
export type SourcesData = ReturnType<typeof sourcesView>
export type EvidenceData = NonNullable<ReturnType<typeof evidenceView>>
export interface IngestInfo {
  canLoad: boolean
  writable: boolean
  specs: { id: string; kind: 'demand' | 'training'; columns: string[] }[]
  runs: RunView[]
}
export interface IngestResult { written: boolean; report: IngestReport; run: IngestionRun | null; asOfPeriod?: string; derivedRefreshed?: boolean; replaces: number }

export interface QueryFilters {
  stateId?: string | null
  districtId?: string | null
  sectorId?: string | null
  tradeId?: string | null
  horizon?: HorizonKey
  status?: StatusFilter | null
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

function query(params: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

// Identical requests made close together share one response.
const inflight = new Map<string, { at: number; promise: Promise<unknown> }>()
const REUSE_MS = 15_000

async function get<T>(path: string, params: object = {}): Promise<T> {
  const url = `/api/${path}${query(params)}`
  const cached = inflight.get(url)
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.promise as Promise<T>
  const promise = fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(async (response) => {
    if (response.status === 401) {
      // A full page load on purpose: every cached response belongs to the previous session or role.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/login')
      throw new ApiError(401, 'Sign in to continue.')
    }
    const body = (await response.json().catch(() => null)) as { data?: T; error?: string } | null
    if (!response.ok || !body || body.data === undefined) throw new ApiError(response.status, body?.error ?? 'The data could not be loaded.')
    return body.data
  })
  inflight.set(url, { at: Date.now(), promise })
  promise.catch(() => inflight.delete(url))
  return promise
}

export const getMeta = () => get<MetaData>('meta')
export const getSummary = (f: QueryFilters) => get<SummaryData>('dashboard/summary', f)
export const getDrilldown = (f: QueryFilters) => get<DrilldownData>('drilldown', f)
export const getGaps = (f: QueryFilters) => get<GapsData>('gaps', f)
export const getForecasts = (f: QueryFilters) => get<ForecastData>('forecasts', f)
export const getAlerts = (f: QueryFilters) => get<AlertsData>('alerts', f)
export const getRecommendations = (f: QueryFilters) => get<RecommendationsData>('recommendations', f)
export const getTrade = (tradeId: string, f: QueryFilters) => get<TradeData>(`trade/${encodeURIComponent(tradeId)}`, { ...f, tradeId: null, sectorId: null })
export const getMethodology = () => get<MethodologyData>('methodology')
export const getSources = () => get<SourcesData>('sources')
export const getEvidence = (districtId: string, tradeId: string) => get<EvidenceData>('evidence', { districtId, tradeId })
export const getIngest = () => get<IngestInfo>('ingest')

/** Send one source file to be checked (dry run) or loaded. */
export async function postIngest(input: { source: string; file: File; mode: 'merge' | 'replace'; synthetic: boolean; countLoose: boolean; monthFirst: boolean; dryRun: boolean }): Promise<IngestResult> {
  const form = new FormData()
  form.set('source', input.source)
  form.set('file', input.file)
  form.set('mode', input.mode)
  form.set('synthetic', String(input.synthetic))
  form.set('countLoose', String(input.countLoose))
  form.set('monthFirst', String(input.monthFirst))
  form.set('dryRun', String(input.dryRun))
  const response = await fetch('/api/ingest', { method: 'POST', body: form, credentials: 'same-origin' })
  const body = (await response.json().catch(() => null)) as { data?: IngestResult; error?: string } | null
  if (!response.ok || !body?.data) throw new ApiError(response.status, body?.error ?? 'The file could not be loaded.')
  // Everything on screen was computed from the old rows.
  if (body.data.written) inflight.clear()
  return body.data
}

export const exportUrl = (dataset: string, f: QueryFilters) => `/api/export${query({ dataset, format: 'csv', ...f })}`

/** Asks the server to sign this browser in as the evaluator account. True when a session was opened. */
export async function signInDemo(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/demo', { method: 'POST', credentials: 'same-origin' })
    return response.ok
  } catch {
    return false
  }
}

export async function setDemoRole(role: string): Promise<void> {
  await fetch('/api/demo-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
  inflight.clear()
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/signout', { method: 'POST' })
  inflight.clear()
}
