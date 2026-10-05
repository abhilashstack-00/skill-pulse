import type { Locale } from '@/lib/i18n/translate'

const MONTHS: Record<Locale, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  hi: ['जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'],
}

/** '2026-09-28' → '28 Sep 2026' */
export function formatDate(iso: string, locale: Locale = 'en'): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[locale][m - 1]} ${y}`
}

/** '2026-09' → 'Sep 26' */
export function formatMonth(period: string, locale: Locale = 'en'): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[locale][m - 1]} ${String(y).slice(2)}`
}

/** '2026-09' → 'Sep 2026' */
export function formatMonthLong(period: string, locale: Locale = 'en'): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[locale][m - 1]} ${y}`
}

/** 1250 → '1,250' (Indian digit grouping). */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** 450 → '+450', −17 → '−17', 0 → '0'. Uses a real minus sign. */
export function signed(value: number, decimals = 0, suffix = ''): string {
  const f = 10 ** decimals
  const n = Math.round(value * f) / f
  const body = formatNumber(Math.abs(n), decimals) + suffix
  return n > 0 ? `+${body}` : n < 0 ? `−${body}` : body
}

export const signedPct = (value: number, decimals = 1): string => signed(value, decimals, '%')

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
