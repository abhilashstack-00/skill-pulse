import { readFileSync, writeFileSync } from 'node:fs'

const quote = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function writeCsv(path: string, header: string[], rows: unknown[][]): void {
  writeFileSync(path, [header.join(','), ...rows.map((row) => row.map(quote).join(','))].join('\n') + '\n')
}

/** Minimal RFC-4180 reader: quoted fields, escaped quotes, no multi-line fields. */
export function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.length)
  const parse = (line: string): string[] => {
    const out: string[] = []
    let field = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++ }
        else if (ch === '"') quoted = false
        else field += ch
      } else if (ch === '"') quoted = true
      else if (ch === ',') { out.push(field); field = '' }
      else field += ch
    }
    out.push(field)
    return out
  }
  const header = parse(lines[0])
  return lines.slice(1).map((line) => {
    const cells = parse(line)
    return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))
  })
}

export const numberOrNull = (text: string | undefined): number | null => {
  if (text === undefined || text.trim() === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}
