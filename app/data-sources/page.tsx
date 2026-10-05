import type { Metadata } from 'next'
import { DataSourcesPage } from '@/components/pages/data-sources'

export const metadata: Metadata = { title: 'Data Sources' }

export default function Page() {
  return <DataSourcesPage />
}
