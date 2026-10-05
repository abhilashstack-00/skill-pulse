import type { GapStatus, Severity } from '@/lib/domain/types'

/** Visual tone used for figures, pills and tiles. Maps to the tone-* CSS classes. */
export type Tone = 'danger' | 'warning' | 'success' | 'primary' | 'neutral'

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
