import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runBackup } from '../../src/worker/backup'
import { purgeExpiredLinkPreviews } from '../../src/worker/link-preview-repo'
import { TRASH_PURGE_CRON, runScheduled } from '../../src/worker/scheduled'
import { purgeExpiredTrash } from '../../src/worker/trash-purge'
import { createTestEnv } from '../support/env'

vi.mock('../../src/worker/backup')
vi.mock('../../src/worker/link-preview-repo')
vi.mock('../../src/worker/trash-purge')

const SCHEDULED_TIME = 1_800_000_000_000

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('runScheduled', () => {
  it('runs the trash purge for its cron and not the backup', async () => {
    const env = createTestEnv()
    await runScheduled(TRASH_PURGE_CRON, env, SCHEDULED_TIME)
    expect(purgeExpiredTrash).toHaveBeenCalledExactlyOnceWith(env.DB, SCHEDULED_TIME)
    expect(runBackup).not.toHaveBeenCalled()
  })

  it.each(['0 21 * * SUN', '5 4 * * *'])('runs the backup for cron %s and not the purge', async (cron) => {
    const env = createTestEnv()
    await runScheduled(cron, env, SCHEDULED_TIME)
    expect(runBackup).toHaveBeenCalledExactlyOnceWith(env, SCHEDULED_TIME)
    expect(purgeExpiredTrash).not.toHaveBeenCalled()
  })

  it('rethrows a purge failure', async () => {
    const failure = new Error('purge boom')
    vi.mocked(purgeExpiredTrash).mockRejectedValue(failure)
    await expect(runScheduled(TRASH_PURGE_CRON, createTestEnv(), SCHEDULED_TIME)).rejects.toBe(failure)
  })

  it('purges expired link previews on the purge cron', async () => {
    const env = createTestEnv()
    await runScheduled(TRASH_PURGE_CRON, env, SCHEDULED_TIME)
    expect(purgeExpiredLinkPreviews).toHaveBeenCalledExactlyOnceWith(env.DB, SCHEDULED_TIME)
  })

  it('does not purge link previews on the backup cron', async () => {
    await runScheduled('0 21 * * SUN', createTestEnv(), SCHEDULED_TIME)
    expect(purgeExpiredLinkPreviews).not.toHaveBeenCalled()
  })

  it('logs a link preview purge failure and resolves', async () => {
    const failure = new Error('preview boom')
    vi.mocked(purgeExpiredLinkPreviews).mockRejectedValue(failure)
    await expect(runScheduled(TRASH_PURGE_CRON, createTestEnv(), SCHEDULED_TIME)).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalledWith('link preview purge failed', failure)
  })

  it('still purges link previews when the trash purge fails', async () => {
    const failure = new Error('purge boom')
    vi.mocked(purgeExpiredTrash).mockRejectedValue(failure)
    const env = createTestEnv()
    await expect(runScheduled(TRASH_PURGE_CRON, env, SCHEDULED_TIME)).rejects.toBe(failure)
    expect(purgeExpiredLinkPreviews).toHaveBeenCalledExactlyOnceWith(env.DB, SCHEDULED_TIME)
  })

  it('rethrows the trash failure even when the link preview purge also fails', async () => {
    const failure = new Error('purge boom')
    vi.mocked(purgeExpiredTrash).mockRejectedValue(failure)
    vi.mocked(purgeExpiredLinkPreviews).mockRejectedValue(new Error('preview boom'))
    await expect(runScheduled(TRASH_PURGE_CRON, createTestEnv(), SCHEDULED_TIME)).rejects.toBe(failure)
  })

  it('rethrows a backup failure', async () => {
    const failure = new Error('backup boom')
    vi.mocked(runBackup).mockRejectedValue(failure)
    await expect(runScheduled('0 21 * * SUN', createTestEnv(), SCHEDULED_TIME)).rejects.toBe(failure)
  })
})

describe('wrangler.example.jsonc', () => {
  it('lists the backup cron and the purge cron', () => {
    const text = readFileSync('wrangler.example.jsonc', 'utf8')
    const crons = /"crons":\s*\[([^\]]*)\]/.exec(text)?.[1]
    expect(crons).toBeDefined()
    const listed = [...crons!.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(listed).toEqual(['0 21 * * SUN', TRASH_PURGE_CRON])
  })
})
