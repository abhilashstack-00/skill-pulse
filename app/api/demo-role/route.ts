import { NextResponse, type NextRequest } from 'next/server'
import { authEnabled } from '@/lib/config/env'
import { DEMO_ROLE_COOKIE, ROLES } from '@/lib/server/session'

/** Switches the demo role. Only available while sign-in is not configured. */
export async function POST(request: NextRequest) {
  if (authEnabled) return NextResponse.json({ error: 'Demo roles are disabled when sign-in is configured.' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { role?: string } | null
  const role = ROLES.find((r) => r === body?.role)
  if (!role) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 })
  const response = NextResponse.json({ role })
  response.cookies.set(DEMO_ROLE_COOKIE, role, { httpOnly: true, sameSite: 'lax', path: '/' })
  return response
}
