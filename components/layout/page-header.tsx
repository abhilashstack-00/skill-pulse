'use client'

import { formatDate } from '@/lib/format'
import { useDataset } from './app-shell'

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const dataset = useDataset()
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {dataset && <p className="page-updated">Updated {formatDate(dataset.updatedAt)}</p>}
    </header>
  )
}
