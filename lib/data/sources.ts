import type { DataSource } from '@/lib/types'

/**
 * Source catalogue — MOCK. None of these are live integrations yet; `stage`
 * says what each row really is so the UI never implies a connected feed.
 */
export const dataSources: DataSource[] = [
  {
    id: 'ncs', name: 'NCS', fullName: 'National Career Service', role: 'demand',
    coverage: 'Labour demand', coverageDetail: 'occupation / vacancy signals', lastUpdated: '2026-09-28',
    fieldsUsed: ['Skill', 'Location', 'Vacancies'],
    transformation: ['Normalize', 'score'], transformationDetail: ['normalization', 'scoring'],
    stage: 'Prototype dataset',
  },
  {
    id: 'plfs', name: 'PLFS', fullName: 'Periodic Labour Force Survey', role: 'demand',
    coverage: 'Workforce', coverageDetail: 'employment by occupation and region', lastUpdated: '2026-09-25',
    fieldsUsed: ['Occupation', 'Region'],
    transformation: ['Normalize', 'score'], transformationDetail: ['normalization', 'scoring'],
    stage: 'Prototype dataset',
  },
  {
    id: 'e-shram', name: 'e-Shram', fullName: 'e-Shram unorganised worker registry', role: 'supply',
    coverage: 'Workforce', coverageDetail: 'registered workers by skill and location', lastUpdated: '2026-09-27',
    fieldsUsed: ['Worker', 'Skill', 'Location'],
    transformation: ['Map', 'aggregate'], transformationDetail: ['skill mapping', 'aggregation'],
    stage: 'Planned integration',
  },
  {
    id: 'training-records', name: 'Training Records', fullName: 'Training capacity and outcome records', role: 'supply',
    coverage: 'Supply', coverageDetail: 'seats, completions and certifications', lastUpdated: '2026-09-28',
    fieldsUsed: ['Seats', 'Completion', 'Certification'],
    transformation: ['Normalize', 'supply'], transformationDetail: ['normalization', 'supply index'],
    stage: 'Prototype dataset',
  },
  {
    id: 'industry-signals', name: 'Industry Signals', fullName: 'Employer and industry hiring signals', role: 'demand',
    coverage: 'Demand', coverageDetail: 'vacancy counts and hiring growth', lastUpdated: '2026-09-28',
    fieldsUsed: ['Vacancies', 'Growth'],
    transformation: ['Aggregate', 'demand'], transformationDetail: ['aggregation', 'demand index'],
    stage: 'Demo source',
  },
]
