import { describe, expect, it } from 'vitest'
import type { LinkPreview } from '../../src/shared/types'
import { getCachedPreview, purgeExpiredLinkPreviews, putCachedPreview } from '../../src/worker/link-preview-repo'
import { createD1 } from '../support/d1'

const NOW = 1_800_000_000_000
const TTL = 60_000
const URL_A = 'https://a.example/'

function preview(title: string): LinkPreview {
  return {
    status: 'ok',
    url: URL_A,
    finalUrl: URL_A,
    title,
    description: null,
    siteName: null,
    image: 'https://a.example/i.png',
    favicon: null,
  }
}

describe('link preview repo', () => {
  it('returns what was stored', async () => {
    const db = createD1()
    await putCachedPreview(db, 'me', URL_A, preview('One'), NOW, TTL)
    expect(await getCachedPreview(db, 'me', URL_A, NOW + 1)).toEqual(preview('One'))
  })

  it('misses once expires_at is reached', async () => {
    const db = createD1()
    await putCachedPreview(db, 'me', URL_A, preview('One'), NOW, TTL)
    expect(await getCachedPreview(db, 'me', URL_A, NOW + TTL - 1)).not.toBeNull()
    expect(await getCachedPreview(db, 'me', URL_A, NOW + TTL)).toBeNull()
  })

  it('overwrites an existing row for the same owner and url', async () => {
    const db = createD1()
    await putCachedPreview(db, 'me', URL_A, preview('One'), NOW, TTL)
    await putCachedPreview(db, 'me', URL_A, preview('Two'), NOW + 10, TTL)
    expect(await getCachedPreview(db, 'me', URL_A, NOW + 20)).toEqual(preview('Two'))
    const { results } = await db.prepare('SELECT expires_at FROM link_previews').all<{ expires_at: number }>()
    expect(results).toEqual([{ expires_at: NOW + 10 + TTL }])
  })

  it('does not share rows across owners', async () => {
    const db = createD1()
    await putCachedPreview(db, 'me', URL_A, preview('One'), NOW, TTL)
    expect(await getCachedPreview(db, 'other', URL_A, NOW + 1)).toBeNull()
  })

  it('treats corrupt data as a miss', async () => {
    const db = createD1()
    await db
      .prepare('INSERT INTO link_previews (owner, url, data, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind('me', URL_A, '{not json', NOW, NOW + TTL)
      .run()
    expect(await getCachedPreview(db, 'me', URL_A, NOW + 1)).toBeNull()
  })

  it('purges only expired rows and returns the count', async () => {
    const db = createD1()
    await putCachedPreview(db, 'me', 'https://old1.example/', preview('a'), NOW, TTL)
    await putCachedPreview(db, 'other', 'https://old2.example/', preview('b'), NOW, TTL)
    await putCachedPreview(db, 'me', 'https://fresh.example/', preview('c'), NOW, TTL * 10)

    expect(await purgeExpiredLinkPreviews(db, NOW + TTL)).toBe(2)
    const { results } = await db.prepare('SELECT url FROM link_previews').all<{ url: string }>()
    expect(results).toEqual([{ url: 'https://fresh.example/' }])
  })
})
