'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { getMethodology } from '@/lib/client/api'
import { formatNumber } from '@/lib/format'
import { useService } from '@/lib/hooks/use-service'
import { useI18n } from '@/lib/i18n/context'
import { PageHeader } from '@/components/layout/page-header'
import { ErrorState, LoadingState, Pill, SectionCard } from '@/components/ui/primitives'

const STEPS = ['data', 'normalize', 'measure', 'forecast', 'prioritize', 'recommend'] as const

export function MethodologyPage() {
  const { t } = useI18n()
  const methodology = useService(getMethodology, [])
  const [step, setStep] = useState<(typeof STEPS)[number]>('recommend')
  const data = methodology.data

  return (
    <div className="page">
      <PageHeader title="method.title" subtitle="method.subtitle" />

      {methodology.status === 'error' ? (
        <SectionCard style={{ marginTop: 62 }}><ErrorState error={methodology.error} onRetry={methodology.retry} /></SectionCard>
      ) : !data ? (
        <SectionCard style={{ marginTop: 62 }}><LoadingState height={420} /></SectionCard>
      ) : (
        (() => {
          const m = data.methodology
          const pct = (weight: number) => `${Math.round(weight * 100)}%`
          const weights = (title: string, id: string, entries: Record<string, number>, note?: string) => (
            <SectionCard className="weights-card" aria-labelledby={id}>
              <h2 className="card-title" id={id}>{title}</h2>
              <dl className="weights-rows" style={{ marginBottom: 0 }}>
                {Object.entries(entries).map(([key, weight]) => (
                  <div className="kv-row weights-row" key={key}>
                    <dt className="kv-label">{t(`comp.${key}`)}</dt>
                    <dd className="kv-value" style={{ marginLeft: 0 }}>{pct(weight)}</dd>
                  </div>
                ))}
              </dl>
              {note && <p className="weights-note">{note}</p>}
            </SectionCard>
          )
          const g = m.gapThresholds
          return (
            <>
              <ol className="pipeline" aria-label={t('method.title')}>
                {STEPS.map((id, index) => (
                  <li className="pipeline-item" key={id}>
                    {index > 0 && <span className="pipeline-arrow" aria-hidden="true"><ArrowRight /></span>}
                    <button type="button" className="pipeline-step" aria-pressed={id === step} onClick={() => setStep(id)}>
                      {t(`method.step.${id}`)}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="pipeline-note" aria-live="polite">
                <strong>{t('method.stepLabel', { n: STEPS.indexOf(step) + 1, label: t(`method.step.${step}`) })}</strong> {t(`method.step.${step}.text`)}
              </p>

              <div className="split method-row">
                {weights(t('method.demandIndex'), 'demand-weights', m.demandIndex.weights)}
                {weights(t('method.supplyIndex'), 'supply-weights', m.supplyIndex.weights)}
              </div>
              <p className="weights-note" style={{ marginTop: 14 }}>
                {t('method.scaling', {
                  percentile: m.normalization.referencePercentile, months: m.demandIndex.smoothingMonths,
                  postings: formatNumber(data.references.jobPostings, 0), registrations: formatNumber(data.references.employmentRegistrations, 0), seats: formatNumber(data.references.seats, 0),
                })}
              </p>

              <section className="formula-card" aria-labelledby="formula-title">
                <h2 className="formula-title" id="formula-title">{t('method.formula')}</h2>
                <p className="formula-note">{t('method.formulaNote')}</p>
                <p className="formula-thresholds">
                  <span><strong>{t('status.severe_shortage')}</strong> ≥ +{g.severeShortage}%</span>
                  <span><strong>{t('status.shortage')}</strong> +{g.shortage}% … +{g.severeShortage}%</span>
                  <span><strong>{t('status.balanced')}</strong> −{Math.abs(g.oversupply)}% … +{g.shortage}%</span>
                  <span><strong>{t('status.oversupply')}</strong> −{Math.abs(g.severeOversupply)}% … −{Math.abs(g.oversupply)}%</span>
                  <span><strong>{t('status.severe_oversupply')}</strong> ≤ −{Math.abs(g.severeOversupply)}%</span>
                </p>
              </section>

              <div className="split method-row method-section">
                {weights(
                  t('method.priority'), 'priority-weights', m.priority.weights,
                  `${t('method.priority.gapSaturation', { value: m.priority.gapSaturationPct })} ${t('method.priority.growthSaturation', { value: m.priority.growthSaturationPct })} ${t('method.priority.bands', { high: m.priority.bands.high, medium: m.priority.bands.medium })} ${t('common.notOfficial')}`,
                )}
                <SectionCard className="weights-card" aria-labelledby="alert-rules">
                  <h2 className="card-title" id="alert-rules">{t('method.alerts')}</h2>
                  <ul className="rule-list">
                    <li>{t('method.alerts.emerging', { growth: m.alerts.rapidDemandGrowthPct, flat: m.alerts.flatCapacityPct })}</li>
                    <li>{t('method.alerts.oversupply', { capacity: m.alerts.capacityGrowthPct, decline: m.alerts.demandDeclinePct })}</li>
                    <li>{t('method.alerts.upcoming')}</li>
                    <li>{t('method.alerts.monitor', { margin: m.alerts.monitorMarginPct })}</li>
                  </ul>
                </SectionCard>
              </div>

              <SectionCard className="method-card" aria-labelledby="forecast-method">
                <h2 className="card-title" id="forecast-method">{t('method.forecast')}</h2>
                <p className="method-text">
                  {t('method.forecast.text', {
                    baseline: m.forecast.baselineWindow, trend: m.forecast.trendWindow, trendWeight: Math.round(m.forecast.trendWeight * 100), growthWeight: Math.round((1 - m.forecast.trendWeight) * 100),
                    damping: m.forecast.growthDamping, minTrend: m.forecast.minMonthsTrend, minBaseline: m.forecast.minMonthsBaseline,
                  })}
                </p>
                <p className="method-text">
                  {t('method.interval.text', {
                    coverage: Math.round(m.forecast.coverage * 100), extrapolation: Math.round(m.forecast.extrapolationUncertainty * 100),
                    zero: Math.round(m.forecast.confidence.zeroAtRelativeWidth * 100), high: m.forecast.confidence.high, medium: m.forecast.confidence.medium,
                    capShort: m.forecast.confidence.capLimitedHistory, capBaseline: m.forecast.confidence.capBaselineEstimate,
                  })}
                </p>
                <h3 className="drawer-section-title">{t('method.backtest')}</h3>
                <table className="method-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('method.backtest.col.horizon')}</th>
                      <th scope="col">{t('method.backtest.col.pairs')}</th>
                      <th scope="col">{t('method.backtest.col.samples')}</th>
                      <th scope="col">{t('method.backtest.col.wape')}</th>
                      <th scope="col">{t('method.backtest.col.factor')}</th>
                      <th scope="col">{t('method.backtest.col.holdout', { coverage: Math.round(m.forecast.coverage * 100) })}</th>
                      <th scope="col">{t('method.backtest.col.correlation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.backtest.map((b) => (
                      <tr key={b.horizon}>
                        <td>{t(`horizon.${b.horizon}`)}</td>
                        <td>{b.cells}</td>
                        <td>{formatNumber(b.samples)}</td>
                        <td>{b.wape === null ? '—' : `${formatNumber(b.wape, 1)}%`}</td>
                        <td>{b.calibrationFactor === null ? '—' : `× ${formatNumber(b.calibrationFactor, 2)}`}</td>
                        <td>{b.holdoutCoverage === null ? t('method.backtest.notPossible') : `${formatNumber(b.holdoutCoverage, 1)}% (${formatNumber(b.holdoutSamples)})`}</td>
                        <td>{b.errorCorrelation === null ? '—' : `${formatNumber(b.errorCorrelation, 2)} → ${formatNumber(data.calibration[b.horizon].errorCorrelation, 2)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="method-text">{t('method.backtest.note', { coverage: Math.round(m.forecast.coverage * 100), rho: m.group.minErrorCorrelation })}</p>
                <h3 className="drawer-section-title">{t('method.groups')}</h3>
                <p className="method-text">{t('method.groups.text', { share: m.group.materialSharePct, rho: m.group.minErrorCorrelation })}</p>
                <p className="method-text">
                  <Pill tone="neutral" compact>{t('common.prototypeThresholds')}</Pill> &nbsp;{t('method.version', { version: m.version })} · {m.forecast.modelVersion} · {m.supplyForecast.modelVersion}
                </p>
              </SectionCard>

              <SectionCard className="method-card" aria-labelledby="normalization-title">
                <h2 className="card-title" id="normalization-title">{t('method.normalization')}</h2>
                <p className="method-text">{t('method.normalization.text', { spelling: Math.round(data.matching.fuzzyThreshold * 100), word: Math.round(data.matching.wordThreshold * 100) })}</p>
                <p className="method-text">{t('method.normalization.quality', { share: m.dataQuality.minVolumeSharePct, large: m.dataQuality.largeRejectSharePct })}</p>
                <h3 className="drawer-section-title">{t('method.confidence')}</h3>
                <p className="method-text">
                  {t('method.confidence.text', {
                    zero: Math.round(m.forecast.confidence.zeroAtRelativeWidth * 100), window: m.forecast.trendWindow, minTrend: m.forecast.minMonthsTrend, minBaseline: m.forecast.minMonthsBaseline,
                    capShort: m.forecast.confidence.capLimitedHistory, capBaseline: m.forecast.confidence.capBaselineEstimate, stale: m.forecast.staleAfterMonths,
                  })}
                </p>
              </SectionCard>

              <SectionCard className="method-card" aria-labelledby="limits-title">
                <h2 className="card-title" id="limits-title">{t('method.limits')}</h2>
                <p className="method-text"><strong>{t('sources.statement')}</strong></p>
                <ul className="rule-list">
                  <li>{t('method.limits.assumptions')}</li>
                  <li>{t('method.limits.coverage', data.coverage)}</li>
                  <li>{t('method.limits.supply')}</li>
                  <li>{t('method.limits.demand')}</li>
                  <li>{t('method.limits.forecast')}</li>
                  <li>{t('method.limits.confidence')}</li>
                  <li>{t('method.limits.backtest')}</li>
                  <li>{t('method.limits.sources')}</li>
                </ul>
              </SectionCard>
            </>
          )
        })()
      )}
    </div>
  )
}
