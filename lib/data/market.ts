import type { IndexPair, SkillMarketRecord } from '@/lib/types'

/**
 * Demand and supply observations for the pilot — MOCK VALUES.
 * One record per skill in its pilot district. Indices are on a 0–100 scale.
 * Gap, status and priority are never stored here; they are derived in
 * lib/services/derive.ts so that no business value is duplicated.
 */

/** Dataset-level metadata shown in headers and evidence panels. */
export const dataset = {
  label: 'Pilot dataset',
  status: 'Operational',
  /** ISO date of the latest refresh of the mock dataset. */
  updatedAt: '2026-09-28',
}

const fc = (d3: number, s3: number, d6: number, s6: number, d12: number, s12: number) =>
  ({ '3M': { demand: d3, supply: s3 }, '6M': { demand: d6, supply: s6 }, '12M': { demand: d12, supply: s12 } }) satisfies Record<string, IndexPair>

export const marketRecords: SkillMarketRecord[] = [
  { skillId: 'data-analyst', districtId: 'hyderabad', demandIndex: 82, supplyIndex: 61, demandGrowth: 18, supplyGrowth: 4, workforceGap: 4900, demandSignals: 6240, coverage: 87, confidence: 'Medium', primaryDriver: 'Rapid vacancy growth', forecast: fc(86, 62, 90, 63, 96, 65) },
  { skillId: 'solar-technician', districtId: 'bengaluru', demandIndex: 76, supplyIndex: 58, demandGrowth: 26, supplyGrowth: 2, workforceGap: 3350, demandSignals: 4980, coverage: 81, confidence: 'Medium', primaryDriver: 'Rooftop solar installation targets', forecast: fc(79, 59, 82, 59, 87, 60) },
  { skillId: 'nurse-associate', districtId: 'hyderabad', demandIndex: 72, supplyIndex: 57, demandGrowth: 10, supplyGrowth: 7, workforceGap: 2050, demandSignals: 4360, coverage: 84, confidence: 'High', primaryDriver: 'Hospital capacity expansion', forecast: fc(75, 58, 78, 59, 82, 60) },
  { skillId: 'retail-associate', districtId: 'pune', demandIndex: 44, supplyIndex: 61, demandGrowth: -3, supplyGrowth: -3, workforceGap: 1150, demandSignals: 3890, coverage: 90, confidence: 'High', primaryDriver: 'Training intake above hiring demand', forecast: fc(43, 61, 42, 61, 40, 61) },
  { skillId: 'cloud-support', districtId: 'warangal', demandIndex: 68, supplyIndex: 57, demandGrowth: 12, supplyGrowth: 5, workforceGap: 900, demandSignals: 3420, coverage: 76, confidence: 'Medium', primaryDriver: 'New IT park hiring', forecast: fc(70, 58, 72, 58, 75, 59) },
  { skillId: 'ev-service-technician', districtId: 'pune', demandIndex: 63, supplyIndex: 54, demandGrowth: 14, supplyGrowth: 6, workforceGap: 780, demandSignals: 2960, coverage: 72, confidence: 'Low', primaryDriver: 'EV service network roll-out', forecast: fc(65, 55, 67, 55, 71, 56) },
  { skillId: 'industrial-electrician', districtId: 'hubballi', demandIndex: 66, supplyIndex: 58, demandGrowth: 8, supplyGrowth: 3, workforceGap: 640, demandSignals: 2740, coverage: 79, confidence: 'Medium', primaryDriver: 'Industrial corridor projects', forecast: fc(67, 58, 68, 59, 70, 59) },
  { skillId: 'logistics-coordinator', districtId: 'mumbai', demandIndex: 61, supplyIndex: 54, demandGrowth: 7, supplyGrowth: 4, workforceGap: 560, demandSignals: 2610, coverage: 83, confidence: 'Medium', primaryDriver: 'Port and warehousing growth', forecast: fc(62, 54, 63, 55, 65, 56) },
  { skillId: 'cnc-operator', districtId: 'hubballi', demandIndex: 58, supplyIndex: 52, demandGrowth: 6, supplyGrowth: 3, workforceGap: 420, demandSignals: 2180, coverage: 74, confidence: 'Medium', primaryDriver: 'Machining orders from auto suppliers', forecast: fc(59, 52, 60, 53, 61, 54) },
  { skillId: 'data-entry-operator', districtId: 'nagpur', demandIndex: 41, supplyIndex: 49, demandGrowth: -5, supplyGrowth: 1, workforceGap: 510, demandSignals: 1960, coverage: 88, confidence: 'High', primaryDriver: 'Automation of routine data work', forecast: fc(40, 49, 39, 49, 37, 49) },
  { skillId: 'sewing-machine-operator', districtId: 'mysuru', demandIndex: 47, supplyIndex: 53, demandGrowth: -2, supplyGrowth: 2, workforceGap: 380, demandSignals: 1720, coverage: 71, confidence: 'Low', primaryDriver: 'Flat export order book', forecast: fc(47, 53, 46, 54, 46, 54) },
  { skillId: 'pharmacy-assistant', districtId: 'mumbai', demandIndex: 57, supplyIndex: 54, demandGrowth: 9, supplyGrowth: 2, workforceGap: 240, demandSignals: 1890, coverage: 80, confidence: 'Medium', primaryDriver: 'Retail pharmacy chain expansion', forecast: fc(59, 54, 60, 54, 63, 55) },
  { skillId: 'bfsi-sales-associate', districtId: 'bengaluru', demandIndex: 60, supplyIndex: 59, demandGrowth: 4, supplyGrowth: 4, workforceGap: 90, demandSignals: 1540, coverage: 85, confidence: 'High', primaryDriver: 'Steady branch hiring', forecast: fc(61, 60, 61, 60, 62, 61) },
  { skillId: 'warehouse-associate', districtId: 'nagpur', demandIndex: 55, supplyIndex: 57, demandGrowth: 3, supplyGrowth: 4, workforceGap: 130, demandSignals: 1210, coverage: 78, confidence: 'Medium', primaryDriver: 'Stable fulfilment volumes', forecast: fc(55, 57, 56, 58, 56, 58) },
  { skillId: 'front-office-associate', districtId: 'nagpur', demandIndex: 52, supplyIndex: 56, demandGrowth: 2, supplyGrowth: 3, workforceGap: 210, demandSignals: 980, coverage: 69, confidence: 'Low', primaryDriver: 'Seasonal hospitality demand', forecast: fc(52, 56, 53, 57, 53, 57) },
]
