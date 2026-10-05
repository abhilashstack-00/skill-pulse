import type { DataSource, DatasetMeta, District, Sector, State, Trade, TrainingCentre } from '@/lib/domain/types'

/**
 * Reference data for the pilot. Places, sectors and trades are real names;
 * every figure attached to them elsewhere in the pilot is synthetic.
 */

export const meta: DatasetMeta = {
  label: 'Prototype synthetic pilot data',
  synthetic: true,
  asOfPeriod: '2026-09',
  updatedAt: '2026-09-28',
  currentTrainingYear: 2026,
}

export const DATASET_TAG = 'pilot-synthetic-v1'

export const states: State[] = [
  { id: 'TG', name: 'Telangana', nameHi: 'तेलंगाना', code: 'TG' },
  { id: 'KA', name: 'Karnataka', nameHi: 'कर्नाटक', code: 'KA' },
  { id: 'MH', name: 'Maharashtra', nameHi: 'महाराष्ट्र', code: 'MH' },
]

export const districts: District[] = [
  { id: 'hyderabad', stateId: 'TG', name: 'Hyderabad', nameHi: 'हैदराबाद', code: 'TG-HYD' },
  { id: 'rangareddy', stateId: 'TG', name: 'Rangareddy', nameHi: 'रंगारेड्डी', code: 'TG-RR' },
  { id: 'warangal', stateId: 'TG', name: 'Warangal', nameHi: 'वारंगल', code: 'TG-WGL' },
  { id: 'bengaluru-urban', stateId: 'KA', name: 'Bengaluru Urban', nameHi: 'बेंगलुरु शहरी', code: 'KA-BLU' },
  { id: 'mysuru', stateId: 'KA', name: 'Mysuru', nameHi: 'मैसूरु', code: 'KA-MYS' },
  { id: 'pune', stateId: 'MH', name: 'Pune', nameHi: 'पुणे', code: 'MH-PUN' },
  { id: 'nagpur', stateId: 'MH', name: 'Nagpur', nameHi: 'नागपुर', code: 'MH-NGP' },
]

export const sectors: Sector[] = [
  { id: 'it-digital', name: 'IT & Digital', nameHi: 'आईटी और डिजिटल', code: 'ITD' },
  { id: 'healthcare', name: 'Healthcare', nameHi: 'स्वास्थ्य सेवा', code: 'HLT' },
  { id: 'manufacturing', name: 'Manufacturing', nameHi: 'विनिर्माण', code: 'MFG' },
  { id: 'logistics', name: 'Logistics', nameHi: 'लॉजिस्टिक्स', code: 'LOG' },
  { id: 'construction', name: 'Construction', nameHi: 'निर्माण', code: 'CON' },
  { id: 'retail', name: 'Retail', nameHi: 'खुदरा', code: 'RTL' },
  { id: 'renewable-energy', name: 'Renewable Energy', nameHi: 'नवीकरणीय ऊर्जा', code: 'REN' },
]

export const trades: Trade[] = [
  { id: 'software-developer', sectorId: 'it-digital', name: 'Software Developer', nameHi: 'सॉफ्टवेयर डेवलपर', ncoCode: '2512', nsqfLevel: 5 },
  { id: 'data-entry-operator', sectorId: 'it-digital', name: 'Data Entry Operator', nameHi: 'डेटा एंट्री ऑपरेटर', ncoCode: '4132', nsqfLevel: 3 },
  { id: 'digital-marketing-executive', sectorId: 'it-digital', name: 'Digital Marketing Executive', nameHi: 'डिजिटल मार्केटिंग एग्जीक्यूटिव', ncoCode: '2431', nsqfLevel: 4 },
  { id: 'healthcare-assistant', sectorId: 'healthcare', name: 'Healthcare Assistant', nameHi: 'स्वास्थ्य सहायक', ncoCode: '5321', nsqfLevel: 4 },
  { id: 'phlebotomy-technician', sectorId: 'healthcare', name: 'Phlebotomy Technician', nameHi: 'फ्लेबोटोमी तकनीशियन', ncoCode: '3212', nsqfLevel: 4 },
  { id: 'cnc-operator', sectorId: 'manufacturing', name: 'CNC Operator', nameHi: 'सीएनसी ऑपरेटर', ncoCode: '7223', nsqfLevel: 4 },
  { id: 'welder', sectorId: 'manufacturing', name: 'Welder', nameHi: 'वेल्डर', ncoCode: '7212', nsqfLevel: 3 },
  { id: 'warehouse-associate', sectorId: 'logistics', name: 'Warehouse Associate', nameHi: 'वेयरहाउस एसोसिएट', ncoCode: '4321', nsqfLevel: 3 },
  { id: 'logistics-coordinator', sectorId: 'logistics', name: 'Logistics Coordinator', nameHi: 'लॉजिस्टिक्स समन्वयक', ncoCode: '4323', nsqfLevel: 4 },
  { id: 'electrician', sectorId: 'construction', name: 'Electrician', nameHi: 'इलेक्ट्रीशियन', ncoCode: '7411', nsqfLevel: 4 },
  { id: 'mason', sectorId: 'construction', name: 'Mason', nameHi: 'राजमिस्त्री', ncoCode: '7112', nsqfLevel: 3 },
  { id: 'retail-sales-associate', sectorId: 'retail', name: 'Retail Sales Associate', nameHi: 'रिटेल सेल्स एसोसिएट', ncoCode: '5223', nsqfLevel: 3 },
  { id: 'solar-technician', sectorId: 'renewable-energy', name: 'Solar Technician', nameHi: 'सोलर तकनीशियन', ncoCode: '7412', nsqfLevel: 4 },
  { id: 'wind-turbine-technician', sectorId: 'renewable-energy', name: 'Wind Turbine Technician', nameHi: 'पवन टरबाइन तकनीशियन', ncoCode: '7233', nsqfLevel: 4 },
]

/** Fictional centres, named generically so they cannot be mistaken for real institutions. */
export const trainingCentres: TrainingCentre[] = districts.flatMap((district) =>
  sectors.map((sector, index) => ({
    id: `${district.code}-${sector.code}`.toLowerCase(),
    name: `${district.name} ${sector.name} Skill Centre (pilot)`,
    districtId: district.id,
    sectorId: sector.id,
    status: (district.id === 'warangal' && sector.id === 'retail') || (district.id === 'mysuru' && sector.id === 'logistics') ? ('inactive' as const) : ('active' as const),
    capacity: 240 + ((index * 60 + district.name.length * 40) % 480),
  })),
)

type SourceSeed = Omit<DataSource, 'recordsIn' | 'recordsMapped' | 'lastUpdated'> & { rawFile?: string }

export const dataSources: SourceSeed[] = [
  {
    id: 'job-portals', name: 'Job portal postings', sourceType: 'demand', status: 'prototype_synthetic', rawFile: 'job_portal',
    description: 'Synthetic extract in the shape of job-portal vacancy listings. Stands in for portal data until a real feed is agreed.',
    coverage: '7 pilot districts in 3 states', granularity: 'District × job title × month', feeds: 'Job postings (Demand Index, demand volume)',
  },
  {
    id: 'employment-exchange', name: 'Employment exchange vacancies (NCS-style)', sourceType: 'demand', status: 'prototype_synthetic', rawFile: 'employment_exchange',
    description: 'Synthetic extract shaped like National Career Service vacancy registrations with NCO codes. No connection to NCS exists yet.',
    coverage: '7 pilot districts in 3 states', granularity: 'District × NCO unit group × month', feeds: 'Employment registrations (Demand Index, demand volume)',
  },
  {
    id: 'industry-hiring', name: 'Industry hiring intent', sourceType: 'demand', status: 'prototype_synthetic', rawFile: 'industry_hiring',
    description: 'Synthetic employer hiring-intent scores (0–100) by role and location.',
    coverage: '7 pilot districts in 3 states', granularity: 'District × role × month', feeds: 'Hiring signal (Demand Index)',
  },
  {
    id: 'industry-survey', name: 'Industry demand outlook survey', sourceType: 'demand', status: 'prototype_synthetic', rawFile: 'industry_survey',
    description: 'Synthetic sector-skill-council style outlook scores (0–100) by trade and district.',
    coverage: '7 pilot districts in 3 states', granularity: 'District × trade × month', feeds: 'Industry demand signal (Demand Index)',
  },
  {
    id: 'training-capacity', name: 'Training capacity and outcomes', sourceType: 'supply', status: 'prototype_synthetic', rawFile: 'training_capacity',
    description: 'Synthetic seat allocation, enrolment, completion and placement by trade and district. Stands in for scheme MIS data.',
    coverage: '7 pilot districts in 3 states', granularity: 'District × trade × training year', feeds: 'Supply Index, supply forecast',
  },
  {
    id: 'nco-nsqf', name: 'NCO-2015 / NSQF classification', sourceType: 'reference', status: 'prototype_reference',
    description: 'Indicative mapping of pilot trades to NCO-2015 unit groups and NSQF levels, built by hand for the prototype. Needs validation against the official registers.',
    coverage: '14 pilot trades', granularity: 'Trade', feeds: 'Occupation normalisation',
  },
  {
    id: 'ncs', name: 'National Career Service (NCS)', sourceType: 'demand', status: 'planned',
    description: 'Planned source for vacancy and jobseeker registrations. Not connected.',
    coverage: 'National', granularity: 'District × occupation × month', feeds: 'Would replace the synthetic employment-exchange extract',
  },
  {
    id: 'e-shram', name: 'e-Shram', sourceType: 'supply', status: 'planned',
    description: 'Planned source for the registered unorganised workforce by occupation and district. Not connected.',
    coverage: 'National', granularity: 'District × occupation', feeds: 'Would add available workforce to the supply side',
  },
  {
    id: 'plfs', name: 'Periodic Labour Force Survey (PLFS)', sourceType: 'demand', status: 'planned',
    description: 'Planned source for employment structure by occupation and region, to benchmark demand levels. Not connected.',
    coverage: 'National, state and region', granularity: 'State × occupation group × quarter or year', feeds: 'Would calibrate demand volumes',
  },
  {
    id: 'scheme-mis', name: 'Scheme MIS (Skill India Digital Hub and state systems)', sourceType: 'supply', status: 'planned',
    description: 'Planned source for sanctioned seats, enrolment, certification and placement. Not connected.',
    coverage: 'National', granularity: 'Centre × trade × batch', feeds: 'Would replace the synthetic training-capacity extract',
  },
]
