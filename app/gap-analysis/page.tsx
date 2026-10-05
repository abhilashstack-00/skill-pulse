import type { Metadata } from 'next'
import { GapAnalysisPage } from '@/components/pages/gap-analysis'

export const metadata: Metadata = { title: 'Gap Analysis' }

export default function Page() {
  return <GapAnalysisPage />
}
