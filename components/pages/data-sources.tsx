'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useService } from '@/lib/hooks/use-service'
import { getDataSources } from '@/lib/services/skillpulse'
import { formatDate } from '@/lib/format'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState, ErrorState, LoadingState, Pill, SectionCard } from '@/components/ui/primitives'

const COLUMNS = [
  { label: 'Source', width: '22.55%' },
  { label: 'Coverage', width: '23.1%' },
  { label: 'Last Updated', width: '18.5%' },
  { label: 'Fields Used', width: '16.65%' },
  { label: 'Transformation', width: 'auto' },
]

function Flow({ steps }: { steps: [string, string] }) {
  return (
    <span className="flow">
      {steps[0]} <ArrowRight aria-label="to" /> {steps[1]}
    </span>
  )
}

export function DataSourcesPage() {
  const sources = useService(getDataSources, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const list = sources.data ?? []
  const selected = list.find((s) => s.id === selectedId) ?? list[0]

  return (
    <div className="page">
      <PageHeader title="Data Sources" subtitle="Make every insight traceable to a source, refresh date and transformation." />

      <SectionCard className="sources-card" aria-label="Source catalogue">
        {sources.status === 'error' ? (
          <ErrorState text={sources.error.message} onRetry={sources.retry} />
        ) : !sources.data ? (
          <LoadingState height={560} label="Loading source catalogue" />
        ) : list.length === 0 ? (
          <EmptyState title="No sources in the catalogue" text="Sources appear here once they are added to the pilot dataset." />
        ) : (
          <div className="table-scroll">
            <table className="data-table sources-table">
              <colgroup>
                {COLUMNS.map((column) => <col key={column.label} style={{ width: column.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.map((column) => <th key={column.label} scope="col">{column.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((source) => (
                  <tr
                    key={source.id}
                    tabIndex={0}
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
                      <span className="source-stage">{source.stage}</span>
                    </td>
                    <td>{source.coverage}</td>
                    <td>{formatDate(source.lastUpdated)}</td>
                    <td>{source.fieldsUsed.join(' · ')}</td>
                    <td><Flow steps={source.transformation} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {selected && (
        <section className="source-detail" aria-live="polite" aria-label="Selected source">
          <div className="source-detail-head">
            <h2 className="source-detail-title">Selected source · {selected.name}</h2>
            <Pill tone="neutral" compact>{selected.stage}</Pill>
          </div>
          <p className="source-detail-text">
            Coverage: {selected.coverageDetail} · refresh: {formatDate(selected.lastUpdated)} · transformation: <Flow steps={selected.transformationDetail} />
          </p>
          <p className="source-detail-text" style={{ marginTop: 8 }}>
            {selected.fullName} · feeds the {selected.role} index · no live connection in this prototype.
          </p>
        </section>
      )}
    </div>
  )
}
