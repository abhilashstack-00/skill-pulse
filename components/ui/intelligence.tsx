'use client'

import type { HorizonKey, Recommendation, Warning } from '@/lib/domain/types'
import { cx, formatMonthLong, formatNumber } from '@/lib/format'
import { useI18n } from '@/lib/i18n/context'
import { recommendationText, warningText } from '@/lib/i18n/render'
import { severityTone, statusTone } from '@/lib/ui/tones'
import { useMeta } from '@/components/layout/app-shell'

/** A number, or an explicit "insufficient data" — never a blank or a zero. */
export function useFigures() {
  const { t, locale } = useI18n()
  return {
    num: (value: number | null | undefined, decimals = 0) => (value === null || value === undefined ? '—' : formatNumber(value, decimals)),
    /** 'next 12 months' or 'at the current annual rate'. */
    windowText: (horizon: { key: HorizonKey; months: number }) =>
      horizon.key === 'current' ? t('horizon.currentRate') : t('horizon.next', { months: horizon.months }),
    /** 'Oct 2026 – Sep 2027' or 'Current rate, annualised'. */
    periodText: (horizon: { key: HorizonKey; periodStart: string | null; periodEnd: string | null }) =>
      horizon.key === 'current' || !horizon.periodStart || !horizon.periodEnd
        ? t('horizon.window.current')
        : t('horizon.window.forecast', { start: formatMonthLong(horizon.periodStart, locale), end: formatMonthLong(horizon.periodEnd, locale) }),
  }
}

/** Early warnings with their reason and recommended action. */
export function WarningList({ warnings, showPlace = true, limit }: { warnings: Warning[]; showPlace?: boolean; limit?: number }) {
  const { t } = useI18n()
  const { names } = useMeta()
  if (!warnings.length) return <p className="muted-text">{t('warning.none')}</p>
  return (
    <ul className="notice-list">
      {warnings.slice(0, limit ?? warnings.length).map((w) => {
        const text = warningText(t, w)
        return (
          <li key={w.id} className={cx('notice', `tone-${severityTone[w.severity]}`)}>
            <div className="notice-head">
              <span className="notice-kind">{text.title} · {t(`severity.${w.severity}`)}</span>
              {showPlace && <span className="notice-place">{names.trade(w.tradeId)} · {names.district(w.districtId)}</span>}
            </div>
            <p className="notice-text">{text.reason}</p>
            {text.support && <p className="notice-action">{text.support}</p>}
            <p className="notice-action">{text.basis}</p>
            {text.action && <p className="notice-action">{text.action}</p>}
          </li>
        )
      })}
    </ul>
  )
}

/** Planner recommendations, each stating the figures it rests on. */
export function RecommendationList({ items, limit }: { items: Recommendation[]; limit?: number }) {
  const { t } = useI18n()
  const { names } = useMeta()
  return (
    <ul className="notice-list">
      {items.slice(0, limit ?? items.length).map((r) => {
        const text = recommendationText(t, names, r)
        return (
          <li key={r.id} className={cx('notice', `tone-${statusTone[r.status]}`)}>
            <div className="notice-head">
              <span className="notice-kind">{text.tag}</span>
              <span className="notice-place">{t(`status.${r.status}`)}</span>
            </div>
            <p className="notice-title">{text.title}</p>
            <p className="notice-text">{text.text}</p>
            {text.effect && <p className="notice-action">{text.effect}</p>}
            {text.secondary && <p className="notice-action">{text.secondary}</p>}
            {text.caution && <p className="notice-action">{text.caution}</p>}
            {text.tentative && <p className="notice-action">{text.tentative}</p>}
          </li>
        )
      })}
    </ul>
  )
}
