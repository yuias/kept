import type { LinkPreview } from '../shared/types'

/** The cached preview, or null when absent, expired or unreadable. */
export async function getCachedPreview(db: D1Database, owner: string, url: string, now: number): Promise<LinkPreview | null> {
  const row = await db
    .prepare('SELECT data FROM link_previews WHERE owner = ? AND url = ? AND expires_at > ?')
    .bind(owner, url, now)
    .first<{ data: string }>()
  if (row === null) return null

  try {
    return JSON.parse(row.data) as LinkPreview
  } catch {
    return null // treated as a miss; the next put overwrites the row
  }
}

export async function putCachedPreview(
  db: D1Database,
  owner: string,
  url: string,
  preview: LinkPreview,
  now: number,
  ttlMs: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO link_previews (owner, url, data, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner, url) DO UPDATE SET
         data = excluded.data, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    )
    .bind(owner, url, JSON.stringify(preview), now, now + ttlMs)
    .run()
}

/** Deletes expired rows for every owner; returns how many were removed. */
export async function purgeExpiredLinkPreviews(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare('DELETE FROM link_previews WHERE expires_at <= ?').bind(now).run()
  return result.meta.changes
}
