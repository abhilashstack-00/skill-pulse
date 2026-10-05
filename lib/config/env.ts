/** Environment configuration, read in one place. Server-only values never reach the browser. */
const value = (name: string): string | undefined => {
  const v = process.env[name]?.trim()
  return v ? v : undefined
}

const positiveNumber = (name: string, fallback: number): number => {
  const n = Number(value(name))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const env = {
  /** Direct PostgreSQL connection string (Supabase → Project settings → Database). Server only. */
  databaseUrl: value('DATABASE_URL'),
  supabaseUrl: value('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: value('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  /** Server only. Used to read profiles and, without DATABASE_URL, the data tables. */
  supabaseServiceRoleKey: value('SUPABASE_SERVICE_ROLE_KEY'),
  /** How long a computed snapshot is reused before the data is read again. */
  snapshotTtlSeconds: positiveNumber('SNAPSHOT_TTL_SECONDS', 300),
  /** API requests allowed per client per minute. */
  rateLimitPerMinute: positiveNumber('RATE_LIMIT_PER_MINUTE', 300),
}

/** Sign-in is enforced only when Supabase Auth is configured. */
export const authEnabled = Boolean(env.supabaseUrl && env.supabaseAnonKey)

/**
 * Demo mode: no sign-in, and the role is picked from a menu. It is on by
 * default while developing. A production build refuses to serve data without
 * sign-in unless DEMO_MODE=on says the open demo is intended.
 */
export const demoModeAllowed = !authEnabled && (process.env.NODE_ENV !== 'production' || value('DEMO_MODE') === 'on')

/**
 * In demo mode there are no users, so "administrator" is just a menu choice.
 * Changing stored data from such a session is refused unless DEMO_WRITES=on
 * says a throw-away database is in use.
 */
export const demoWritesAllowed = value('DEMO_WRITES') === 'on'
