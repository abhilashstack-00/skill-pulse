'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ServiceState<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'error'; data: undefined; error: Error }
  | { status: 'ready'; data: T; error: undefined }

/**
 * Runs an async service call and tracks loading / error / ready.
 * While a refetch is in flight (for example after a filter change) the last
 * result stays on screen and `refreshing` is true, so the UI does not flash.
 */
export function useService<T>(fetcher: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<ServiceState<T>>({ status: 'loading', data: undefined, error: undefined })
  const [refreshing, setRefreshing] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const fetcherRef = useRef(fetcher)
  // Keep the latest fetcher without re-running the request effect for it. Declared first, so it runs first.
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    let cancelled = false
    // Starting the request is the external work this effect exists for; the flag marks that it has started.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRefreshing(true)
    fetcherRef.current().then(
      (data) => {
        if (cancelled) return
        setState({ status: 'ready', data, error: undefined })
        setRefreshing(false)
      },
      (error: unknown) => {
        if (cancelled) return
        setState({ status: 'error', data: undefined, error: error instanceof Error ? error : new Error('Something went wrong.') })
        setRefreshing(false)
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', data: undefined, error: undefined })
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, refreshing, retry }
}
