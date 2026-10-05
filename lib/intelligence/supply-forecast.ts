import { SUPPLY_FORECAST } from '@/lib/config/methodology'
import type { SupplyForecast, TrainingCapacityRow } from '@/lib/domain/types'
import { mean, round } from './math'

/**
 * Supply forecast: training capacity projected along its recent yearly trend.
 *
 *   projected annual capacity = latest seats + average yearly change × (H / 12)
 *   supply over the horizon   = projected annual capacity × (H / 12)
 *
 * With one year of data the capacity is held flat. With none, or if the
 * latest year is too old, there is no forecast.
 */
export function forecastSupply(
  rows: Pick<TrainingCapacityRow, 'year' | 'allocatedSeats'>[],
  currentTrainingYear: number,
  horizonMonths: number,
  params: typeof SUPPLY_FORECAST = SUPPLY_FORECAST,
): SupplyForecast {
  const base = { horizonMonths, modelVersion: params.modelVersion }
  const years = [...rows].sort((a, b) => a.year - b.year)
  const latest = years[years.length - 1]
  if (!latest || currentTrainingYear - latest.year > params.maxAgeYears) {
    return { ...base, method: 'insufficient_data', predictedSupply: null, currentAnnualCapacity: null, projectedAnnualCapacity: null, yearlyChange: null, latestYear: latest?.year ?? null }
  }
  const changes: number[] = []
  for (let i = years.length - 1; i > 0 && changes.length < params.maxChangesForTrend; i--) {
    if (years[i].year - years[i - 1].year === 1) changes.push(years[i].allocatedSeats - years[i - 1].allocatedSeats)
    else break
  }
  const yearlyChange = changes.length ? mean(changes) : 0
  const fraction = horizonMonths / 12
  const projected = Math.max(0, latest.allocatedSeats + yearlyChange * fraction)
  return {
    ...base,
    method: changes.length ? 'capacity_trend' : 'flat_single_year',
    predictedSupply: Math.round(projected * fraction),
    currentAnnualCapacity: latest.allocatedSeats,
    projectedAnnualCapacity: round(projected, 1),
    yearlyChange: round(yearlyChange, 1),
    latestYear: latest.year,
  }
}
