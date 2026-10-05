import type { Metadata } from 'next'
import { MarketExplorerPage } from '@/components/pages/market-explorer'

export const metadata: Metadata = { title: 'Market Explorer' }

export default function Page() {
  return <MarketExplorerPage />
}
