import { NextResponse } from 'next/server'
import { authEnabled } from '@/lib/config/env'
import { createSupabaseServerClient } from '@/lib/server/session'

export async function POST() {
  if (authEnabled) {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  }
  return NextResponse.json({ ok: true })
}
