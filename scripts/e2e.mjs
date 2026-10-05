/**
 * End-to-end check in a real browser against a running app in demo mode.
 *
 *   DEMO_MODE=on pnpm start            (or pnpm dev) in one terminal
 *   pnpm e2e                           in another      [BASE_URL=http://localhost:3000]
 *
 * Needs Playwright, which is not a dependency of the app:
 *   pnpm dlx playwright install chromium   and   pnpm add -D playwright
 * or point PLAYWRIGHT_PATH at an existing installation.
 *
 * Nothing here knows an expected number. Every figure checked on a screen is
 * compared with what the API returns for the same filters, and the arithmetic
 * printed on the Forecasts screen is added up from the text on the page.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright'))
} catch {
  console.error('Playwright is not installed. See the note at the top of scripts/e2e.mjs.')
  process.exit(2)
}

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT = process.env.E2E_OUT ?? '.e2e'
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const number = (text) => Number(String(text).replace(/[,\s]/g, '').replace('−', '-'))
const indian = (n) => new Intl.NumberFormat('en-IN').format(n)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } })
const page = await context.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(500) }
const main = async () => (await page.locator('main').innerText()).replace(/ /g, ' ')
const dialog = async () => (await page.locator('[role="dialog"]').innerText()).replace(/ /g, ' ')
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
const api = async (path) => (await (await context.request.get(BASE + path)).json()).data
const setRole = async (role) => { await page.goto(BASE + '/'); await settle(); await page.locator('.account-demo select').selectOption(role); await page.waitForLoadState('load'); await settle() }

const PAIR = 'districtId=warangal&tradeId=solar-technician'

// 1. Map and drill-down: National → State → District → Sector → Trade
await page.goto(BASE + '/market-explorer'); await settle()
const national = await api('/api/drilldown')
check('map draws one outline per pilot state', (await page.locator('.map-shape').count()) === national.states.length, `${national.states.length} states`)
check('no state is shown as balanced while it has shortage pairs', national.states.every((s) => s.headline !== 'balanced' || s.shortagePairs + s.oversupplyPairs === 0), national.states.map((s) => `${s.stateId}: ${s.headline}`).join(', '))
let body = await main()
check('state rows show seats short and seats spare from the API', national.children.every((c) => body.includes(indian(c.shortageTotal)) && body.includes(indian(Math.abs(c.surplusTotal)))))
await shot('01-explorer')
for (const step of ['Telangana', 'Warangal', 'Renewable Energy']) {
  await page.locator('.drill-table tbody tr', { hasText: step }).first().click()
  await settle()
}
check('breadcrumb follows the drill-down', /Telangana[\s\S]*Warangal[\s\S]*Renewable Energy/.test(await page.locator('.breadcrumb').innerText()))
await page.locator('.drill-table tbody tr', { hasText: 'Solar Technician' }).first().click()
await page.waitForURL('**/skill-intelligence'); await settle()

// 2. One pair: the page, the API and the evidence agree
const gaps = (await api(`/api/gaps?${PAIR}`)).rows[0]
const evidence = await api(`/api/evidence?${PAIR}`)
body = await main()
check('skill page shows the pair the drill-down led to', body.includes('Solar Technician') && body.includes('Warangal'))
check('gap on the page equals the API', body.includes(`+${indian(gaps.gap)}`), `gap ${gaps.gap}, ${gaps.gapPercentage}%, ${gaps.status}`)
check('pair is classified from its own gap %', (gaps.gapPercentage >= 30) === (gaps.status === 'severe_shortage'))
await shot('02-skill-pair')

await page.getByRole('button', { name: 'View Evidence' }).click(); await page.waitForTimeout(400)
for (const tab of ['Demand', 'Supply', 'Gap', 'Forecast', 'Data']) {
  await page.getByRole('tab', { name: tab, exact: true }).click(); await page.waitForTimeout(tab === 'Data' ? 900 : 250)
  await page.screenshot({ path: `${OUT}/03-drawer-${tab.toLowerCase()}.png` })
  const text = await dialog()
  if (tab === 'Demand') check('demand drawer lists the four weighted components', ['Job postings', 'Hiring signal', 'Employment registrations', 'Industry demand'].every((s) => text.includes(s)))
  if (tab === 'Supply') check('supply drawer shows the seats behind the gap', text.includes(indian(evidence.trainingRows.at(-1).allocatedSeats)))
  if (tab === 'Gap') check('gap drawer: demand − supply = gap, with the percentage to two places', text.includes(indian(gaps.demand)) && text.includes(indian(gaps.supply)) && text.includes(`+${indian(gaps.gap)}`) && text.includes(gaps.gapPercentage.toFixed(2)))
  if (tab === 'Forecast') {
    const f = evidence.forecast
    check('forecast drawer shows the model half-width, the calibration factor and the interval', text.includes(indian(Math.round(f.interval.modelHalfWidth))) && text.includes(f.interval.calibrationFactor.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) && text.includes(indian(f.lowerBound)) && text.includes(indian(f.upperBound)))
  }
  if (tab === 'Data') {
    const rows = await page.locator('[role="dialog"] table.data-rows').first().locator('tbody tr').count()
    check('data tab lists every stored monthly row', rows === evidence.demandRows.length, `${rows} rows`)
    check('data tab shades exactly the baseline months', (await page.locator('[role="dialog"] tr.is-baseline').count()) === evidence.windows.recentMonths)
    check('data tab names the file load behind the values', evidence.runs.every((r) => text.includes(r.fileName)), evidence.runs.map((r) => r.fileName).join(', '))
    const latest = evidence.demandRows.at(-1)
    check('latest stored row is on screen as stored', text.includes(String(latest.jobPostings)) && text.includes(String(latest.employmentRegistrations)))
  }
}
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
check('drawer closes on Escape', (await page.locator('[role="dialog"]').count()) === 0 || !(await page.locator('[role="dialog"]').first().isVisible()))

// 3. Filters persist; the Forecasts arithmetic adds up on the page
const sumsUp = async (label) => {
  const text = await page.locator('.build-lines').innerText()
  const line = text.split('\n')[0].replace(/ /g, ' ')
  const m = line.match(/Baseline ([\d,]+) · trend ([+−-][\d,]+) · recent growth ([+−-][\d,]+)(?: · months held at zero ([+−-][\d,]+))?(?: · rounding ([+−-][\d,]+))? = ([\d,]+)/)
  const parts = m ? m.slice(1, 6).filter(Boolean).map(number) : []
  check(`${label}: the breakdown printed on the page adds up to the total beside it`, Boolean(m) && parts.reduce((a, b) => a + b, 0) === number(m[6]), m ? `${parts.join(' + ')} = ${number(m[6])}` : line.slice(0, 120))
  return m ? number(m[6]) : null
}
await page.getByRole('link', { name: 'Forecasts' }).click(); await settle()
body = await main()
// The wording depends on where the pair stands today: "expected to exceed supply" if it is balanced now, "forecast to deepen" if it is already short.
const upcoming = evidence.warnings.find((w) => w.type === 'upcoming_shortage')
const phrase = upcoming?.reason.endsWith('.deepening') ? 'shortage is forecast to deepen' : 'expected to exceed supply'
check('forecast screen keeps the filters and shows the look-ahead warning in words that match today\'s status', Boolean(upcoming) && body.includes(`${phrase} within ${upcoming.params.lookaheadMonths} months`) && body.includes(indian(gaps.demand)), `${upcoming?.params.currentStatus} now → "${phrase}"`)
check('forecast total for the pair equals the API', (await sumsUp('one pair')) === gaps.demand)
await shot('04-forecast-pair')

await page.getByRole('link', { name: 'Action Center' }).click(); await settle()
body = await main()
check('recommendation is generated for the pair', body.includes('Increase Solar Technician training capacity in Warangal'))
// The card states the problem, the action, its expected effect and the confidence, all from the API's figures for this pair.
const rec = (await api(`/api/recommendations?districtId=warangal&tradeId=solar-technician`)).items[0]
check('action card: problem line carries the forecast demand, seats and confidence from the API', body.includes('Problem:') && body.includes(`Forecast demand ${indian(rec.row.demand)} against ${indian(rec.row.supply)} seats`) && body.includes(`(${rec.confidence.score} / 100)`), `${rec.row.demand} vs ${rec.row.supply}, confidence ${rec.confidence.score}`)
check('action card: expected effect is the computed number of seats, and adding them lands inside the balanced band', rec.effect?.kind === 'add_seats' && body.includes(`Expected effect: ${indian(rec.effect.seats)} more seats`) && Math.abs((rec.row.demand - (rec.row.supply + rec.effect.seats)) / (rec.row.supply + rec.effect.seats) * 100) < 15, `${rec.effect?.seats} seats → ${rec.effect?.resultingGapPct}%`)
check('action card: a low-confidence or interval-crossing action is marked tentative, as the API says', body.includes('Tentative:') === rec.tentative, `tentative ${rec.tentative}`)
await shot('05-action-pair')
await page.getByRole('link', { name: 'Gap Analysis' }).click(); await settle()
body = await main()
check('gap matrix shows the same figures', body.includes(indian(gaps.demand)) && body.includes(indian(gaps.supply)) && body.includes(`+${indian(gaps.gap)}`))
await page.getByRole('link', { name: 'Overview' }).click(); await settle()
body = await main()
check('overview totals equal the single filtered pair', body.includes(indian(gaps.demand)) && body.includes(indian(gaps.supply)))

// 4. Whole pilot: figures that used to disagree
await page.goto(BASE + '/'); await settle()
await page.evaluate(() => { try { sessionStorage.clear() } catch {} })
await page.goto(BASE + '/forecasts'); await settle()
if (/Solar Technician/.test(await page.locator('.filter-bar').last().innerText())) {
  // Filters are kept between screens: clear them through the interface.
  for (const label of ['Trade', 'Sector', 'District', 'State']) {
    const trigger = page.locator('.select-trigger', { hasText: new RegExp(label === 'Trade' ? 'Solar Technician' : label === 'Sector' ? 'Renewable Energy' : label === 'District' ? 'Warangal' : 'Telangana') }).first()
    if (await trigger.count()) { await trigger.click(); await page.locator('.select-option').first().click(); await settle() }
  }
}
const all = await api('/api/forecasts')
check('whole pilot: breakdown adds up and equals the API total', (await sumsUp('all pairs')) === all.totals.demand, `API ${all.totals.demand}`)
body = await main()
check('whole pilot: seats short and spare shown, not a "balanced" net', body.includes(`${indian(all.totals.shortageTotal)} / ${indian(Math.abs(all.totals.surplusTotal))}`) && all.totals.headline !== 'balanced', all.totals.headline)
const confidence = (await api('/api/gaps')).rows.map((r) => r.confidence?.score).filter((x) => x != null)
check('confidence differs between pairs', new Set(confidence).size > 10, `${new Set(confidence).size} distinct values over ${confidence.length} pairs`)
await shot('06-forecast-all')

await page.goto(BASE + '/'); await settle()
const summary = await api('/api/dashboard/summary')
await page.locator('.kpi-card.is-action', { hasText: 'Overall shortage' }).click(); await page.waitForTimeout(400)
let panel = await dialog()
check('overview: "Overall shortage" opens its definition, its parts and the pairs behind it',
  panel.includes(indian(summary.totals.shortageTotal)) && panel.includes(String(summary.totals.shortagePairs)) && summary.explain.shortage.slice(0, 3).every((r) => panel.includes(`+${indian(r.gap)}`)))
check('overview: seats short + seats spare + balanced net = net gap, as printed', summary.totals.shortageTotal + summary.totals.surplusTotal + summary.totals.balancedNet === summary.totals.gap)
await page.screenshot({ path: `${OUT}/07-overview-explain.png` })
await page.keyboard.press('Escape')

// 5. Export
const csv = await (await context.request.get(`${BASE}/api/export?dataset=gaps&format=csv&${PAIR}`)).text()
check('CSV export matches and carries the data label', csv.includes(`,${gaps.demand},${gaps.supply},${gaps.gap},`) && /synthetic/i.test(csv))
writeFileSync(`${OUT}/export-sample.csv`, csv)

// 6. Roles: what the server returns, not what the menu shows
await setRole('district_planner')
check('district planner: another district is refused', (await context.request.get(BASE + '/api/gaps?districtId=pune')).status() === 403)
const scoped = await api('/api/drilldown')
const own = await api('/api/dashboard/summary')
check('district planner: the map carries only their own district', scoped.states.length === 1 && scoped.states[0].demand === own.totals.demand, `${scoped.states.length} state(s), demand ${scoped.states[0]?.demand}`)
check('district planner: rows are all Warangal', (await api('/api/gaps')).rows.every((r) => r.districtId === 'warangal'))
await page.goto(BASE + '/market-explorer'); await settle(); await shot('08-district-planner-map')
await setRole('state_planner')
check('state planner: another state is refused', (await context.request.get(BASE + '/api/gaps?stateId=KA')).status() === 403)
await setRole('employer')
check('employer: no Action Center link', (await page.getByRole('link', { name: 'Action Center' }).count()) === 0)
check('employer: recommendations are refused', (await context.request.get(BASE + '/api/recommendations')).status() === 403)
check('employer: the trade route carries no recommendations either', (await api(`/api/trade/solar-technician?districtId=warangal`)).recommendations === null)
check('employer: recommendations export is refused', (await context.request.get(BASE + '/api/export?dataset=recommendations')).status() === 403)
check('employer: can export what they can see', (await context.request.get(BASE + '/api/export?dataset=gaps')).status() === 200)
check('employer: cannot load data', (await context.request.post(BASE + '/api/ingest', { multipart: { source: 'job-portals', dryRun: 'true', file: { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') } } })).status() === 403)

// 7. Loading data (administrator)
await setRole('admin')
await page.goto(BASE + '/data-sources'); await settle()
const fixture = 'posting_date,job_title,city,industry,openings\n2026-09-03,Software Engineer,Bangalore,IT,40\n15/09/2026,Sofware Developer,BLR,Software,5\n2026-08-21,Java Developer,Hyderabad,IT,25\n'
await page.locator('.ingest-form input[type="file"]').setInputFiles({ name: 'hand-written.csv', mimeType: 'text/csv', buffer: Buffer.from(fixture) })
await page.getByRole('button', { name: 'Check file' }).click(); await page.waitForTimeout(900)
const report = await page.locator('.ingest-form .ingest-report').innerText()
check('administrator can check a file: the misspelt title is held for review by default, and the unknown one is rejected', /3 rows read, 1 mapped, 2 rejected/.test(report) && /1 of the rejected rows matched only by a looser rule/.test(report) && report.includes('Java Developer') && report.includes('Sofware Developer') && /40 of 70/.test(report), report.split('\n')[0].slice(0, 90))
await page.getByLabel(/Count rows matched by a looser rule/).check()
await page.getByRole('button', { name: 'Check file' }).click(); await page.waitForTimeout(900)
const counted = await page.locator('.ingest-form .ingest-report').innerText()
check('administrator can choose to count loosely matched rows, and the report says which were', /3 rows read, 2 mapped, 1 rejected/.test(counted) && /1 of the mapped rows matched by a looser rule/.test(counted) && /45 of 70/.test(counted), counted.split('\n')[0].slice(0, 90))
await shot('09-admin-load-check')
await setRole('national_planner')

// 7b. What the product says about its own data and method
await page.goto(BASE + '/data-sources'); await settle()
body = await main()
const src = await api('/api/data-sources')
check('data sources: the synthetic-data statement, no live connection claimed, planned sources shown as planned', body.includes('This prototype uses synthetic pilot data') && body.includes('Sources with a live connection: 0') && (body.match(/Planned integration/g) ?? []).length >= 4 && !/\bConnected\b(?! live)/.test(body.replace(/Not connected/g, '')))
check('data sources: the data-quality line is the total of the recorded loads', body.includes(`${indian(src.quality.recordsProcessed)} records processed`) && body.includes(`${indian(src.quality.recordsRejected)} rejected`), `${src.quality.recordsProcessed} processed, ${src.quality.completenessPct}% complete`)
await page.goto(BASE + '/methodology'); await settle()
body = await main()
check('methodology: normalization, confidence and limitations are explained, and nothing is called an official rule', ['Normalization and data quality', 'What confidence means', 'Limitations and prototype assumptions', 'no machine-learning model', 'None is an official rule'].every((x) => body.toLowerCase().includes(x.toLowerCase())))
await page.goto(BASE + '/forecasts?stateId=TG&districtId=warangal'); await settle()
body = await main()
check('warnings say which forecast they rest on and its confidence', /Based on the \d+-month forecast · forecast confidence (High|Medium|Low) \(\d+ \/ 100\)/.test(body) || body.includes('Based on the current rate of demand'))

// 8. Hindi
await page.locator('.lang-switch button[lang="hi"]').click(); await page.waitForTimeout(500)
const untranslated = new Set()
for (const [name, route] of [['overview', '/'], ['explorer', '/market-explorer'], ['skill', '/skill-intelligence'], ['forecasts', '/forecasts'], ['methodology', '/methodology'], ['sources', '/data-sources']]) {
  await page.goto(BASE + route); await settle(); await shot(`10-hi-${name}`)
  for (const key of await page.evaluate(() => [...document.body.innerText.matchAll(/\b[a-z]+\.[a-zA-Z_.]+\b/g)].map((m) => m[0]).filter((k) => /^(common|nav|ev|skill|gap|action|forecast|overview|explorer|method|sources|warning|rec|status|role|app|comp|band|horizon)\./.test(k)))) untranslated.add(key)
}
check('Hindi interface renders Devanagari', /[ऀ-ॿ]{3,}/.test(await main()))
check('no untranslated message keys on any screen', untranslated.size === 0, [...untranslated].slice(0, 6).join(', '))
await page.goto(BASE + '/'); await settle(); await page.locator('.lang-switch button[lang="en"]').click()

// 9. Missing data
const missing = (await api('/api/gaps?districtId=mysuru&tradeId=phlebotomy-technician')).rows
check('a pair with too little history is reported as insufficient data, not a number', missing.length === 1 && missing[0].status === 'insufficient_data' && missing[0].gap === null && missing[0].demand === null)

// 10. Small screens
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const m = await mobile.newPage()
for (const [name, route] of [['overview', '/'], ['explorer', '/market-explorer'], ['skill', '/skill-intelligence'], ['gap', '/gap-analysis'], ['forecasts', '/forecasts'], ['actions', '/action-center'], ['sources', '/data-sources']]) {
  await m.goto(BASE + route); await m.waitForLoadState('networkidle'); await m.waitForTimeout(500)
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`phone width, ${name}: no sideways page scroll`, overflow <= 1, `${overflow}px`)
  await m.screenshot({ path: `${OUT}/11-mobile-${name}.png`, fullPage: true })
}

check('no browser console errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
await browser.close()
process.exit(failed.length ? 1 : 0)
