import { NextResponse, type NextRequest } from 'next/server'
import { authEnabled, demoModeAllowed } from '@/lib/config/env'
import { DEMO_ROLE_COOKIE, ROLES } from '@/lib/server/session'

/** Switches the demo role. Only available while sign-in is not configured. */
export async function POST(request: NextRequest) {
  if (authEnabled || !demoModeAllowed) return NextResponse.json({ error: 'Demo roles are available only in demo mode.' }, { status: 404 })
  // Only this site's own pages may switch the role.
  const origin = request.headers.get('origin')
  if (origin !== null) {
    let sameSite = false
    try { sameSite = new URL(origin).host === request.headers.get('host') } catch { /* "null" or not a URL: refused */ }
    if (!sameSite) return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 })
  }
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ error: 'Send JSON.' }, { status: 415 })
  const body = (await request.json().catch(() => null)) as { role?: string } | null
  const role = ROLES.find((r) => r === body?.role)
  if (!role) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 })
  const response = NextResponse.json({ role })
  response.cookies.set(DEMO_ROLE_COOKIE, role, { httpOnly: true, sameSite: 'strict', path: '/', secure: request.nextUrl.protocol === 'https:' })
  return response
}
