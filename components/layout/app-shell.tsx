'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { FiltersProvider } from '@/lib/filters-context'
import { useService } from '@/lib/hooks/use-service'
import { getDatasetInfo } from '@/lib/services/skillpulse'
import { cx } from '@/lib/format'
import { Brand, Sidebar } from './sidebar'

type DatasetInfo = Awaited<ReturnType<typeof getDatasetInfo>>
const DatasetContext = createContext<DatasetInfo | undefined>(undefined)

export function useDataset() {
  return useContext(DatasetContext)
}

/** Sidebar + content frame shared by every screen. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const dataset = useService(getDatasetInfo, [])

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <FiltersProvider>
      <DatasetContext.Provider value={dataset.data}>
        <div className="app-shell">
          <Sidebar open={open} onNavigate={() => setOpen(false)} dataset={dataset.data} unavailable={dataset.status === 'error'} />
          <div className={cx('scrim', open && 'is-open')} onClick={() => setOpen(false)} aria-hidden="true" />
          <div>
            <div className="mobile-bar">
              <button type="button" className="icon-btn" aria-label="Open navigation" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}>
                <Menu aria-hidden="true" />
              </button>
              <Brand />
            </div>
            <main className="main">{children}</main>
          </div>
        </div>
      </DatasetContext.Provider>
    </FiltersProvider>
  )
}
