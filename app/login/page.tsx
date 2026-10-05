import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { authEnabled, demoAccountAvailable } from '@/lib/config/env'
import { LoginForm } from '@/components/pages/login'

export const metadata: Metadata = { title: 'Sign in' }
export const dynamic = 'force-dynamic'

export default function Page() {
  // Without Supabase Auth there is nothing to sign in to: the pilot opens directly.
  if (!authEnabled) redirect('/')
  return <LoginForm demoAvailable={demoAccountAvailable} />
}
