import type { Metadata } from 'next'
import { ActionCenterPage } from '@/components/pages/action-center'

export const metadata: Metadata = { title: 'Action Center' }

export default function Page() {
  return <ActionCenterPage />
}
