export const DAY_MS = 86_400_000
export const TRASH_RETENTION_DEFAULT_DAYS = 30
export const TRASH_RETENTION_MAX_DAYS = 3650
/** Offered in Settings; the server accepts any integer in range. */
export const TRASH_RETENTION_PRESETS: readonly number[] = [7, 14, 30, 60, 90, 180, 365]

/** null = never auto-delete; otherwise an integer 1..TRASH_RETENTION_MAX_DAYS. */
export function isTrashRetentionDays(value: unknown): value is number | null {
  if (value === null) return true
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= TRASH_RETENTION_MAX_DAYS
  )
}

/** Notes trashed at or before this instant are due for deletion. */
export function trashCutoff(now: number, days: number): number {
  return now - days * DAY_MS
}
