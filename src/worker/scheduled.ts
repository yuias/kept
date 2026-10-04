import type { AppEnv } from './http'
import { runBackup } from './backup'
import { purgeExpiredLinkPreviews } from './link-preview-repo'
import { purgeExpiredTrash } from './trash-purge'

/** Daily at 18:00 UTC = JST 03:00. Must match wrangler.example.jsonc. */
export const TRASH_PURGE_CRON = '0 18 * * *'

// Only the purge string is matched and backup is the fallback, so a locally
// customized backup cron in wrangler.jsonc keeps working.
export async function runScheduled(cron: string, env: AppEnv, scheduledTime: number): Promise<void> {
  if (cron === TRASH_PURGE_CRON) {
    let trashError: unknown = null
    try {
      await purgeExpiredTrash(env.DB, scheduledTime)
    } catch (error) {
      console.error('trash purge failed', error)
      trashError = error
    }
    // Cache housekeeping must never hide or replace a trash purge failure.
    try {
      await purgeExpiredLinkPreviews(env.DB, scheduledTime)
    } catch (error) {
      console.error('link preview purge failed', error)
    }
    if (trashError !== null) throw trashError
    return
  }

  try {
    await runBackup(env, scheduledTime)
  } catch (error) {
    // Nothing notifies on a failed Cron Trigger, so the log and the errored
    // invocation in Cron Events are the only traces a failure leaves behind.
    console.error('backup failed', error)
    throw error
  }
}
