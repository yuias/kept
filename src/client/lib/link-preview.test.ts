import { describe, expect, it, vi } from 'vitest'
import type { LinkPreview } from '../../shared/types'
import { loadLinkPreview, peekLinkPreview, proxiedImageSrc } from './link-preview'

// The memo is module-level, so each test uses its own URL.
function preview(url: string, status: LinkPreview['status'] = 'ok'): LinkPreview {
  return {
    status,
    url,
    finalUrl: url,
    title: status === 'ok' ? 'Title' : null,
    description: null,
    siteName: null,
    image: null,
    favicon: null,
  }
}

describe('loadLinkPreview', () => {
  it('calls the fetcher once for concurrent requests to one URL', async () => {
    const url = 'https://concurrent.example/'
    const fetcher = vi.fn().mockResolvedValue(preview(url))

    const [first, second] = await Promise.all([loadLinkPreview(url, fetcher), loadLinkPreview(url, fetcher)])

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('makes the preview available to peek only after it resolves', async () => {
    const url = 'https://peek.example/'
    const value = preview(url)
    const fetcher = vi.fn().mockResolvedValue(value)

    const loading = loadLinkPreview(url, fetcher)
    expect(peekLinkPreview(url)).toBeUndefined()
    await loading
    expect(peekLinkPreview(url)).toBe(value)

    await loadLinkPreview(url, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('retries after a rejected fetch', async () => {
    const url = 'https://retry.example/'
    const failure = new Error('network')
    const fetcher = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(preview(url))

    await expect(loadLinkPreview(url, fetcher)).rejects.toBe(failure)
    expect(peekLinkPreview(url)).toBeUndefined()
    await expect(loadLinkPreview(url, fetcher)).resolves.toMatchObject({ status: 'ok' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('memoizes a failed preview', async () => {
    const url = 'https://failed.example/'
    const fetcher = vi.fn().mockResolvedValue(preview(url, 'failed'))

    await loadLinkPreview(url, fetcher)
    await loadLinkPreview(url, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(peekLinkPreview(url)?.status).toBe('failed')
  })
})

describe('proxiedImageSrc', () => {
  it('encodes the image URL into the url query parameter', () => {
    const src = proxiedImageSrc('https://a.example/x?y=1&z')
    expect(src).toBe('/api/fetch-image?url=https%3A%2F%2Fa.example%2Fx%3Fy%3D1%26z')
    expect(new URL(src, 'https://app.example').searchParams.get('url')).toBe('https://a.example/x?y=1&z')
  })
})
