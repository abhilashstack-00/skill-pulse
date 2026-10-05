import { NextResponse } from 'next/server'
import { authEnabled } from '@/lib/config/env'
import { createSupabaseServerClient, isEvaluatorAccount } from '@/lib/server/session'

export async function POST() {
  if (authEnabled) {
    const supabase = await createSupabaseServerClient()
    // The evaluator account is shared: several evaluators can be signed in to it at
    // once, so signing out ends this browser's session only. Every other account
    // keeps the default, which ends all of that user's sessions.
    const { data } = await supabase.auth.getUser()
    if (data.user && isEvaluatorAccount(data.user)) await supabase.auth.signOut({ scope: 'local' })
    else await supabase.auth.signOut()
  }
  return NextResponse.json({ ok: true })
}
