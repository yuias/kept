import { describe, expect, it, vi } from 'vitest'
import { DAY_MS, trashCutoff } from '../../src/shared/retention'
import type { Note } from '../../src/shared/types'
import { purgeExpiredTrash } from '../../src/worker/trash-purge'
import { call, createTestEnv } from '../support/env'

type Env = ReturnType<typeof createTestEnv>

const DEV_OWNER = 'dev@localhost'
const NOW = 1_800_000_000_000

async function createNote(env: Env, body: Record<string, unknown> = {}): Promise<Note> {
  const response = await call(env, '/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Note
}

/** Creates a note through the API, then backdates trashed_at to `daysAgo` before NOW. */
async function createTrashed(env: Env, daysAgo: number, body: Record<string, unknown> = {}): Promise<Note> {
  const note = await createNote(env, body)
  await env.DB.prepare('UPDATE notes SET trashed_at = ? WHERE id = ?')
    .bind(NOW - daysAgo * DAY_MS, note.id)
    .run()
  return note
}

async function noteIds(env: Env, owner = DEV_OWNER): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT id FROM notes WHERE owner = ?').bind(owner).all<{ id: string }>()
  return results.map((row) => row.id)
}

async function labelNames(env: Env, owner = DEV_OWNER): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT name FROM labels WHERE owner = ? ORDER BY name').bind(owner).all<{ name: string }>()
  return results.map((row) => row.name)
}

async function setSettings(env: Env, owner: string, data: Record<string, unknown>): Promise<void> {
  await env.DB.prepare('INSERT INTO settings (owner, data, updated_at) VALUES (?, ?, ?)').bind(owner, JSON.stringify(data), NOW).run()
}

async function insertNote(env: Env, owner: string, id: string, trashedAt: number | null): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO notes (id, owner, title, body, format, pinned, archived, trashed_at, created_at, updated_at) VALUES (?, ?, '', '', 'formatted', 0, 0, ?, ?, ?)",
  )
    .bind(id, owner, trashedAt, NOW, NOW)
    .run()
}

describe('purgeExpiredTrash', () => {
  it('uses the 30-day default when no settings row exists', async () => {
    const env = createTestEnv()
    const old = await createTrashed(env, 31)
    const recent = await createTrashed(env, 29)
    const live = await createNote(env)

    const result = await purgeExpiredTrash(env.DB, NOW)

    expect(result).toEqual({ owners: 1, deleted: 1 })
    const remaining = await noteIds(env)
    expect(remaining).not.toContain(old.id)
    expect(remaining).toContain(recent.id)
    expect(remaining).toContain(live.id)
  })

  it('honors a stored retention of 7 days', async () => {
    const env = createTestEnv()
    await setSettings(env, DEV_OWNER, { trashRetentionDays: 7 })
    const old = await createTrashed(env, 8)
    const recent = await createTrashed(env, 6)

    const result = await purgeExpiredTrash(env.DB, NOW)

    expect(result.deleted).toBe(1)
    const remaining = await noteIds(env)
    expect(remaining).not.toContain(old.id)
    expect(remaining).toContain(recent.id)
  })

  it('skips owners whose retention is null and does not count them', async () => {
    const env = createTestEnv()
    await setSettings(env, DEV_OWNER, { trashRetentionDays: null })
    const ancient = await createTrashed(env, 400)

    const result = await purgeExpiredTrash(env.DB, NOW)

    expect(result).toEqual({ owners: 0, deleted: 0 })
    expect(await noteIds(env)).toContain(ancient.id)
  })

  it('removes labels used only by purged notes and keeps labels shared with a survivor', async () => {
    const env = createTestEnv()
    await createTrashed(env, 40, { labels: ['only-old', 'shared'] })
    await createNote(env, { labels: ['shared'] })

    await purgeExpiredTrash(env.DB, NOW)

    expect(await labelNames(env)).toEqual(['shared'])
  })

  it('purges owners independently with their own settings', async () => {
    const env = createTestEnv()
    const other = 'other@example.com'
    const third = 'third@example.com'
    await setSettings(env, other, { trashRetentionDays: 90 })
    await setSettings(env, third, { trashRetentionDays: null })
    const devOld = await createTrashed(env, 40)
    await insertNote(env, other, 'other-40d', NOW - 40 * DAY_MS)
    await insertNote(env, other, 'other-100d', NOW - 100 * DAY_MS)
    await insertNote(env, third, 'third-400d', NOW - 400 * DAY_MS)

    const result = await purgeExpiredTrash(env.DB, NOW)

    expect(result).toEqual({ owners: 2, deleted: 2 })
    expect(await noteIds(env)).not.toContain(devOld.id)
    expect(await noteIds(env, other)).toEqual(['other-40d'])
    expect(await noteIds(env, third)).toEqual(['third-400d'])
  })

  it('deletes a note trashed exactly at the cutoff', async () => {
    const env = createTestEnv()
    const note = await createNote(env)
    await env.DB.prepare('UPDATE notes SET trashed_at = ? WHERE id = ?').bind(trashCutoff(NOW, 30), note.id).run()
    const justAfter = await createNote(env)
    await env.DB.prepare('UPDATE notes SET trashed_at = ? WHERE id = ?')
      .bind(trashCutoff(NOW, 30) + 1, justAfter.id)
      .run()

    const result = await purgeExpiredTrash(env.DB, NOW)

    expect(result.deleted).toBe(1)
    expect(await noteIds(env)).toEqual([justAfter.id])
  })

  it('continues with other owners after a failure, then throws once', async () => {
    const env = createTestEnv()
    const broken = 'broken@example.com'
    // Unparseable settings JSON makes loadSettings throw for this owner only.
    await env.DB.prepare('INSERT INTO settings (owner, data, updated_at) VALUES (?, ?, ?)').bind(broken, '{not json', NOW).run()
    await insertNote(env, broken, 'broken-40d', NOW - 40 * DAY_MS)
    const old = await createTrashed(env, 40)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(purgeExpiredTrash(env.DB, NOW)).rejects.toThrow('trash purge failed for 1 owner(s)')
      expect(consoleError).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
    expect(await noteIds(env)).not.toContain(old.id)
  })
})
