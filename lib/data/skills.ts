import type { Skill } from '@/lib/types'

/** The 15 priority occupations tracked in the pilot. */
export const skills: Skill[] = [
  { id: 'data-analyst', name: 'Data Analyst', shortName: 'Data Analyst', sector: 'IT & ITES', nsqfLevel: 5 },
  { id: 'solar-technician', name: 'Solar Technician', shortName: 'Solar Tech', sector: 'Green Energy', nsqfLevel: 4 },
  { id: 'nurse-associate', name: 'Nurse Associate', shortName: 'Nurse', sector: 'Healthcare', nsqfLevel: 4 },
  { id: 'retail-associate', name: 'Retail Associate', shortName: 'Retail', sector: 'Retail', nsqfLevel: 3 },
  { id: 'cloud-support', name: 'Cloud Support', shortName: 'Cloud', sector: 'IT & ITES', nsqfLevel: 5 },
  { id: 'ev-service-technician', name: 'EV Service Technician', shortName: 'EV Tech', sector: 'Automotive', nsqfLevel: 4 },
  { id: 'industrial-electrician', name: 'Industrial Electrician', shortName: 'Electrician', sector: 'Manufacturing', nsqfLevel: 4 },
  { id: 'logistics-coordinator', name: 'Logistics Coordinator', shortName: 'Logistics', sector: 'Logistics', nsqfLevel: 4 },
  { id: 'cnc-operator', name: 'CNC Operator', shortName: 'CNC', sector: 'Manufacturing', nsqfLevel: 4 },
  { id: 'data-entry-operator', name: 'Data Entry Operator', shortName: 'Data Entry', sector: 'IT & ITES', nsqfLevel: 3 },
  { id: 'sewing-machine-operator', name: 'Sewing Machine Operator', shortName: 'Sewing', sector: 'Apparel', nsqfLevel: 3 },
  { id: 'pharmacy-assistant', name: 'Pharmacy Assistant', shortName: 'Pharmacy', sector: 'Healthcare', nsqfLevel: 4 },
  { id: 'bfsi-sales-associate', name: 'BFSI Sales Associate', shortName: 'BFSI Sales', sector: 'BFSI', nsqfLevel: 4 },
  { id: 'warehouse-associate', name: 'Warehouse Associate', shortName: 'Warehouse', sector: 'Logistics', nsqfLevel: 3 },
  { id: 'front-office-associate', name: 'Front Office Associate', shortName: 'Front Office', sector: 'Hospitality', nsqfLevel: 4 },
]
