import type { GapStatus, Priority, Tone } from '@/lib/types'
import { thresholds } from '@/lib/data'

/**
 * Presentation rules shared by every screen. These are simple, configurable
 * classifications over mock index values — not an analytics engine.
 */

export function gapStatus(gap: number): GapStatus {
  if (gap >= thresholds.balanced) return 'shortage'
  if (gap <= -thresholds.balanced) return 'surplus'
  return 'balanced'
}

export function gapPriority(gap: number): Priority {
  const size = Math.abs(gap)
  if (size >= thresholds.high) return 'high'
  if (size >= thresholds.medium) return 'medium'
  return 'low'
}

export const statusLabel: Record<GapStatus, string> = {
  shortage: 'Shortage',
  balanced: 'Balanced',
  surplus: 'Surplus',
}

/** Status colours: one colour per status, used everywhere a status is shown. */
export const statusTone: Record<GapStatus, Tone> = {
  shortage: 'danger',
  balanced: 'success',
  surplus: 'warning',
}

export const priorityLabel: Record<Priority, string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
}

export const priorityTone: Record<Priority, Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
}

/**
 * Tone of a gap figure: severity for shortages (red high, amber medium),
 * green for an excess of supply, neutral when the market is close to balance.
 */
export function gapTone(gap: number): Tone {
  if (gap <= -thresholds.balanced) return 'success'
  if (gap >= thresholds.high) return 'danger'
  if (gap >= thresholds.medium) return 'warning'
  return 'neutral'
}

/** Net pressure of a region, from the mean gap of its records. */
export type PressureLevel = 'high' | 'moderate' | 'low' | 'none'

export function pressureLevel(meanGap: number | null): PressureLevel {
  if (meanGap === null) return 'none'
  if (meanGap >= thresholds.medium) return 'high'
  if (meanGap >= thresholds.balanced) return 'moderate'
  return 'low'
}

export const pressureLabel: Record<PressureLevel, string> = {
  high: 'High shortage pressure',
  moderate: 'Moderate shortage pressure',
  low: 'Low pressure or surplus',
  none: 'No data for this selection',
}
