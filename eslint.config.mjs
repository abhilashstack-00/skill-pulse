import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

/** Lint rules: the Next.js defaults (React, hooks, accessibility, Core Web Vitals) plus TypeScript. */
const config = [
  ...nextVitals,
  ...nextTypescript,
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'data/**', 'supabase/**', '.e2e/**'] },
]

export default config
