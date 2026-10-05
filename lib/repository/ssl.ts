import { readFileSync } from 'node:fs'
import type { ConnectionOptions } from 'node:tls'

/**
 * TLS settings for a PostgreSQL connection string.
 *
 * - localhost: no TLS.
 * - DATABASE_CA_CERT set (path to the CA file from Supabase → Database settings →
 *   SSL configuration): encrypted and verified against that certificate.
 * - DATABASE_SSL=no-verify: encrypted, server certificate NOT verified. An
 *   explicit choice for a quick demo; it does not protect against an impostor.
 * - otherwise: encrypted and verified against the system's certificate
 *   authorities. Supabase signs with its own CA, so a Supabase connection needs
 *   one of the two settings above; the error says so when it fails.
 */
export function pgSsl(connectionString: string): ConnectionOptions | undefined {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) return undefined
  const caPath = process.env.DATABASE_CA_CERT?.trim()
  if (caPath) return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
  if (process.env.DATABASE_SSL?.trim() === 'no-verify') return { rejectUnauthorized: false }
  return { rejectUnauthorized: true }
}

/** Turns a certificate failure into advice the person running the command can act on. */
export function explainTlsError(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code ?? ''
  if (!/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return null
  return [
    `The database certificate could not be verified (${code}).`,
    'Download the CA certificate from Supabase → Project settings → Database → SSL configuration and set DATABASE_CA_CERT to its path,',
    'or set DATABASE_SSL=no-verify to connect without verifying it (encrypted, but not protected against an impostor).',
  ].join('\n')
}
