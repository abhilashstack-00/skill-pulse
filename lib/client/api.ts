'use client'

import type {
  alertsView, drilldownView, forecastsView, gapsView, metaView, methodologyView, recommendationsView, sourcesView, summaryView, tradeView,
} from '@/lib/server/views'
import type { HorizonKey, StatusFilter } from '@/lib/domain/types'

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

export const exportUrl = (dataset: string, f: QueryFilters) => `/api/export${query({ dataset, format: 'csv', ...f })}`

export async function setDemoRole(role: string): Promise<void> {
  await fetch('/api/demo-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
  inflight.clear()
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/signout', { method: 'POST' })
  inflight.clear()
}
