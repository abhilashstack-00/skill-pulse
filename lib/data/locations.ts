import type { District, State } from '@/lib/types'

/** Pilot regions. Map positions are schematic, not geographic projections. */
export const states: State[] = [
  { id: 'telangana', name: 'Telangana', map: { x: 66.5, y: 50.8 } },
  { id: 'karnataka', name: 'Karnataka', map: { x: 50.6, y: 60.8 } },
  { id: 'maharashtra', name: 'Maharashtra', map: { x: 44.3, y: 44.8 } },
]

export const districts: District[] = [
  { id: 'hyderabad', name: 'Hyderabad', stateId: 'telangana' },
  { id: 'warangal', name: 'Warangal', stateId: 'telangana' },
  { id: 'bengaluru', name: 'Bengaluru', stateId: 'karnataka' },
  { id: 'hubballi', name: 'Hubballi', stateId: 'karnataka' },
  { id: 'mysuru', name: 'Mysuru', stateId: 'karnataka' },
  { id: 'pune', name: 'Pune', stateId: 'maharashtra' },
  { id: 'mumbai', name: 'Mumbai', stateId: 'maharashtra' },
  { id: 'nagpur', name: 'Nagpur', stateId: 'maharashtra' },
]
