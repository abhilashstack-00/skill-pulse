/** Environment configuration, read in one place. Server-only values never reach the browser. */
const value = (name: string): string | undefined => {
  const v = process.env[name]?.trim()
  return v ? v : undefined
}

export const env = {
  /** Direct PostgreSQL connection string (Supabase → Project settings → Database). Server only. */
  databaseUrl: value('DATABASE_URL'),
  supabaseUrl: value('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: value('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  /** Server only. Used to read profiles and, without DATABASE_URL, the data tables. */
  supabaseServiceRoleKey: value('SUPABASE_SERVICE_ROLE_KEY'),
  /** How long a computed snapshot is reused before the data is read again. */
  snapshotTtlSeconds: Number(value('SNAPSHOT_TTL_SECONDS') ?? 300),
}

/** Sign-in is enforced only when Supabase Auth is configured. */
export const authEnabled = Boolean(env.supabaseUrl && env.supabaseAnonKey)
