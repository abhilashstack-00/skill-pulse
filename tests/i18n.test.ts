import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/messages/en'
import { hi } from '@/lib/i18n/messages/hi'
import { ALERTS, FORECAST, PRIORITY, RECENT_WINDOW_MONTHS } from '@/lib/config/methodology'
import { translate } from '@/lib/i18n/translate'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('translations', () => {
  it('Hindi has exactly the same keys as English', () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort())
  })

  it('every Hindi message uses the same placeholders as the English one', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(hi[key]), key).toEqual(placeholders(en[key]))
    }
  })

  it('no message is left empty', () => {
    for (const [key, text] of Object.entries(hi)) expect(text.trim().length, key).toBeGreaterThan(0)
  })

  it('fills placeholders and falls back to English for an unknown locale key', () => {
    expect(translate('en', 'rec.increase_capacity.title', { trade: 'Solar Technician', district: 'Warangal' })).toBe('Increase Solar Technician training capacity in Warangal')
    expect(translate('hi', 'rec.increase_capacity.title', { trade: 'सोलर तकनीशियन', district: 'वारंगल' })).toBe('वारंगल में सोलर तकनीशियन की प्रशिक्षण क्षमता बढ़ाएँ')
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })

  it('takes horizon lengths from the configuration, so no text has them typed in', () => {
    expect(translate('en', 'ev.forecastDemand')).toBe(`Forecast demand (${FORECAST.horizons[PRIORITY.planningHorizon]} months)`)
    expect(translate('en', 'ev.lookaheadStatus')).toBe(`Forecast status (${FORECAST.horizons[ALERTS.lookaheadHorizon]} months)`)
    expect(translate('hi', 'skill.demand.runRateValue', { value: 12 })).toContain(`${RECENT_WINDOW_MONTHS} माह`)
    // A value passed by the caller still wins over the configured one.
    expect(translate('en', 'warning.upcoming_shortage.reason', { lookaheadMonths: 9, currentStatus: 'a', lookaheadStatus: 'b', lookaheadGapPct: 'c' })).toContain('within 9 months')
    // Nothing in either language still spells a horizon out next to the word "month".
    // (The labels of the horizons themselves, 'horizon.3M' and so on, are named after their own key.)
    for (const [key, text] of [...Object.entries(en), ...Object.entries(hi)]) {
      if (key.startsWith('horizon.')) continue
      expect(/\b(3|6|12)[- ](month|माह|महीन)/.test(text), key).toBe(false)
    }
  })
})
