import { Hono } from 'hono'
import { isConcreteFormat } from '../../shared/format'
import { isTrashRetentionDays } from '../../shared/retention'
import type { AppSettings, FolderSort } from '../../shared/types'
import { requireIdentity } from '../auth'
import { ApiException, ownerOf, readJson, type HonoEnv } from '../http'
import { loadSettings } from '../settings-repo'

export const settingsRoutes = new Hono<HonoEnv>()

const FOLDER_SORTS: readonly FolderSort[] = ['name', 'created', 'updated', 'manual']

function isFolderSort(value: unknown): value is FolderSort {
  return typeof value === 'string' && (FOLDER_SORTS as readonly string[]).includes(value)
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiException(400, 'bad_request', 'body must be a JSON object')
  }
  return value as Record<string, unknown>
}

settingsRoutes.get('/api/settings', requireIdentity, async (c) => {
  const owner = ownerOf(c)
  const settings = await loadSettings(c.env.DB, owner)
  return c.json(settings satisfies AppSettings)
})

settingsRoutes.put('/api/settings', requireIdentity, async (c) => {
  const owner = ownerOf(c)
  const raw = asObject(await readJson(c.req.raw))
  const current = await loadSettings(c.env.DB, owner)
  const next: AppSettings = { ...current }

  if ('defaultFormat' in raw) {
    if (!isConcreteFormat(raw.defaultFormat)) {
      throw new ApiException(400, 'bad_request', 'defaultFormat must be formatted or syntax')
    }
    next.defaultFormat = raw.defaultFormat
  }
  if ('folderSort' in raw) {
    if (!isFolderSort(raw.folderSort)) {
      throw new ApiException(400, 'bad_request', 'folderSort must be one of name, created, updated, manual')
    }
    next.folderSort = raw.folderSort
  }
  if ('trashRetentionDays' in raw) {
    if (!isTrashRetentionDays(raw.trashRetentionDays)) {
      throw new ApiException(400, 'bad_request', 'trashRetentionDays must be null or an integer from 1 to 3650')
    }
    next.trashRetentionDays = raw.trashRetentionDays
  }

  await c.env.DB.prepare(
    `INSERT INTO settings (owner, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(owner) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(owner, JSON.stringify(next), Date.now())
    .run()

  return c.json(next satisfies AppSettings)
})
