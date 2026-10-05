import type { GapStatus, GroupHeadline, Severity } from '@/lib/domain/types'

/** Visual tone used for figures, pills and tiles. Maps to the tone-* CSS classes. */
export type Tone = 'danger' | 'warning' | 'success' | 'primary' | 'neutral' | 'mixed'

/** Status colours: shortage red, balanced green, oversupply amber — everywhere. */
export const statusTone: Record<GapStatus, Tone> = {
  severe_shortage: 'danger',
  shortage: 'danger',
  balanced: 'success',
  oversupply: 'warning',
  severe_oversupply: 'warning',
  insufficient_data: 'neutral',
}

export const bandTone: Record<'high' | 'medium' | 'low', Tone> = { high: 'danger', medium: 'warning', low: 'neutral' }

export const severityTone: Record<Severity, Tone> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'primary' }

/** Tone of a gap figure: follows the status it belongs to. */
export const gapTone = (status: GapStatus): Tone => statusTone[status]

/**
 * Headline of a group of pairs. "Mixed" has its own colour, used for nothing
 * else: a group with both material shortages and material surpluses is a
 * problem in two directions and must look neither fine (green) nor like a
 * neutral interface accent (blue).
 */
export const headlineTone: Record<GroupHeadline, Tone> = {
  ...statusTone,
  mostly_shortage: 'danger',
  mostly_oversupply: 'warning',
  mixed: 'mixed',
  largely_balanced: 'success',
}
