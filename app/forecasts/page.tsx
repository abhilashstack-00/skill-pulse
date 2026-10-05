import type { Metadata } from 'next'
import { ForecastsPage } from '@/components/pages/forecasts'

export const metadata: Metadata = { title: 'Forecasts' }

export default function Page() {
  return <ForecastsPage />
}
