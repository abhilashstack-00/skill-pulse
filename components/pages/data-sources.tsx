'use client'

import { useState } from 'react'
import { ApiError, getIngest, getSources, postIngest, type IngestResult } from '@/lib/client/api'
import { formatDate, formatNumber } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { PageHeader } from '@/components/layout/page-header'
import { Button, EmptyState, ErrorState, LoadingState, Pill, SectionCard } from '@/components/ui/primitives'

const COLUMNS = [
  { label: 'sources.col.source', width: '26%' },
  { label: 'sources.col.coverage', width: '19%' },
  { label: 'sources.col.updated', width: '13%' },
  { label: 'sources.col.granularity', width: '20%' },
  { label: 'sources.col.feeds', width: 'auto' },
]

export function DataSourcesPage() {
  const { t, locale } = useI18n()
  const [reload, setReload] = useState(0)
  const sources = useService(getSources, [reload])
  const ingest = useService(getIngest, [reload])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [synthetic, setSynthetic] = useState(true)
  const [countLoose, setCountLoose] = useState(false)
  const [monthFirst, setMonthFirst] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<IngestResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const list = sources.data?.sources ?? []
  const selected = list.find((s) => s.id === selectedId) ?? list[0]
  const spec = ingest.data?.specs.find((x) => x.id === selected?.id) ?? null
  const runs = (ingest.data?.runs ?? []).filter((run) => run.sourceId === selected?.id)

  const select = (id: string) => {
    setSelectedId(id)
    setFile(null)
    setResult(null)
    setFailure(null)
  }

  const send = async (dryRun: boolean) => {
    if (!file || !selected) return
    setBusy(true)
    setFailure(null)
    try {
      const outcome = await postIngest({ source: selected.id, file, mode, synthetic, countLoose, monthFirst, dryRun })
      setResult(outcome)
      if (outcome.written) {
        setFile(null)
        setReload((n) => n + 1)
      }
    } catch (error) {
      setResult(null)
      setFailure(error instanceof ApiError ? error.message : t('common.errorTitle'))
    } finally {
      setBusy(false)
    }
  }

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
                    onClick={() => select(source.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        select(source.id)
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
            <Pill tone={selected.status === 'planned' ? 'neutral' : selected.status === 'uploaded' ? 'primary' : 'warning'} compact>{t(`sources.status.${selected.status}`)}</Pill>
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

          {selected.latestRun && selected.latestRun.valueRead !== null && selected.latestRun.valueRead > 0 && (
            <p className="source-detail-text" style={{ marginTop: 8 }}>
              {t('sources.volume', {
                mapped: formatNumber(selected.latestRun.valueMapped ?? 0), read: formatNumber(selected.latestRun.valueRead),
                share: formatNumber((100 * (selected.latestRun.valueMapped ?? 0)) / selected.latestRun.valueRead, 1),
              })}
              {selected.latestRun.rowsHeld > 0 ? ` ${t('sources.held', { rows: formatNumber(selected.latestRun.rowsHeld) })}` : ''}
            </p>
          )}

          {selected.latestRun && (selected.latestRun.rejects?.length || selected.latestRun.looseMatchList?.length) ? (
            <div className="ingest-report">
              {reportLists(selected.latestRun.rejects ?? [], selected.latestRun.looseMatchList ?? [], selected.latestRun.rejectKinds, selected.latestRun.looseKinds, selected.latestRun.looseMatches)}
            </div>
          ) : null}

          {runs.length > 0 && (
            <>
              <h3 className="drawer-section-title">{t('sources.runs')}</h3>
              <ul className="evidence-sources" style={{ marginTop: 0 }}>
                {runs.map((run) => (
                  <li className="evidence-source" key={run.id}>
                    <span>
                      <strong>#{run.id}{run.fileName ? ` · ${run.fileName}` : ''}</strong>
                      <span>
                        {t('sources.records', { in: formatNumber(run.rowsRead), mapped: formatNumber(run.rowsMapped), rejected: formatNumber(run.rowsRejected) })}
                        {' · '}{t(`sources.runMode.${run.mode}`)} · {t(run.synthetic ? 'sources.status.prototype_synthetic' : 'sources.status.uploaded')}
                        {run.loadedBy ? ` · ${run.loadedBy}` : ''}
                      </span>
                    </span>
                    <span>{formatDate(run.loadedAt.slice(0, 10), locale)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {ingest.data?.canLoad && spec && (
            <form
              className="ingest-form"
              onSubmit={(event) => {
                event.preventDefault()
                void send(true)
              }}
            >
              <h3 className="drawer-section-title">{t('sources.load.title')}</h3>
              <p className="source-detail-text">{t('sources.load.columns', { columns: spec.columns.join(', ') })}</p>
              {!ingest.data.writable && <p className="source-mode">{t('sources.load.bundled')}</p>}
              <div className="ingest-fields">
                <label className="field">
                  {t('sources.load.file')}
                  <input
                    type="file" accept=".csv,text/csv" key={`${selected.id}-${reload}`}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null)
                      setResult(null)
                      setFailure(null)
                    }}
                  />
                </label>
                <label className="field">
                  {t('sources.load.mode')}
                  <select value={mode} onChange={(event) => setMode(event.target.value === 'replace' ? 'replace' : 'merge')}>
                    <option value="merge">{t('sources.load.merge')}</option>
                    <option value="replace">{t('sources.load.replace')}</option>
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={synthetic} onChange={(event) => setSynthetic(event.target.checked)} />
                  {t('sources.load.synthetic')}
                </label>
                <label className="check">
                  <input type="checkbox" checked={countLoose} onChange={(event) => { setCountLoose(event.target.checked); setResult(null) }} />
                  {t('sources.load.countLoose')}
                </label>
                <label className="check">
                  <input type="checkbox" checked={monthFirst} onChange={(event) => { setMonthFirst(event.target.checked); setResult(null) }} />
                  {t('sources.load.monthFirst')}
                </label>
              </div>
              <div className="ingest-actions">
                <Button type="submit" variant="secondary" disabled={!file || busy}>{busy ? t('common.loading') : t('sources.load.check')}</Button>
                <Button disabled={!file || busy || !ingest.data.writable || !result || result.written || result.report.rowsMapped === 0} onClick={() => void send(false)}>
                  {t('sources.load.commit')}
                </Button>
              </div>
              {failure && <p className="form-error" role="alert">{failure}</p>}
              {result && (
                <div className="ingest-report" role="status">
                  <p className="source-detail-text">
                    <strong>{t(result.written ? 'sources.load.written' : 'sources.load.checked')}</strong>{' '}
                    {t('sources.load.summary', {
                      read: formatNumber(result.report.rowsRead), mapped: formatNumber(result.report.rowsMapped), rejected: formatNumber(result.report.rowsRejected),
                      pairs: result.report.pairs, from: result.report.periodMin ?? '—', to: result.report.periodMax ?? '—',
                    })}
                    {result.report.rowsLooselyMatched > 0 && ` ${t(result.report.looseMatches === 'hold' ? 'sources.load.looseHeld' : 'sources.load.looseCounted', { rows: formatNumber(result.report.rowsLooselyMatched) })}`}
                    {result.report.duplicateRows > 0 && ` ${t('sources.load.duplicates', { rows: formatNumber(result.report.duplicateRows) })}`}
                    {result.report.valueRead !== null && result.report.valueRead > 0 && ` ${t('sources.volume', {
                      mapped: formatNumber(result.report.valueMapped ?? 0), read: formatNumber(result.report.valueRead),
                      share: formatNumber((100 * (result.report.valueMapped ?? 0)) / result.report.valueRead, 1),
                    })}`}
                    {result.replaces > 0 && ` ${t(result.written ? 'sources.load.replaced' : 'sources.load.willReplace', { count: formatNumber(result.replaces) })}`}
                    {result.written && result.derivedRefreshed === false && ` ${t('sources.load.derivedStale')}`}
                  </p>
                  {reportLists(result.report.rejects, result.report.looseMatchList, result.report.rejectKinds, result.report.looseKinds, result.report.looseMatches)}
                </div>
              )}
            </form>
          )}
        </section>
      )}
    </div>
  )

  /** What was refused and why, and what was matched by a looser rule than an exact alias. */
  function reportLists(
    rejects: { reason: string; example: string; count: number; value: number | null }[],
    loose: { raw: string; mappedTo: string; method: string; score: number; count: number; value: number | null }[],
    rejectKinds: number,
    looseKinds: number,
    policy: 'hold' | 'count',
  ) {
    return (
      <>
        {rejects.length > 0 && (
          <>
            <h4 className="ingest-list-title">{t('sources.report.rejected')}</h4>
            <ul className="ingest-list">
              {rejects.map((r) => (
                <li key={`${r.reason}:${r.example}`}><span>{r.example}</span><span>{t(`sources.reject.${r.reason}`)}</span><strong>{formatNumber(r.count)}{r.value ? ` · ${formatNumber(r.value)}` : ''}</strong></li>
              ))}
            </ul>
            {rejectKinds > rejects.length && <p className="source-mode">{t('sources.report.more', { count: formatNumber(rejectKinds - rejects.length) })}</p>}
          </>
        )}
        {loose.length > 0 && (
          <>
            <h4 className="ingest-list-title">{t(policy === 'hold' ? 'sources.report.looseHeld' : 'sources.report.loose')}</h4>
            <ul className="ingest-list">
              {loose.map((m) => (
                <li key={`${m.method}:${m.raw}`}><span>{m.raw} → {m.mappedTo}</span><span>{t(`sources.match.${m.method}`)} · {formatNumber(m.score, 2)}</span><strong>{formatNumber(m.count)}{m.value ? ` · ${formatNumber(m.value)}` : ''}</strong></li>
              ))}
            </ul>
            {looseKinds > loose.length && <p className="source-mode">{t('sources.report.more', { count: formatNumber(looseKinds - loose.length) })}</p>}
          </>
        )}
      </>
    )
  }
}
