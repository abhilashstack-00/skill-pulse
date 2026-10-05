import type { Recommendation } from '@/lib/types'

/**
 * Planning actions — MOCK. In a later stage these come from a recommendation
 * service. Only the wording lives here; every figure shown beside an action is
 * joined from the market data by skillId.
 */
export const recommendations: Recommendation[] = [
  { id: 'act-01', skillId: 'data-analyst', severity: 'critical', title: 'Increase Data Analyst training capacity', suggestedAction: 'Increase capacity in priority districts.' },
  { id: 'act-02', skillId: 'solar-technician', severity: 'critical', title: 'Expand Solar Technician certification', suggestedAction: 'Add certified training batches near installation clusters.' },
  { id: 'act-03', skillId: 'nurse-associate', severity: 'priority', title: 'Add Nurse Associate training seats', suggestedAction: 'Open additional seats with partner hospitals.' },
  { id: 'act-04', skillId: 'retail-associate', severity: 'rebalance', title: 'Rebalance Retail Associate intake', suggestedAction: 'Redirect part of new intake to adjacent service roles.' },
  { id: 'act-05', skillId: 'cloud-support', severity: 'priority', title: 'Start a Cloud Support cohort', suggestedAction: 'Launch one employer-linked cohort this cycle.' },
  { id: 'act-06', skillId: 'ev-service-technician', severity: 'priority', title: 'Pilot EV Service Technician training', suggestedAction: 'Convert one automotive workshop track to EV servicing.' },
  { id: 'act-07', skillId: 'industrial-electrician', severity: 'priority', title: 'Grow Industrial Electrician apprenticeships', suggestedAction: 'Expand apprenticeship seats with corridor employers.' },
  { id: 'act-08', skillId: 'logistics-coordinator', severity: 'priority', title: 'Extend Logistics Coordinator training', suggestedAction: 'Add an evening batch at existing centres.' },
  { id: 'act-09', skillId: 'cnc-operator', severity: 'priority', title: 'Raise CNC Operator completion', suggestedAction: 'Improve completion rather than adding seats.' },
  { id: 'act-10', skillId: 'data-entry-operator', severity: 'rebalance', title: 'Reduce Data Entry Operator intake', suggestedAction: 'Shift intake towards data and cloud support roles.' },
  { id: 'act-11', skillId: 'sewing-machine-operator', severity: 'rebalance', title: 'Hold Sewing Machine Operator intake', suggestedAction: 'Hold intake flat until order volumes recover.' },
  { id: 'act-12', skillId: 'pharmacy-assistant', severity: 'watch', title: 'Monitor Pharmacy Assistant demand', suggestedAction: 'Review again next cycle; a shortage is forecast within 6 months.' },
]
