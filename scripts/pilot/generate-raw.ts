/**
 * Generates the SYNTHETIC raw extracts for the pilot (data/pilot/raw/*.csv).
 *
 * The files imitate what different sources would hand over: each uses its own
 * job titles, place names and date format, so the normalisation layer has real
 * work to do. Every value is produced by fixed formulas and a fixed hash, so
 * running this script twice gives byte-identical files. Nothing here is, or
 * should be presented as, an official statistic.
 *
 * Run: pnpm data:generate
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { forecastDemandSeries } from '@/lib/intelligence/forecast'
import { addMonths } from '@/lib/intelligence/math'
import { DISTRICT_ALIASES, SECTOR_ALIASES, TRADE_ALIASES } from '@/lib/intelligence/normalization/mappings'
import { writeCsv } from '../lib/csv'
import { districts, meta, sectors, states, trades } from './reference'

const OUT = join(process.cwd(), 'data/pilot/raw')
const MONTHS = 24
const AS_OF = meta.asOfPeriod
const YEARS = [2023, 2024, 2025, 2026]
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Fixed hash of a string → number in [-1, 1]. Replaces any use of randomness. */
function unit(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) / 4294967295) * 2 - 1
}

interface Profile {
  /** Openings per year in a district of scale 1. */
  annual: number
  /** Demand growth, % per year. */
  growth: number
  /** Seats as a share of annual openings. */
  ratio: number
  /** Seat growth, % per year. */
  seatGrowth: number
  util: number
  completion: number
  placement: number
  /** Share of openings that appear on employment exchanges rather than portals. */
  exchange: number
}

const TRADE_PROFILE: Record<string, Profile> = {
  'software-developer': { annual: 9000, growth: 12, ratio: 0.72, seatGrowth: 4, util: 94, completion: 86, placement: 78, exchange: 0.12 },
  'data-entry-operator': { annual: 2400, growth: -12, ratio: 1.5, seatGrowth: 9, util: 71, completion: 82, placement: 41, exchange: 0.3 },
  'digital-marketing-executive': { annual: 1800, growth: 18, ratio: 0.8, seatGrowth: 3, util: 90, completion: 80, placement: 62, exchange: 0.15 },
  'healthcare-assistant': { annual: 3000, growth: 10, ratio: 0.86, seatGrowth: 4, util: 91, completion: 84, placement: 70, exchange: 0.3 },
  'phlebotomy-technician': { annual: 900, growth: 6, ratio: 1.0, seatGrowth: 5, util: 85, completion: 86, placement: 66, exchange: 0.28 },
  'cnc-operator': { annual: 1500, growth: 5, ratio: 0.97, seatGrowth: 3, util: 84, completion: 80, placement: 64, exchange: 0.35 },
  welder: { annual: 1300, growth: 2, ratio: 1.12, seatGrowth: 2, util: 78, completion: 76, placement: 58, exchange: 0.4 },
  'warehouse-associate': { annual: 3200, growth: 14, ratio: 0.9, seatGrowth: 5, util: 88, completion: 83, placement: 68, exchange: 0.35 },
  'logistics-coordinator': { annual: 1100, growth: 8, ratio: 1.0, seatGrowth: 5, util: 82, completion: 81, placement: 63, exchange: 0.3 },
  electrician: { annual: 2600, growth: 7, ratio: 1.02, seatGrowth: 4, util: 86, completion: 80, placement: 65, exchange: 0.4 },
  mason: { annual: 1700, growth: -3, ratio: 1.25, seatGrowth: 3, util: 66, completion: 70, placement: 48, exchange: 0.45 },
  'retail-sales-associate': { annual: 3600, growth: -6, ratio: 1.36, seatGrowth: 6, util: 74, completion: 79, placement: 46, exchange: 0.3 },
  'solar-technician': { annual: 1400, growth: 28, ratio: 0.78, seatGrowth: 3, util: 93, completion: 82, placement: 72, exchange: 0.35 },
  'wind-turbine-technician': { annual: 500, growth: 9, ratio: 0.9, seatGrowth: 4, util: 83, completion: 80, placement: 67, exchange: 0.3 },
}

const DISTRICT_SCALE: Record<string, number> = {
  hyderabad: 1.0, rangareddy: 0.55, warangal: 0.25, 'bengaluru-urban': 1.3, mysuru: 0.3, pune: 0.9, nagpur: 0.45,
}

/** How strong a sector is in a district, relative to the district's size. */
const AFFINITY: Record<string, Record<string, number>> = {
  'it-digital': { hyderabad: 1.1, rangareddy: 1.3, warangal: 0.35, 'bengaluru-urban': 1.5, mysuru: 0.6, pune: 1.2, nagpur: 0.5 },
  manufacturing: { hyderabad: 0.5, rangareddy: 1.1, warangal: 0.6, 'bengaluru-urban': 0.9, mysuru: 1.0, pune: 1.6, nagpur: 0.9 },
  logistics: { rangareddy: 1.3, nagpur: 1.5, pune: 1.1 },
  'renewable-energy': { warangal: 1.6, rangareddy: 1.2, mysuru: 1.2, nagpur: 1.1, hyderabad: 0.7 },
  retail: { hyderabad: 1.1, 'bengaluru-urban': 1.1 },
}

/** District–trade pairs with no activity in the pilot. */
const EXCLUDED = new Set([
  'hyderabad|wind-turbine-technician', 'rangareddy|wind-turbine-technician', 'warangal|wind-turbine-technician', 'hyderabad|cnc-operator',
])

/** Cells shaped by hand so the pilot shows specific situations. */
const OVERRIDES: Record<string, Partial<Profile> & { fixedSeats?: number; calibrate12M?: number }> = {
  // Demo scenario: fast-rising demand against flat capacity of 800 seats.
  // The level is calibrated so the 12-month forecast comes out at 1,250.
  'warangal|solar-technician': { growth: 62, seatGrowth: 0, util: 96, completion: 84, placement: 76, fixedSeats: 800, calibrate12M: 1250 },
  // Clear oversupply: falling demand, growing seats.
  'hyderabad|data-entry-operator': { growth: -15, ratio: 1.75, seatGrowth: 10, util: 68 },
}

/** Cells with deliberately incomplete data, to exercise the "insufficient data" paths. */
const ONLY_LAST_MONTHS: Record<string, number> = {
  'nagpur|wind-turbine-technician': 4, // new trade: baseline estimate only
  'mysuru|phlebotomy-technician': 2, // too little history to forecast
}
const NO_TRAINING = new Set(['warangal|digital-marketing-executive'])
const SINGLE_TRAINING_YEAR = new Set(['nagpur|wind-turbine-technician'])
const NO_SURVEY_LAST_MONTHS: Record<string, number> = { 'rangareddy|logistics-coordinator': 3 }

const title = (text: string) => text.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bIt\b/g, 'IT').replace(/\bItes\b/, 'ITES').replace(/\bCnc\b/, 'CNC').replace(/\bSeo\b/, 'SEO').replace(/\bPv\b/, 'PV').replace(/\bGda\b/, 'GDA').replace(/\bDeo\b/, 'DEO').replace(/\bVmc\b/, 'VMC').replace(/\bMig\b/, 'MIG').replace(/\bWtg\b/, 'WTG')
const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10)
const clampScore = (n: number) => Math.min(98, Math.max(5, Math.round(n * 10) / 10))

function profileFor(key: string, districtId: string, tradeId: string, sectorId: string): Profile & { annualNow: number } {
  const base = { ...TRADE_PROFILE[tradeId], ...OVERRIDES[key] }
  const jitter = OVERRIDES[key] ? 0 : 1
  const affinity = AFFINITY[sectorId]?.[districtId] ?? 1
  return {
    ...base,
    ratio: base.ratio * (1 + jitter * 0.25 * unit(`${key}:ratio`)),
    growth: base.growth + jitter * 7 * unit(`${key}:growth`),
    seatGrowth: base.seatGrowth + jitter * 3 * unit(`${key}:seats`),
    util: Math.min(99, base.util + jitter * 5 * unit(`${key}:util`)),
    annualNow: base.annual * DISTRICT_SCALE[districtId] * affinity,
  }
}

/** Monthly openings for the 24 months ending at AS_OF. */
function monthlyOpenings(key: string, annualNow: number, growthPct: number): number[] {
  const phase = unit(`${key}:phase`) * Math.PI
  return Array.from({ length: MONTHS }, (_, i) => {
    const offset = i - (MONTHS - 1)
    const period = addMonths(AS_OF, offset)
    const monthOfYear = Number(period.slice(5)) - 1
    const trend = (annualNow / 12) * (1 + growthPct / 100) ** (offset / 12)
    const season = 1 + 0.04 * Math.sin((2 * Math.PI * monthOfYear) / 12 + phase)
    // Small markets are noisier month to month than large ones.
    const noise = 1 + (0.04 + 0.5 / Math.sqrt(Math.max(4, trend))) * unit(`${key}:noise:${period}`)
    return Math.max(1, Math.round(trend * season * noise))
  })
}

/**
 * Find the demand level at which the engine's 12-month forecast equals the
 * target exactly. A fixed grid search, so the result is always the same.
 */
function calibrate(key: string, annualNow: number, growthPct: number, target: number): number[] {
  const predict = (level: number, growth: number) => {
    const series = monthlyOpenings(key, level, growth)
    const forecast = forecastDemandSeries(series.map((value, i) => ({ period: addMonths(AS_OF, i - (MONTHS - 1)), value })), AS_OF, 12)
    return { series, predicted: forecast.predictedDemand as number }
  }
  // Monthly values are whole numbers, so the forecast moves in small jumps.
  // Search nearby growth rates and levels in a fixed order until one lands exactly.
  for (let g = 0; g <= 120; g++) {
    const growth = growthPct + (g % 2 ? 1 : -1) * Math.ceil(g / 2) * 0.05
    let level = annualNow
    for (let step = 0; step < 30; step++) level *= target / predict(level, growth).predicted
    for (let step = 0; step <= 400; step++) {
      const attempt = predict(level * (1 + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 0.0001), growth)
      if (attempt.predicted === target) return attempt.series
    }
  }
  throw new Error(`Could not calibrate ${key} to ${target}`)
}

/** Split a whole number across shares so the parts add up exactly. */
function split(total: number, shares: number[]): number[] {
  const raw = shares.map((s) => total * s)
  const parts = raw.map(Math.floor)
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac)
  for (let k = 0; left > 0; k++, left--) parts[order[k % order.length].i] += 1
  return parts
}

function main() {
  mkdirSync(OUT, { recursive: true })
  const stateName = new Map(states.map((s) => [s.id, s.name]))
  const sectorName = new Map(sectors.map((s) => [s.id, s.name]))
  const portal: unknown[][] = []
  const exchange: unknown[][] = []
  const hiring: unknown[][] = []
  const survey: unknown[][] = []
  const training: unknown[][] = []

  for (const district of districts) {
    for (const trade of trades) {
      const key = `${district.id}|${trade.id}`
      if (EXCLUDED.has(key)) continue
      const p = profileFor(key, district.id, trade.id, trade.sectorId)
      const override = OVERRIDES[key]
      const openings = override?.calibrate12M
        ? calibrate(key, p.annualNow, p.growth, override.calibrate12M)
        : monthlyOpenings(key, p.annualNow, p.growth)
      const firstMonth = MONTHS - (ONLY_LAST_MONTHS[key] ?? MONTHS)
      const titles = TRADE_ALIASES[trade.id].slice(0, 3)
      const places = DISTRICT_ALIASES[district.id]
      const industries = SECTOR_ALIASES[trade.sectorId]

      for (let i = firstMonth; i < MONTHS; i++) {
        const period = addMonths(AS_OF, i - (MONTHS - 1))
        const [year, month] = period.split('-')
        const total = openings[i]
        const onExchange = Math.round(total * p.exchange)
        const onPortals = total - onExchange

        // Job portal: several titles for the same trade, informal city names, ISO dates.
        split(onPortals, [0.5, 0.3, 0.2].slice(0, titles.length)).forEach((count, t) => {
          if (!count) return
          const label = t === 1 && i % 2 === 0 ? `Senior ${title(titles[t])}` : title(titles[t])
          portal.push([`${period}-15`, label, title(places[(i + t) % places.length]), title(industries[(i + t) % industries.length]), count])
        })

        // Employment exchange: NCO-coded, official names, 'Sep-2026' dates.
        exchange.push([`${MONTH_LABEL[Number(month) - 1]}-${year}`, trade.ncoCode, trade.name, district.name, stateName.get(district.stateId), onExchange])

        // Industry hiring intent: 0–100 score, dd/mm/yyyy dates.
        const momentum = p.growth * 0.6 + (i - (MONTHS - 1)) * 0.15
        hiring.push([`01/${month}/${year}`, title(titles[0]), title(places[i % places.length]), sectorName.get(trade.sectorId), clampScore(52 + momentum + 4 * unit(`${key}:hire:${period}`))])

        // Industry outlook survey: 0–100 score by official trade and district names.
        if (i < MONTHS - (NO_SURVEY_LAST_MONTHS[key] ?? 0)) {
          survey.push([period, trade.name, district.name, clampScore(50 + p.growth * 0.55 + 5 * unit(`${key}:survey:${period}`))])
        }
      }

      // Training capacity and outcomes, one row per training year.
      if (NO_TRAINING.has(key)) continue
      const seatsNow = override?.fixedSeats ?? round10(p.annualNow * p.ratio)
      for (const yearStart of SINGLE_TRAINING_YEAR.has(key) ? [2026] : YEARS) {
        const seats = override?.fixedSeats ?? round10(seatsNow / (1 + p.seatGrowth / 100) ** (2026 - yearStart))
        const enrolled = Math.round((seats * Math.min(99, p.util + 2 * unit(`${key}:util:${yearStart}`))) / 100)
        const finished = yearStart < 2026
        const completed = finished ? Math.round((enrolled * (p.completion + 2 * unit(`${key}:comp:${yearStart}`))) / 100) : ''
        const placed = finished ? Math.round((Number(completed) * (p.placement + 3 * unit(`${key}:place:${yearStart}`))) / 100) : ''
        training.push([`${yearStart}-${String(yearStart + 1).slice(2)}`, district.name, trade.name, sectorName.get(trade.sectorId), seats, enrolled, completed, placed])
      }
    }
  }

  // A few records that cannot be mapped, so the ingest report has something to show.
  portal.push(['2026-09-15', 'Astrologer', 'Hyderabad', 'Services', 12])
  portal.push(['2026-09-15', 'Software Engineer', 'Chennai', 'IT', 240])
  portal.push(['2026-08-15', 'Drone Pilot', 'Pune', 'Aviation', 9])
  exchange.push(['Sep-2026', '9999', 'Occupation not classified', 'Pune', 'Maharashtra', 30])
  hiring.push(['Q2 FY27', 'Software Developer', 'Bengaluru', 'IT & Digital', 71])
  survey.push(['2026-09', 'Electrician', 'Kolhapur', 58])

  writeCsv(join(OUT, 'job_portal.csv'), ['posting_date', 'job_title', 'city', 'industry', 'openings'], portal)
  writeCsv(join(OUT, 'employment_exchange.csv'), ['period', 'nco_code', 'occupation', 'district', 'state', 'vacancies'], exchange)
  writeCsv(join(OUT, 'industry_hiring.csv'), ['month', 'role', 'location', 'sector', 'hiring_intent_score'], hiring)
  writeCsv(join(OUT, 'industry_survey.csv'), ['survey_month', 'trade', 'district', 'outlook_score'], survey)
  writeCsv(join(OUT, 'training_capacity.csv'), ['training_year', 'district', 'trade', 'sector', 'allocated_seats', 'enrolled', 'completed', 'placed'], training)
  console.log(`raw extracts written: portal ${portal.length}, exchange ${exchange.length}, hiring ${hiring.length}, survey ${survey.length}, training ${training.length}`)
}

main()
