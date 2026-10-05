import { readFileSync } from 'node:fs'
import type { Dataset } from '@/lib/domain/types'
import { buildSnapshot } from '@/lib/intelligence/engine'
import { aggregateCells } from '@/lib/intelligence/aggregate'

const dataset = JSON.parse(readFileSync('data/pilot/dataset.json', 'utf8')) as Dataset
const t0 = performance.now()
const snap = buildSnapshot(dataset)
console.log('cells', snap.cells.length, 'ms', Math.round(performance.now() - t0), 'refs', snap.references)
console.log('backtest', snap.backtest)
for (const h of ['current', '3M', '6M', '12M'] as const) {
  const counts: Record<string, number> = {}
  for (const c of snap.cells) counts[c.horizons[h].gap.status] = (counts[c.horizons[h].gap.status] ?? 0) + 1
  console.log(h, counts)
}
const warn: Record<string, number> = {}
for (const c of snap.cells) for (const w of c.warnings) warn[w.type] = (warn[w.type] ?? 0) + 1
console.log('warnings', warn)
const bands: Record<string, number> = {}
for (const c of snap.cells) bands[String(c.priority.band)] = (bands[String(c.priority.band)] ?? 0) + 1
console.log('priority bands', bands)
const acts: Record<string, number> = {}
for (const c of snap.cells) acts[c.recommendation.action + (c.recommendation.secondary ? '+q' : '')] = (acts[c.recommendation.action + (c.recommendation.secondary ? '+q' : '')] ?? 0) + 1
console.log('actions', acts)
const conf: Record<string, number> = {}
for (const c of snap.cells) conf[String(c.horizons['12M'].confidence?.label)] = (conf[String(c.horizons['12M'].confidence?.label)] ?? 0) + 1
console.log('confidence 12M', conf)
const show = (key: string) => {
  const c = snap.cells.find((x) => x.key === key)!
  console.log('\n==', key)
  console.log(' demand idx', c.demand.index.value, c.demand.index.components.map((x) => `${x.key}:${x.raw}->${x.normalized}`).join(' '), 'missing', c.demand.index.missing)
  console.log(' supply idx', c.supply.index.value, c.supply.index.components.map((x) => `${x.key}:${x.raw}->${x.normalized}`).join(' '))
  console.log(' runRate', c.demand.monthlyRunRate, 'trend%', c.demand.trendPct, 'months', c.demand.monthsObserved, 'seats', c.supply.seats, 'capChg', c.supply.capacityChangePct, 'util', c.supply.utilizationPct)
  for (const h of ['current', '3M', '6M', '12M'] as const) {
    const x = c.horizons[h]
    console.log(` ${h}: demand ${x.demand} [${x.demandLower}, ${x.demandUpper}] supply ${x.supply} gap ${x.gap.gap} ${x.gap.gapPercentage}% ${x.gap.status} conf ${x.confidence?.score} ${x.method}`)
  }
  console.log(' fc parts', c.demandForecasts['12M'].parts, c.demandForecasts['12M'].components)
  console.log(' priority', c.priority.score, c.priority.band, c.priority.components.map((x) => `${x.key}:${x.raw}->${x.value}`).join(' '), c.priority.missing)
  console.log(' warnings', c.warnings.map((w) => `${w.type}/${w.severity}`), 'rec', c.recommendation.action, c.recommendation.secondary)
}
for (const k of (process.argv.slice(2).length ? process.argv.slice(2) : ['warangal|solar-technician', 'hyderabad|data-entry-operator', 'nagpur|wind-turbine-technician', 'mysuru|phlebotomy-technician', 'warangal|digital-marketing-executive', 'rangareddy|logistics-coordinator'])) show(k)
const all = aggregateCells(snap.cells)
console.log('\nNATIONAL 12M', all.horizons['12M'].demand, all.horizons['12M'].supply, all.horizons['12M'].gap, 'idx', all.demandIndex.value, all.supplyIndex.value, 'trend', all.demandTrendPct, 'prio', all.priority.score)
const top = [...snap.cells].filter((c) => c.priority.score !== null).sort((a, b) => (b.priority.score as number) - (a.priority.score as number)).slice(0, 8)
console.log(top.map((c) => `${c.key} ${c.priority.score} ${c.horizons['12M'].gap.gapPercentage}%`).join('\n'))
