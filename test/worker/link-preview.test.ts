import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINK_PREVIEW_URL_MAX_CHARS } from '../../src/shared/limits'
import type { LinkPreview } from '../../src/shared/types'
import { readHead } from '../../src/worker/link-preview-read'
import { ANON, call, createTestEnv } from '../support/env'

// HTMLRewriter does not exist under node; the parsing itself is covered by
// link-preview-head.test.ts, so the reader is replaced here.
vi.mock('../../src/worker/link-preview-read', () => ({ readHead: vi.fn() }))

const readHeadMock = vi.mocked(readHead)

function preview(env: Parameters<typeof call>[0], url: string, headers: HeadersInit = {}): Promise<Response> {
  return call(env, `/api/link-preview?url=${encodeURIComponent(url)}`, { headers })
}

function htmlResponse(): Response {
  return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

beforeEach(() => {
  readHeadMock.mockReset()
  readHeadMock.mockResolvedValue({
    meta: { 'og:title': 'Hello', 'og:image': '/img/cover.png' },
    title: null,
    icons: [],
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('GET /api/link-preview', () => {
  it('resolves relative images against the final URL after a redirect', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === 'https://example.com/start'
        ? new Response(null, { status: 302, headers: { location: 'https://www.example.org/final/page' } })
        : htmlResponse(),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await preview(createTestEnv(), 'https://example.com/start')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
    const body = (await response.json()) as LinkPreview
    expect(body).toMatchObject({
      status: 'ok',
      url: 'https://example.com/start',
      finalUrl: 'https://www.example.org/final/page',
      title: 'Hello',
      image: 'https://www.example.org/img/cover.png',
      favicon: 'https://www.example.org/favicon.ico',
    })
  })

  it('sends only its own headers upstream and never the caller credentials', async () => {
    const fetchMock = vi.fn(async () => htmlResponse())
    vi.stubGlobal('fetch', fetchMock)

    await preview(createTestEnv(), 'https://example.com/', {
      cookie: 'CF_Authorization=secret',
      authorization: 'Bearer secret',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.redirect).toBe('manual')
    const headers = new Headers(init.headers)
    expect(headers.get('accept')).toBe('text/html')
    expect(headers.get('user-agent')).toContain('kept-link-preview')
    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('authorization')).toBe(false)
  })

  it('serves a repeated request from the cache', async () => {
    const fetchMock = vi.fn(async () => htmlResponse())
    vi.stubGlobal('fetch', fetchMock)
    const env = createTestEnv()

    const first = await preview(env, 'https://example.com/')
    const second = await preview(env, 'https://example.com/')
    expect(await second.json()).toEqual(await first.json())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readHeadMock).toHaveBeenCalledTimes(1)
  })

  it('refetches once the cached row has expired', async () => {
    const fetchMock = vi.fn(async () => htmlResponse())
    vi.stubGlobal('fetch', fetchMock)
    const env = createTestEnv()

    await preview(env, 'https://example.com/')
    await env.DB.prepare('UPDATE link_previews SET expires_at = ?').bind(Date.now() - 1).run()
    await preview(env, 'https://example.com/')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a non-HTML upstream as failed, cancels the body and caches the failure', async () => {
    const cancelSpy = vi.fn()
    const fetchMock = vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel: cancelSpy }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const env = createTestEnv()

    const response = await preview(env, 'https://example.com/data')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'failed', title: null, finalUrl: 'https://example.com/data' })
    expect(cancelSpy).toHaveBeenCalled()
    expect(readHeadMock).not.toHaveBeenCalled()

    await preview(env, 'https://example.com/data')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports an upstream error status as failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500, headers: { 'content-type': 'text/html' } })))

    const response = await preview(createTestEnv(), 'https://example.com/')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'failed' })
    expect(readHeadMock).not.toHaveBeenCalled()
  })

  it('reports a network error as failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))

    const response = await preview(createTestEnv(), 'https://example.com/')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'failed',
      url: 'https://example.com/',
      finalUrl: 'https://example.com/',
    })
  })

  it('reports a redirect to a blocked host as failed without fetching it', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await preview(createTestEnv(), 'https://example.com/redirect')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'failed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a head read failure as failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse()))
    readHeadMock.mockRejectedValue(new Error('connection reset'))

    const response = await preview(createTestEnv(), 'https://example.com/page')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'failed',
      finalUrl: 'https://example.com/page',
    })
  })

  it('rejects a blocked host with 400 and caches nothing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const env = createTestEnv()

    const response = await preview(env, 'http://localhost/')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'blocked_host' })
    expect(fetchMock).not.toHaveBeenCalled()

    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM link_previews').first<{ n: number }>()
    expect(rows!.n).toBe(0)
  })

  it('rejects a missing url with 400 invalid_url', async () => {
    const response = await call(createTestEnv(), '/api/link-preview')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_url' })
  })

  it('rejects an over-long url with 400', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const url = `https://example.com/${'a'.repeat(LINK_PREVIEW_URL_MAX_CHARS)}`
    const response = await preview(createTestEnv(), url)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an anonymous caller with 401', async () => {
    const response = await preview(createTestEnv(), 'https://example.com/', ANON)
    expect(response.status).toBe(401)
  })
})
