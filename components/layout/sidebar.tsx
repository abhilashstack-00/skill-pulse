'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { navItems } from '@/lib/data/navigation'
import { cx } from '@/lib/format'

export function Brand() {
  return (
    <>
      <span className="brand-mark" aria-hidden="true">S</span>
      <span className="brand-name">SkillPulse</span>
    </>
  )
}

interface SidebarProps {
  open: boolean
  onNavigate: () => void
  dataset: { label: string; status: string } | undefined
  /** True when the dataset status could not be loaded. */
  unavailable?: boolean
}

export function Sidebar({ open, onNavigate, dataset, unavailable }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className={cx('sidebar', open && 'is-open')} id="sidebar">
      <Link href="/" className="brand" onClick={onNavigate} aria-label="SkillPulse home">
        <Brand />
      </Link>
      <nav className="nav" aria-label="Primary">
        {navItems.map((item) => {
          const current = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link key={item.href} href={item.href} className="nav-item" aria-current={current ? 'page' : undefined} onClick={onNavigate}>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="dataset-status">
        <div className="dataset-status-label">{dataset?.label ?? 'Pilot dataset'}</div>
        <div className={cx('dataset-status-value', !dataset && 'is-pending', unavailable && 'is-error')}>
          {dataset?.status ?? (unavailable ? 'Unavailable' : 'Loading…')}
        </div>
      </div>
    </aside>
  )
}
