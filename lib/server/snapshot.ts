import { env } from '@/lib/config/env'
import type { Snapshot } from '@/lib/domain/types'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { getRepository } from '@/lib/repository'

declare global {
  var __skillpulseSnapshot: { loadedAt: number; promise: Promise<Snapshot> } | undefined
}

/**
 * The computed snapshot: stored rows read once, every engine run once, and the
 * result reused by all requests until it is older than SNAPSHOT_TTL_SECONDS.
 * Every screen, API response and export reads from this one object.
 */
export function getSnapshot(): Promise<Snapshot> {
  const cached = globalThis.__skillpulseSnapshot
  if (cached && Date.now() - cached.loadedAt < env.snapshotTtlSeconds * 1000) return cached.promise
  const promise = getRepository().loadDataset().then(buildSnapshot)
  globalThis.__skillpulseSnapshot = { loadedAt: Date.now(), promise }
  promise.catch(() => {
    if (globalThis.__skillpulseSnapshot?.promise === promise) globalThis.__skillpulseSnapshot = undefined
  })
  return promise
}

/** Drop the cached snapshot so the next request reads the data again (used after a data load). */
export function resetSnapshot(): void {
  globalThis.__skillpulseSnapshot = undefined
}

export function dataMode(): 'database' | 'bundled' {
  return getRepository().kind === 'local' ? 'bundled' : 'database'
}
