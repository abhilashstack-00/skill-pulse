'use client'

import { useState } from 'react'
import { getSources } from '@/lib/client/api'
import { formatDate, formatNumber } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState, ErrorState, LoadingState, Pill, SectionCard } from '@/components/ui/primitives'

const COLUMNS = [
  { label: 'sources.col.source', width: '26%' },
  { label: 'sources.col.coverage', width: '19%' },
  { label: 'sources.col.updated', width: '13%' },
  { label: 'sources.col.granularity', width: '20%' },
  { label: 'sources.col.feeds', width: 'auto' },
]

export function DataSourcesPage() {
  const { t, locale } = useI18n()
  const sources = useService(getSources, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = sources.data?.sources ?? []
  const selected = list.find((s) => s.id === selectedId) ?? list[0]

  return (
    <div className="page">
      <PageHeader title="sources.title" subtitle="sources.subtitle" />

      <SectionCard className="sources-card" aria-label={t('sources.title')}>
        {sources.status === 'error' ? (
          <ErrorState error={sources.error} onRetry={sources.retry} />
        ) : !sources.data ? (
          <LoadingState height={560} />
        ) : list.length === 0 ? (
          <EmptyState title={t('common.empty')} />
        ) : (
          <div className="table-scroll">
            <table className="data-table sources-table">
              <colgroup>{COLUMNS.map((column) => <col key={column.label} style={{ width: column.width }} />)}</colgroup>
              <thead>
                <tr>{COLUMNS.map((column) => <th key={column.label} scope="col">{t(column.label)}</th>)}</tr>
              </thead>
              <tbody>
                {list.map((source) => (
                  <tr
                    key={source.id} tabIndex={0}
                    aria-current={source.id === selected?.id ? 'true' : undefined}
                    onClick={() => setSelectedId(source.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedId(source.id)
                      }
                    }}
                  >
                    <td>
                      <span className="cell-strong">{source.name}</span>
                      <span className="source-stage">{t(`sources.status.${source.status}`)}</span>
                    </td>
                    <td>{t(`sources.type.${source.sourceType}`)} · {source.coverage}</td>
                    <td>{source.lastUpdated ? formatDate(source.lastUpdated, locale) : t('sources.notConnected')}</td>
                    <td>{source.granularity}</td>
                    <td>{source.feeds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {selected && sources.data && (
        <section className="source-detail" aria-live="polite" aria-label={t('sources.selected', { name: selected.name })}>
          <div className="source-detail-head">
            <h2 className="source-detail-title">{t('sources.selected', { name: selected.name })}</h2>
            <Pill tone={selected.status === 'planned' ? 'neutral' : 'warning'} compact>{t(`sources.status.${selected.status}`)}</Pill>
          </div>
          <p className="source-detail-text">{selected.description}</p>
          <p className="source-detail-text" style={{ marginTop: 8 }}>
            {selected.recordsIn === null
              ? selected.status === 'planned' ? t('sources.noRecords') : selected.granularity
              : t('sources.records', {
                  in: formatNumber(selected.recordsIn), mapped: formatNumber(selected.recordsMapped ?? 0),
                  rejected: formatNumber(selected.recordsIn - (selected.recordsMapped ?? 0)),
                })}
          </p>
          <p className="source-mode">{t(`sources.mode.${sources.data.mode}`)}</p>
        </section>
      )}
    </div>
  )
}
