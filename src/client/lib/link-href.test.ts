import { describe, expect, it } from 'vitest'
import { linkHref } from './link-href'

describe('linkHref', () => {
  it.each([
    ['https://a.example/x', 'https://a.example/x'],
    ['HTTP://A.EXAMPLE', 'HTTP://A.EXAMPLE'],
    ['mailto:a@b.example', 'mailto:a@b.example'],
    ['<https://a.example>', 'https://a.example'],
    ['www.example.com', 'http://www.example.com'],
    ['a@b.example', 'mailto:a@b.example'],
  ])('allows %j', (raw, href) => {
    expect(linkHref(raw)).toBe(href)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://a.example', '/relative', '#frag', ''])(
    'rejects %j',
    (raw) => {
      expect(linkHref(raw)).toBeNull()
    },
  )
})
