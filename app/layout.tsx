import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/inter'
import './globals.css'
import { AppShell } from '@/components/layout/app-shell'

export const metadata: Metadata = {
  title: { default: 'SkillPulse', template: '%s · SkillPulse' },
  description: 'Labour-market intelligence for workforce and training planning.',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
        {/* Analytics only loads on Vercel deployments, so local runs stay free of 404s. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  )
}
