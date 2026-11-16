import { describe, expect, it } from 'vitest'
import { imageView } from './nodes/image-node'

describe('imageView', () => {
  it('draws local images as images', () => {
    expect(imageView('/img/abc', 'photo')).toBe('local')
    expect(imageView('/img/abc', '')).toBe('local')
  })

  it('keeps external and unsafe targets as text', () => {
    expect(imageView('https://e.example/a.png', 'a')).toBe('external')
    expect(imageView('javascript:x', '')).toBe('external')
    expect(imageView('/img/a/b', '')).toBe('external')
    expect(imageView('//e.example/img/abc', '')).toBe('external')
  })

  it('recognises the upload placeholder by its empty target and alt', () => {
    expect(imageView('', 'uploading-00000000-0000-0000-0000-000000000000')).toBe('uploading')
    expect(imageView('', 'photo')).toBe('external')
    expect(imageView('/img/abc', 'uploading-x')).toBe('local')
    expect(imageView('https://e.example/a.png', 'uploading-x')).toBe('external')
  })
})
