import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Runs before every page request. When Supabase Auth is configured it keeps
 * the session cookie fresh and sends signed-out visitors to /login.
 * Without Supabase it does nothing, so the pilot can run offline.
 * (API routes do their own check and answer 401 instead of redirecting.)
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.next()

  let response = NextResponse.next({ request })
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        for (const { name, value } of items) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of items) response.cookies.set(name, value, options)
      },
    },
  })
  const { data } = await supabase.auth.getUser()
  const onLogin = request.nextUrl.pathname === '/login'
  if (!data.user && !onLogin) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    return NextResponse.redirect(login)
  }
  if (data.user && onLogin) {
    const home = request.nextUrl.clone()
    home.pathname = '/'
    return NextResponse.redirect(home)
  }
  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)'],
}
