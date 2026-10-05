/** Minimal RFC-4180 reader and writer: quoted fields, escaped quotes, quoted line breaks. */

export class CsvError extends Error {}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  /** True just after a closing quote: only a comma or a line end may follow. */
  let closed = false
  const body = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') { quoted = false; closed = true }
      else field += ch
      continue
    }
    if (ch === ',') { row.push(field); field = ''; closed = false }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++
      row.push(field)
      field = ''
      closed = false
      if (row.some((cell) => cell.length)) rows.push(row)
      row = []
    } else if (closed) {
      if (ch !== ' ' && ch !== '\t') throw new CsvError(`Text follows a closing quote near row ${rows.length + 1}. Quote the whole value, and write a quote inside it as two quotes.`)
    } else if (ch === '"' && field.trim() === '') {
      // A quote opens a quoted value only at the start of a field. Anywhere else it is an ordinary character: 6" pipe.
      quoted = true
      field = ''
    } else field += ch
  }
  // A quote that never closes would otherwise swallow the rest of the file into one cell.
  if (quoted) throw new CsvError(`A quoted value is never closed (it starts near row ${rows.length + 1}).`)
  row.push(field)
  if (row.some((cell) => cell.length)) rows.push(row)
  if (!rows.length) return []
  const header = rows[0].map((name) => name.trim().toLowerCase())
  const repeated = header.filter((name, i) => name && header.indexOf(name) !== i)
  if (repeated.length) throw new CsvError(`Column name used more than once: ${[...new Set(repeated)].join(', ')}.`)
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((name, i) => [name, (cells[i] ?? '').trim()])))
}

const quote = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function formatCsv(header: string[], rows: unknown[][]): string {
  return [header.join(','), ...rows.map((row) => row.map(quote).join(','))].join('\n') + '\n'
}

/**
 * A plain decimal number, optionally with thousands separators in the Western
 * (1,250,000) or Indian (12,50,000) pattern. Anything else is not a number:
 * "0x10", "1e12", "1,25" and "12 approx" all return null.
 */
export const numberOrNull = (text: string | undefined | null): number | null => {
  if (text === undefined || text === null) return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  const grouped = /^-?\d{1,3}(,\d{2,3})*,\d{3}(\.\d+)?$/.test(trimmed)
  const plain = /^-?\d+(\.\d+)?$/.test(trimmed)
  if (!grouped && !plain) return null
  const n = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
