'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { setDemoRole, signOut } from '@/lib/client/api'
import { cx } from '@/lib/format'
import { useI18n } from '@/lib/i18n/context'
import { LOCALES } from '@/lib/i18n/translate'
import { navItems } from '@/lib/navigation'
import { useMeta } from './app-shell'

const DEMO_ROLES = ['national_planner', 'state_planner', 'district_planner', 'employer', 'admin'] as const

export function Brand() {
  return (
    <>
      <span className="brand-mark" aria-hidden="true">S</span>
      <span className="brand-name">SkillPulse</span>
    </>
  )
}

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const pathname = usePathname()
  const { t, locale, setLocale } = useI18n()
  const { meta, failed, names } = useMeta()
  const session = meta?.session
  const scope = session?.districtId ? names.district(session.districtId) : session?.stateId ? names.state(session.stateId) : t('app.scope.all')

  return (
    <aside className={cx('sidebar', open && 'is-open')} id="sidebar">
      <Link href="/" className="brand" onClick={onNavigate} aria-label="SkillPulse">
        <Brand />
      </Link>
      <nav className="nav" aria-label={t('nav.primary')}>
        {navItems
          .filter((item) => !item.plannerOnly || !session || session.permissions.recommendations)
          .map((item) => {
            const current = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href} className="nav-item" aria-current={current ? 'page' : undefined} onClick={onNavigate}>
                {t(item.label)}
              </Link>
            )
          })}
      </nav>

      <div className="sidebar-foot">
        <div className="lang-switch" role="group" aria-label={t('app.language')}>
          {LOCALES.map((option) => (
            <button key={option.value} type="button" lang={option.value} aria-pressed={locale === option.value} onClick={() => setLocale(option.value)}>
              {option.label}
            </button>
          ))}
        </div>

        {session && (
          <div className="account">
            <div className="account-name">{session.demo ? t(`role.${session.role}`) : session.name}</div>
            <div className="account-role">
              {session.demo ? scope : `${t(`role.${session.role}`)} · ${scope}`}
            </div>
            {session.demo ? (
              <label className="account-demo">
                <span>{t('app.demoRole')}</span>
                <select
                  value={session.role}
                  title={t('app.demoHint')}
                  onChange={async (event) => {
                    await setDemoRole(event.target.value)
                    window.location.assign('/')
                  }}
                >
                  {DEMO_ROLES.map((role) => <option key={role} value={role}>{t(`role.${role}`)}</option>)}
                </select>
              </label>
            ) : (
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  await signOut()
                  window.location.assign('/login')
                }}
              >
                {t('app.signOut')}
              </button>
            )}
          </div>
        )}

        <div className="dataset-status">
          <div className="dataset-status-label">{t('app.dataset')}</div>
          <div className={cx('dataset-status-value', !meta && 'is-pending', failed && 'is-error')} title={t('app.syntheticHint')}>
            {meta ? t('app.datasetStatus', { mode: t(`app.mode.${meta.dataset.mode}`) }) : failed ? t('app.unavailable') : '…'}
          </div>
        </div>
      </div>
    </aside>
  )
}
