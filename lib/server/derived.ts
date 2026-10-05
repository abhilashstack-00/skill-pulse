import { FORECAST, SUPPLY_FORECAST } from '@/lib/config/methodology'
import type { Snapshot } from '@/lib/domain/types'
import { FORECAST_HORIZONS, HORIZON_KEYS } from '@/lib/intelligence/engine'

const monthEnd = (period: string) => `${period}-01`

/** Engine output in the shape of the three derived tables. */
export function derivedRows(snapshot: Snapshot) {
  const demandForecasts: unknown[][] = []
  const supplyForecasts: unknown[][] = []
  const gapAnalysis: unknown[][] = []
  for (const cell of snapshot.cells) {
    const ids = [cell.districtId, cell.sectorId, cell.tradeId]
    for (const horizon of FORECAST_HORIZONS) {
      const d = cell.demandForecasts[horizon]
      const s = cell.supplyForecasts[horizon]
      demandForecasts.push([...ids, horizon, monthEnd(d.periodEnd), d.predictedDemand, d.lowerBound, d.upperBound, d.method, d.confidence?.score ?? null, d.modelVersion])
      supplyForecasts.push([...ids, horizon, monthEnd(d.periodEnd), s.predictedSupply, s.method, s.modelVersion])
    }
    for (const horizon of HORIZON_KEYS) {
      const h = cell.horizons[horizon]
      gapAnalysis.push([...ids, horizon, monthEnd(h.periodEnd), h.demand, h.supply, h.gap.gap, h.gap.gapPercentage, h.gap.status, cell.priority.score])
    }
  }
  return {
    demand_forecasts: {
      columns: ['district_id', 'sector_id', 'trade_id', 'horizon', 'forecast_period', 'predicted_demand', 'lower_bound', 'upper_bound', 'method', 'confidence_score', 'model_version'],
      rows: demandForecasts,
    },
    supply_forecasts: {
      columns: ['district_id', 'sector_id', 'trade_id', 'horizon', 'forecast_period', 'predicted_supply', 'method', 'model_version'],
      rows: supplyForecasts,
    },
    gap_analysis: {
      columns: ['district_id', 'sector_id', 'trade_id', 'horizon', 'period', 'demand', 'supply', 'gap', 'gap_percentage', 'status', 'priority_score'],
      rows: gapAnalysis,
    },
    modelVersions: { demand: FORECAST.modelVersion, supply: SUPPLY_FORECAST.modelVersion },
  }
}
