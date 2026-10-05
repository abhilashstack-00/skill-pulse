'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { translate, type Locale, type Translator } from './translate'

interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
}

const I18nContext = createContext<I18nValue | null>(null)
const STORAGE_KEY = 'skillpulse.locale'

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setState] = useState<Locale>('en')

  // The reader's last choice is remembered in this browser only.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved === 'hi' || saved === 'en') setState(saved)
    } catch {
      // Storage unavailable: stay with English.
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not remembered, but still applied for this visit.
    }
  }, [])

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
