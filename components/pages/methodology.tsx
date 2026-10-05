'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { IndexWeight } from '@/lib/types'
import { useService } from '@/lib/hooks/use-service'
import { getMethodology } from '@/lib/services/skillpulse'
import { PageHeader } from '@/components/layout/page-header'
import { ErrorState, LoadingState, SectionCard } from '@/components/ui/primitives'

export function MethodologyPage() {
  const methodology = useService(getMethodology, [])
  const data = methodology.data
  const [stepId, setStepId] = useState<string | null>(null)
  const steps = data?.steps ?? []
  const active = steps.find((s) => s.id === stepId) ?? steps[steps.length - 1]

  return (
    <div className="page">
      <PageHeader title="Methodology" subtitle="How SkillPulse turns labour signals into planning decisions." />

      {methodology.status === 'error' ? (
        <SectionCard style={{ marginTop: 62 }}>
          <ErrorState text={methodology.error.message} onRetry={methodology.retry} />
        </SectionCard>
      ) : !data ? (
        <SectionCard style={{ marginTop: 62 }}>
          <LoadingState height={420} label="Loading methodology" />
        </SectionCard>
      ) : (
        <>
          <ol className="pipeline" aria-label="Pipeline steps">
            {steps.map((step, index) => (
              <li className="pipeline-item" key={step.id}>
                {index > 0 && <span className="pipeline-arrow" aria-hidden="true"><ArrowRight /></span>}
                <button type="button" className="pipeline-step" aria-pressed={step.id === active?.id} onClick={() => setStepId(step.id)}>
                  {step.label}
                </button>
              </li>
            ))}
          </ol>
          <p className="pipeline-note" aria-live="polite">
            {active && (
              <>
                <strong>Step {steps.indexOf(active) + 1} · {active.label}.</strong> {active.description}
              </>
            )}
          </p>

          <div className="split method-row">
            <WeightsCard id="demand-weights" title="Demand Index" weights={data.demandWeights} />
            <WeightsCard id="supply-weights" title="Supply Index" weights={data.supplyWeights} />
          </div>

          <section className="formula-card" aria-labelledby="formula-title">
            <h2 className="formula-title" id="formula-title">{data.formula.title}</h2>
            <p className="formula-note">{data.formula.note}</p>
            <p className="formula-thresholds">
              <span><strong>Shortage</strong> gap ≥ +{data.thresholds.balanced}</span>
              <span><strong>Balanced</strong> within ±{data.thresholds.balanced}</span>
              <span><strong>Surplus</strong> gap ≤ −{data.thresholds.balanced}</span>
              <span><strong>High priority</strong> gap size ≥ {data.thresholds.high}</span>
              <span><strong>Medium priority</strong> gap size ≥ {data.thresholds.medium}</span>
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function WeightsCard({ id, title, weights }: { id: string; title: string; weights: IndexWeight[] }) {
  return (
    <SectionCard className="weights-card" aria-labelledby={id}>
      <h2 className="card-title" id={id}>{title}</h2>
      <dl className="weights-rows" style={{ marginBottom: 0 }}>
        {weights.map((item) => (
          <div className="kv-row weights-row" key={item.label}>
            <dt className="kv-label">{item.label}</dt>
            <dd className="kv-value" style={{ marginLeft: 0 }}>{item.weight}%</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  )
}
