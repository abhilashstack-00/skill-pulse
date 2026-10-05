import { readFileSync } from 'node:fs'
import type { ConnectionOptions } from 'node:tls'

/**
 * TLS settings for a PostgreSQL connection string.
 *
 * - localhost: no TLS.
 * - DATABASE_CA_CERT set (path to the CA file from Supabase → Database settings →
 *   SSL configuration): encrypted and verified against that certificate.
 * - otherwise: encrypted but the server certificate is not verified, which is what
 *   `sslmode=require` does. Supabase signs with its own CA, so verification needs
 *   the file above. Set it for anything beyond a demo.
 */
export function pgSsl(connectionString: string): ConnectionOptions | undefined {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) return undefined
  const caPath = process.env.DATABASE_CA_CERT
  if (caPath) return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
  return { rejectUnauthorized: false }
}
