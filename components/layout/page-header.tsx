'use client'

import { formatDate } from '@/lib/format'
import { useI18n } from '@/lib/i18n/context'
import type { MessageKey } from '@/lib/i18n/translate'
import { useMeta } from './app-shell'

export function PageHeader({ title, subtitle }: { title: MessageKey; subtitle: MessageKey }) {
  const { t, locale } = useI18n()
  const { meta } = useMeta()
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{t(title)}</h1>
        <p className="page-subtitle">{t(subtitle)}</p>
      </div>
      {meta && (
        <div className="page-provenance">
          <p className="page-updated">{t('app.updated', { date: formatDate(meta.dataset.updatedAt, locale) })}</p>
          {meta.dataset.synthetic && <p className="provenance-tag" title={t('app.syntheticHint')}>{t('app.synthetic')}</p>}
        </div>
      )}
    </header>
  )
}
