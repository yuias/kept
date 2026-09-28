import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBackup } from '../../src/worker/backup'
import { createTestEnv } from '../support/env'

const DAY_MS = 86_400_000
const DEFAULT_RETENTION_DAYS = 56

const SQL_DUMP = 'PRAGMA foreign_keys=OFF;\nCREATE TABLE notes (id TEXT);\n'

/** `import.meta.env.DEV` is true under vitest, so backups land under this prefix. */
const PREFIX = 'dev-backups/'

function withExportEnv(env: ReturnType<typeof createTestEnv>) {
  Object.assign(env, {
    D1_EXPORT_API_TOKEN: 'test-token',
    CLOUDFLARE_ACCOUNT_ID: 'acct-1',
    D1_DATABASE_ID: 'db-1',
  })
  return env
}

/** Answers the export poll with `complete` on the first call, and the dump download on any other URL. */
function stubImmediateExport(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const target = url.toString()
    if (target.includes('/d1/database/')) {
      return new Response(
        JSON.stringify({
          success: true,
          result: { status: 'complete', result: { signed_url: 'https://example.com/dump.sql' } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(SQL_DUMP, { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('runBackup', () => {
  it('throws before fetching anything when the export token is not set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const env = createTestEnv()
    await expect(runBackup(env, Date.UTC(2026, 8, 21))).rejects.toThrow(/D1_EXPORT_API_TOKEN/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exports, stores the dump under dev-backups/, and stamps its expiry', async () => {
    const fetchMock = stubImmediateExport()
    const env = withExportEnv(createTestEnv())
    const now = Date.UTC(2026, 8, 21)

    await runBackup(env, now)

    const exportCall = fetchMock.mock.calls[0]!
    const endpoint = exportCall[0].toString()
    expect(endpoint).toContain('/accounts/acct-1/')
    expect(endpoint).toContain('/d1/database/db-1/export')
    const init = exportCall[1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body as string)).toEqual({ output_format: 'polling' })

    const key = `${PREFIX}2026-09-21.sql`
    const stored = await env.BACKUPS.get(key)
    expect(stored).not.toBeNull()
    expect(await stored!.text()).toBe(SQL_DUMP)
    expect(stored!.httpMetadata?.contentType).toBe('application/sql')
    expect(stored!.customMetadata?.expiresAt).toBe(String(now + DEFAULT_RETENTION_DAYS * DAY_MS))
  })

  it('re-polls with the latest bookmark until the export completes', async () => {
    vi.useFakeTimers()

    let call = 0
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString()
      if (target.includes('/d1/database/')) {
        call++
        const body = JSON.parse((init?.body as string) ?? '{}')
        if (call === 1) {
          expect(body.current_bookmark).toBeUndefined()
          return new Response(
            JSON.stringify({ success: true, result: { status: 'running', at_bookmark: 'bm-1' } }),
            { status: 200 },
          )
        }
        expect(body.current_bookmark).toBe('bm-1')
        return new Response(
          JSON.stringify({
            success: true,
            result: { status: 'complete', result: { signed_url: 'https://example.com/dump.sql' } },
          }),
          { status: 200 },
        )
      }
      return new Response(SQL_DUMP, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const env = withExportEnv(createTestEnv())
    const resultPromise = runBackup(env, Date.UTC(2026, 8, 21))
    await vi.advanceTimersByTimeAsync(2_100)
    await resultPromise

    expect(call).toBe(2)
  })

  it('deletes a backup past its stamped expiry and keeps one still within it', async () => {
    const env = withExportEnv(createTestEnv())
    const now = Date.UTC(2026, 8, 21)

    await env.BACKUPS.put(`${PREFIX}2026-01-01.sql`, 'old', {
      customMetadata: { expiresAt: String(now - DAY_MS) },
    })
    await env.BACKUPS.put(`${PREFIX}2026-09-20.sql`, 'recent', {
      customMetadata: { expiresAt: String(now + DAY_MS) },
    })

    stubImmediateExport()
    await runBackup(env, now)

    expect(await env.BACKUPS.get(`${PREFIX}2026-01-01.sql`)).toBeNull()
    expect(await env.BACKUPS.get(`${PREFIX}2026-09-20.sql`)).not.toBeNull()
  })
})
