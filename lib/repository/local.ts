import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dataset } from '@/lib/domain/types'
import type { Profile, Repository } from './index'

/**
 * Reads the bundled pilot dataset (data/pilot/dataset.json), which is written
 * by the same ingest run that writes supabase/seed.sql. Used when no database
 * is configured, so the prototype can be demonstrated offline.
 */
export class LocalRepository implements Repository {
  readonly kind = 'local' as const

  async loadDataset(): Promise<Dataset> {
    const file = join(/* turbopackIgnore: true */ process.cwd(), 'data/pilot/dataset.json')
    return JSON.parse(await readFile(file, 'utf8')) as Dataset
  }

  async getProfile(): Promise<Profile | null> {
    return null
  }

  async visibleDistrictIds(): Promise<null> {
    return null
  }
}
