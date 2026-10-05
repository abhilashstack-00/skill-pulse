const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-09-28' → '28 Sep 2026' */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** '2026-09' → 'Sep 26' */
export function formatMonth(isoMonth: string): string {
  const [y, m] = isoMonth.split('-').map(Number)
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`
}

/** 21 → '+21', -17 → '−17', 0 → '0' */
export function signed(value: number, suffix = ''): string {
  const n = Math.round(value * 10) / 10
  if (n > 0) return `+${n}${suffix}`
  if (n < 0) return `−${Math.abs(n)}${suffix}`
  return `0${suffix}`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-IN')
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
