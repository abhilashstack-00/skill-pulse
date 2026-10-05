import { ALERTS, FORECAST, PRIORITY, RECENT_WINDOW_MONTHS } from '@/lib/config/methodology'
import { en, type MessageKey } from './messages/en'
import { hi } from './messages/hi'

export type Locale = 'en' | 'hi'
export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
]
export type { MessageKey }
export type Params = Record<string, string | number | null | undefined>

const catalogues: Record<Locale, Record<string, string>> = { en, hi }

/**
 * Lengths that come from the methodology configuration. Any message may use
 * them, so no text has "6 months" or "12 months" typed into it: change the
 * configuration and the wording follows.
 */
export const CONFIG_PARAMS: Params = {
  recentMonths: RECENT_WINDOW_MONTHS,
  lookaheadMonths: FORECAST.horizons[ALERTS.lookaheadHorizon],
  planningMonths: FORECAST.horizons[PRIORITY.planningHorizon],
  horizonMonths: Object.values(FORECAST.horizons).join(', '),
}

/** Look up a message and fill its {placeholders}. Falls back to English, then to the key. */
export function translate(locale: Locale, key: MessageKey | (string & {}), params: Params = {}): string {
  const template = catalogues[locale][key] ?? catalogues.en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = name in params ? params[name] : CONFIG_PARAMS[name]
    return value === null || value === undefined ? '—' : String(value)
  })
}

export type Translator = (key: MessageKey | (string & {}), params?: Params) => string
export const translator = (locale: Locale): Translator => (key, params) => translate(locale, key, params)
