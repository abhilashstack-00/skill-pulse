export interface NavItem {
  label: string
  href: string
}

export const navItems: NavItem[] = [
  { label: 'Overview', href: '/' },
  { label: 'Market Explorer', href: '/market-explorer' },
  { label: 'Skill Intelligence', href: '/skill-intelligence' },
  { label: 'Gap Analysis', href: '/gap-analysis' },
  { label: 'Forecasts', href: '/forecasts' },
  { label: 'Action Center', href: '/action-center' },
  { label: 'Methodology', href: '/methodology' },
  { label: 'Data Sources', href: '/data-sources' },
]
