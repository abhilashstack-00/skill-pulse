import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/messages/en'
import { hi } from '@/lib/i18n/messages/hi'
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
})
