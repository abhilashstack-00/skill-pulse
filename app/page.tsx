import type { Metadata } from 'next'
import { OverviewPage } from '@/components/pages/overview'

export const metadata: Metadata = { title: 'Overview · SkillPulse' }

export default function Page() {
  return <OverviewPage />
}
