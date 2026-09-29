import { isTrashRetentionDays, trashCutoff } from '../shared/retention'
import { emptyTrash } from './notes-repo'
import { loadSettings } from './settings-repo'

export interface PurgeResult {
  owners: number
  deleted: number
}

/** Applies each owner's trash retention. Owner failures are logged and rethrown as one error after all owners ran. */
export async function purgeExpiredTrash(db: D1Database, now: number): Promise<PurgeResult> {
  // Owners without a settings row use the default retention, so the trash
  // itself is the source of owners rather than the settings table.
  const { results } = await db.prepare('SELECT DISTINCT owner FROM notes WHERE trashed_at IS NOT NULL').all<{ owner: string }>()

  let owners = 0
  let deleted = 0
  let failures = 0
  for (const { owner } of results) {
    try {
      const { trashRetentionDays } = await loadSettings(db, owner)
      // Stored settings are not re-validated on read; never purge on a value
      // the settings API would have rejected.
      if (trashRetentionDays === null || !isTrashRetentionDays(trashRetentionDays)) continue
      owners += 1
      deleted += await emptyTrash(db, owner, trashCutoff(now, trashRetentionDays))
    } catch (error) {
      failures += 1
      console.error('trash purge failed', owner, error)
    }
  }

  if (failures > 0) throw new Error(`trash purge failed for ${failures} owner(s)`)
  return { owners, deleted }
}
