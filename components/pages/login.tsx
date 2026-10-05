'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useI18n } from '@/lib/i18n/context'
import { LOCALES } from '@/lib/i18n/translate'
import { Brand } from '@/components/layout/sidebar'
import { Button } from '@/components/ui/primitives'

export function LoginForm() {
  const { t, locale, setLocale } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFailed(false)
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setFailed(true)
      setBusy(false)
      return
    }
    // A full page load on purpose: every cached response belongs to the previous session or role.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/')
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand"><Brand /></div>
        <h1 className="login-title">{t('login.title')}</h1>
        <p className="login-subtitle">{t('login.subtitle')}</p>
        <label className="field">
          {t('login.email')}
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          {t('login.password')}
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {failed && <p className="form-error" role="alert">{t('login.error')}</p>}
        <Button type="submit" disabled={busy}>{busy ? t('login.submitting') : t('login.submit')}</Button>
        <p className="login-note">{t('login.note')}</p>
        <div className="lang-switch login-lang" role="group" aria-label={t('app.language')}>
          {LOCALES.map((option) => (
            <button key={option.value} type="button" lang={option.value} aria-pressed={locale === option.value} onClick={() => setLocale(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      </form>
    </main>
  )
}
