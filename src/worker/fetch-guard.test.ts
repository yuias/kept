import { describe, expect, it } from 'vitest'
import { isBlockedHost, validateFetchUrl } from './fetch-guard'

describe('isBlockedHost', () => {
  it('blocks reserved names', () => {
    expect(isBlockedHost('localhost')).toBe(true)
    expect(isBlockedHost('foo.localhost')).toBe(true)
    expect(isBlockedHost('box.local')).toBe(true)
    expect(isBlockedHost('box.internal')).toBe(true)
  })

  it('blocks a trailing-dot FQDN the same as its bare form', () => {
    expect(isBlockedHost('localhost.')).toBe(true)
    expect(isBlockedHost('foo.localhost.')).toBe(true)
  })

  it('blocks literal private/loopback/link-local/CGNAT IPv4 ranges', () => {
    expect(isBlockedHost('0.0.0.1')).toBe(true)
    expect(isBlockedHost('10.1.2.3')).toBe(true)
    expect(isBlockedHost('100.64.0.1')).toBe(true)
    expect(isBlockedHost('100.127.255.255')).toBe(true)
    expect(isBlockedHost('127.0.0.1')).toBe(true)
    expect(isBlockedHost('169.254.1.1')).toBe(true)
    expect(isBlockedHost('172.16.0.1')).toBe(true)
    expect(isBlockedHost('172.31.255.255')).toBe(true)
    expect(isBlockedHost('192.168.0.1')).toBe(true)
  })

  it('blocks 192.0.0.0/24, 198.18.0.0/15, multicast and 240/4 (incl. broadcast)', () => {
    expect(isBlockedHost('192.0.0.1')).toBe(true)
    expect(isBlockedHost('198.18.0.1')).toBe(true)
    expect(isBlockedHost('198.19.255.255')).toBe(true)
    expect(isBlockedHost('224.0.0.1')).toBe(true)
    expect(isBlockedHost('239.255.255.255')).toBe(true)
    expect(isBlockedHost('240.0.0.1')).toBe(true)
    expect(isBlockedHost('255.255.255.255')).toBe(true)
  })

  it('allows IPv4 addresses outside the blocked ranges', () => {
    expect(isBlockedHost('8.8.8.8')).toBe(false)
    expect(isBlockedHost('93.184.216.34')).toBe(false)
    expect(isBlockedHost('100.63.0.1')).toBe(false)
    expect(isBlockedHost('172.32.0.1')).toBe(false)
    expect(isBlockedHost('198.17.255.255')).toBe(false)
    expect(isBlockedHost('198.20.0.0')).toBe(false)
  })

  it('blocks single-label hostnames', () => {
    expect(isBlockedHost('metadata')).toBe(true)
    expect(isBlockedHost('printer')).toBe(true)
  })

  it('blocks literal IPv6 loopback, unspecified, ULA, link-local and site-local addresses', () => {
    expect(isBlockedHost('[::1]')).toBe(true)
    expect(isBlockedHost('[::]')).toBe(true)
    expect(isBlockedHost('[fc00::1]')).toBe(true)
    expect(isBlockedHost('[fd12:3456::1]')).toBe(true)
    expect(isBlockedHost('[fe80::1]')).toBe(true)
    expect(isBlockedHost('[fec0::1]')).toBe(true)
  })

  it('blocks IPv4-mapped IPv6 forms of blocked addresses', () => {
    expect(isBlockedHost('[::ffff:c0a8:1]')).toBe(true) // 192.168.0.1
    expect(isBlockedHost('[::ffff:192.168.0.1]')).toBe(true)
    expect(isBlockedHost('[::ffff:7f00:1]')).toBe(true) // 127.0.0.1
  })

  it('blocks a blocked IPv4 address embedded via IPv4-compatible (::a.b.c.d/96)', () => {
    expect(isBlockedHost('[::a01:203]')).toBe(true) // ::10.1.2.3
  })

  it('allows a public IPv4 address embedded via IPv4-compatible (::a.b.c.d/96)', () => {
    expect(isBlockedHost('[::808:808]')).toBe(false) // ::8.8.8.8
  })

  it('blocks a blocked IPv4 address embedded via the NAT64 well-known prefix (64:ff9b::/96)', () => {
    expect(isBlockedHost('[64:ff9b::7f00:1]')).toBe(true) // embeds 127.0.0.1
  })

  it('allows a public IPv4 address embedded via the NAT64 well-known prefix (64:ff9b::/96)', () => {
    expect(isBlockedHost('[64:ff9b::808:808]')).toBe(false) // embeds 8.8.8.8
  })

  it('blocks a blocked IPv4 address embedded via 6to4 (2002::/16)', () => {
    expect(isBlockedHost('[2002:7f00:1::]')).toBe(true) // embeds 127.0.0.1
  })

  it('allows a public IPv4 address embedded via 6to4 (2002::/16)', () => {
    expect(isBlockedHost('[2002:808:808::]')).toBe(false) // embeds 8.8.8.8
  })

  it('blocks a blocked IPv4 address embedded via the SIIT form (::ffff:0:a.b.c.d/96)', () => {
    expect(isBlockedHost('[::ffff:0:7f00:1]')).toBe(true) // embeds 127.0.0.1
  })

  it('allows a public IPv4 address embedded via the SIIT form (::ffff:0:a.b.c.d/96)', () => {
    expect(isBlockedHost('[::ffff:0:808:808]')).toBe(false) // embeds 8.8.8.8
  })

  it('allows a public IPv6 address', () => {
    expect(isBlockedHost('[2606:4700:4700::1111]')).toBe(false)
  })

  it('allows a public hostname', () => {
    expect(isBlockedHost('example.com')).toBe(false)
  })
})

describe('validateFetchUrl', () => {
  it('accepts public http/https URLs', () => {
    expect(validateFetchUrl('https://example.com/cat.png')).toEqual({
      ok: true,
      url: new URL('https://example.com/cat.png'),
    })
    expect(validateFetchUrl('http://example.com/cat.png').ok).toBe(true)
  })

  it('rejects a malformed URL', () => {
    expect(validateFetchUrl('not a url').ok).toBe(false)
  })

  it('rejects non-http(s) schemes', () => {
    const result = validateFetchUrl('ftp://example.com/cat.png')
    expect(result.ok).toBe(false)
  })

  it('rejects credentials in the URL', () => {
    const result = validateFetchUrl('https://user:pass@example.com/cat.png')
    expect(result.ok).toBe(false)
  })

  it('rejects every blocked host with code blocked_host', () => {
    for (const raw of [
      'http://127.0.0.1',
      'http://[::1]',
      'http://10.1.2.3',
      'http://foo.localhost',
      'http://[::ffff:192.168.0.1]',
      'http://localhost.',
    ]) {
      const result = validateFetchUrl(raw)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.code).toBe('blocked_host')
    }
  })

  // The WHATWG URL parser normalizes alternate IPv4 notations (decimal,
  // shorthand) to dotted-decimal before `hostname` is ever read, so
  // `isBlockedHost` never has to parse those forms itself.
  it('normalizes decimal and shorthand IPv4 forms before the host check', () => {
    expect(validateFetchUrl('http://2130706433/').ok).toBe(false) // 127.0.0.1
    expect(validateFetchUrl('http://127.1/').ok).toBe(false) // 127.0.0.1
  })
})
