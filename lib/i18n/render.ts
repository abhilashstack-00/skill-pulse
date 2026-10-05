import type { EvidenceItem, Recommendation, Warning } from '@/lib/domain/types'
import { formatNumber, signed, signedPct } from '@/lib/format'
import type { Locale, Translator } from './translate'

/** Turns ids into display names in the reader's language. */
export interface Names {
  state: (id: string | null) => string
  district: (id: string | null) => string
  sector: (id: string | null) => string
  trade: (id: string | null) => string
}

type Named = { id: string; name: string; nameHi?: string }

export function namesFrom(
  options: { states: Named[]; districts: Named[]; sectors: Named[]; trades: Named[] },
  locale: Locale,
): Names {
  const lookup = (list: Named[]) => {
    const map = new Map(list.map((x) => [x.id, locale === 'hi' && x.nameHi ? x.nameHi : x.name]))
    return (id: string | null) => (id ? map.get(id) ?? id : '')
  }
  return { state: lookup(options.states), district: lookup(options.districts), sector: lookup(options.sectors), trade: lookup(options.trades) }
}

const pct = (value: unknown) => (typeof value === 'number' ? signedPct(value) : null)

/** Text of an early warning. The numbers come from the warning's own params. */
export function warningText(t: Translator, w: Pick<Warning, 'type' | 'reason' | 'recommendedAction' | 'params'>) {
  const p = w.params
  return {
    title: t(`warning.${w.type}.title`),
    reason: t(w.reason, {
      currentStatus: typeof p.currentStatus === 'string' ? t(`status.${p.currentStatus}`) : null,
      lookaheadStatus: typeof p.lookaheadStatus === 'string' ? t(`status.${p.lookaheadStatus}`) : null,
      currentGapPct: pct(p.currentGapPct),
      lookaheadGapPct: pct(p.lookaheadGapPct),
      demandTrendPct: pct(p.demandTrendPct),
      capacityChangePct: pct(p.capacityChangePct),
      lookaheadMonths: p.lookaheadMonths,
    }),
    action: w.recommendedAction ? t(w.recommendedAction) : null,
  }
}

/** Text of a planner recommendation. */
export function recommendationText(t: Translator, names: Names, r: Pick<Recommendation, 'action' | 'secondary' | 'caution' | 'tentative' | 'params' | 'tradeId' | 'districtId'>) {
  const gap = typeof r.params.gap === 'number' ? r.params.gap : null
  const params = {
    trade: names.trade(r.tradeId),
    district: names.district(r.districtId),
    gap: gap === null ? null : formatNumber(Math.abs(gap)),
    gapAbs: gap === null ? null : formatNumber(Math.abs(gap)),
    gapPct: pct(r.params.gapPct),
    utilizationPct: r.params.utilizationPct,
  }
  return {
    tag: t(`rec.tag.${r.action}`),
    title: t(`rec.${r.action}.title`, params),
    text: t(`rec.${r.action}.text`, params),
    secondary: r.secondary ? t(`rec.secondary.${r.secondary}`) : null,
    caution: r.caution ? t(`rec.caution.${r.caution}`) : null,
    tentative: r.tentative ? t('rec.tentative') : null,
  }
}

export function evidenceValue(t: Translator, item: EvidenceItem): string {
  if (item.value === null || item.value === undefined) return t('common.insufficient')
  if (item.unit === 'status') return t(`status.${item.value}`)
  if (typeof item.value !== 'number') return String(item.value)
  if (item.unit === 'pct') return item.key === 'ev.utilization' || item.key.endsWith('Rate') ? `${formatNumber(item.value, 1)}%` : signedPct(item.value)
  if (item.key === 'ev.gap') return signed(item.value)
  if (item.unit === 'score') return `${formatNumber(item.value)} / 100`
  return formatNumber(item.value)
}
