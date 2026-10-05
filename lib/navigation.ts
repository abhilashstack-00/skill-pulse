import type { MessageKey } from '@/lib/i18n/translate'

export interface NavItem {
  label: MessageKey
  href: string
  /** Shown only to roles that may see planner recommendations. */
  plannerOnly?: boolean
}

export const navItems: NavItem[] = [
  { label: 'nav.overview', href: '/' },
  { label: 'nav.marketExplorer', href: '/market-explorer' },
  { label: 'nav.skillIntelligence', href: '/skill-intelligence' },
  { label: 'nav.gapAnalysis', href: '/gap-analysis' },
  { label: 'nav.forecasts', href: '/forecasts' },
  { label: 'nav.actionCenter', href: '/action-center', plannerOnly: true },
  { label: 'nav.methodology', href: '/methodology' },
  { label: 'nav.dataSources', href: '/data-sources' },
]
