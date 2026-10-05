/**
 * Stand-in for a network client. Every service function goes through
 * `request`, so swapping mock data for Supabase/API calls later only means
 * replacing the resolver bodies in skillpulse.ts — the UI keeps awaiting the
 * same promises.
 */
export const mockConfig = {
  /** Simulated latency in ms, so loading states are exercised. */
  latencyMs: 220,
  /** Set to true to make every request fail (to check error states). */
  failAll: false,
}

export class ServiceError extends Error {}

export function request<T>(resolve: () => T): Promise<T> {
  return new Promise((ok, fail) => {
    setTimeout(() => {
      if (mockConfig.failAll) {
        fail(new ServiceError('The pilot dataset could not be loaded.'))
        return
      }
      try {
        ok(resolve())
      } catch (error) {
        fail(error instanceof Error ? error : new ServiceError('Unexpected data error.'))
      }
    }, mockConfig.latencyMs)
  })
}
