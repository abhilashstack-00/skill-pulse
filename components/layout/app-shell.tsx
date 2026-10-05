'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { getMeta, type MetaData } from '@/lib/client/api'
import { FiltersProvider } from '@/lib/filters-context'
import { cx } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { I18nProvider, useI18n } from '@/lib/i18n/context'
import { namesFrom, type Names } from '@/lib/i18n/render'
import { Brand, Sidebar } from './sidebar'

interface MetaContextValue {
  meta: MetaData | undefined
  failed: boolean
  names: Names
}

const emptyNames: Names = { state: (id) => id ?? '', district: (id) => id ?? '', sector: (id) => id ?? '', trade: (id) => id ?? '' }
const MetaContext = createContext<MetaContextValue>({ meta: undefined, failed: false, names: emptyNames })

/** Dataset information, the signed-in session, filter options and display names. */
export function useMeta() {
  return useContext(MetaContext)
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <I18nProvider>
      {pathname === '/login' ? children : <Frame>{children}</Frame>}
    </I18nProvider>
  )
}

/** Sidebar + content frame shared by every screen. */
function Frame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const { locale, t } = useI18n()
  const meta = useService(getMeta, [])

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const value = useMemo<MetaContextValue>(
    () => ({ meta: meta.data, failed: meta.status === 'error', names: meta.data ? namesFrom(meta.data.options, locale) : emptyNames }),
    [meta.data, meta.status, locale],
  )

  return (
    <FiltersProvider>
      <MetaContext.Provider value={value}>
        <div className="app-shell">
          <Sidebar open={open} onNavigate={() => setOpen(false)} />
          <div className={cx('scrim', open && 'is-open')} onClick={() => setOpen(false)} aria-hidden="true" />
          <div>
            <div className="mobile-bar">
              <button type="button" className="icon-btn" aria-label={t('nav.open')} aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen(true)}>
                <Menu aria-hidden="true" />
              </button>
              <Brand />
            </div>
            <main className="main">{children}</main>
          </div>
        </div>
      </MetaContext.Provider>
    </FiltersProvider>
  )
}
