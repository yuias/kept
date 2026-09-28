/**
 * Pure SSRF checks for the image URL import proxy. These only stop requests
 * to literal private/loopback/link-local addresses and a handful of reserved
 * names; they cannot see through DNS rebinding, which Workers accept as
 * defence in depth because the runtime itself has no route into private
 * networks.
 */

export type ValidateFetchUrlResult = { ok: true; url: URL } | { ok: false; code: string }

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function parseIpv4(text: string): [number, number, number, number] | null {
  const match = IPV4_PATTERN.exec(text)
  if (!match) return null

  const octets = match.slice(1, 5).map(Number) as [number, number, number, number]
  if (octets.some((octet) => octet < 0 || octet > 255)) return null
  return octets
}

function isBlockedIpv4([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8
  if (a === 100 && (b & 0xc0) === 0x40) return true // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local)
  if (a === 172 && (b & 0xf0) === 0x10) return true // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 198 && (b & 0xfe) === 18) return true // 198.18.0.0/15 (benchmarking)
  if ((a & 0xf0) === 0xe0) return true // 224.0.0.0/4 (multicast)
  if ((a & 0xf0) === 0xf0) return true // 240.0.0.0/4, including 255.255.255.255
  return false
}

/**
 * Expands a bracket-free IPv6 literal into 8 16-bit groups, or null if it is
 * not a well-formed address. Tolerates an embedded IPv4 quad in the trailing
 * group (`::ffff:192.168.0.1`), even though the WHATWG URL parser that feeds
 * `isBlockedHost` in practice always normalises that to hex groups first.
 */
function expandIpv6(address: string): number[] | null {
  const sides = address.split('::')
  if (sides.length > 2) return null

  const splitSide = (side: string | undefined): string[] => (!side ? [] : side.split(':'))

  const expandTrailingIpv4 = (groups: string[]): string[] => {
    const last = groups.at(-1)
    if (!last?.includes('.')) return groups
    const octets = parseIpv4(last)
    if (!octets) return groups
    const [a, b, c, d] = octets
    return [...groups.slice(0, -1), (((a << 8) | b) >>> 0).toString(16), (((c << 8) | d) >>> 0).toString(16)]
  }

  const head = expandTrailingIpv4(splitSide(sides[0]))
  const tail = sides.length === 2 ? expandTrailingIpv4(splitSide(sides[1])) : []

  const explicit = head.length + tail.length
  if (sides.length === 1 ? explicit !== 8 : explicit >= 8) return null

  const parts = sides.length === 2 ? [...head, ...Array(8 - explicit).fill('0'), ...tail] : head

  const groups: number[] = []
  for (const part of parts) {
    if (part === '') return null
    const value = Number.parseInt(part, 16)
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null
    groups.push(value)
  }
  return groups
}

/** Combines two 16-bit groups into the IPv4 address they encode. */
function ipv4FromGroups(hi: number, lo: number): [number, number, number, number] {
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]
}

/** True when `groups[0..count)` are all zero. */
function isZeroPrefix(groups: number[], count: number): boolean {
  return groups.slice(0, count).every((group) => group === 0)
}

function isBlockedIpv6(groups: number[]): boolean {
  if (groups.every((group) => group === 0)) return true // "::" (unspecified)
  if (isZeroPrefix(groups, 7) && groups[7] === 1) return true // "::1" (loopback)

  const first = groups[0]!
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 (unique local)
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 (link-local)
  if ((first & 0xffc0) === 0xfec0) return true // fec0::/10 (site-local, deprecated)

  // The forms below all embed an IPv4 address inside an IPv6 literal; the
  // embedded address is checked recursively so a public one is not blocked
  // just for arriving via one of these transition mechanisms.
  const embeddedV4 = ipv4FromGroups(groups[6]!, groups[7]!)

  if (isZeroPrefix(groups, 6)) return isBlockedIpv4(embeddedV4) // ::a.b.c.d/96 (IPv4-compatible, deprecated)
  if (isZeroPrefix(groups, 5) && groups[5] === 0xffff) return isBlockedIpv4(embeddedV4) // ::ffff:a.b.c.d/96 (IPv4-mapped)
  if (isZeroPrefix(groups, 4) && groups[4] === 0xffff && groups[5] === 0) return isBlockedIpv4(embeddedV4) // ::ffff:0:a.b.c.d/96 (SIIT)
  if (first === 0x64 && groups[1] === 0xff9b && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) {
    return isBlockedIpv4(embeddedV4) // 64:ff9b::/96 (NAT64 well-known prefix)
  }
  if (first === 0x2002) return isBlockedIpv4(ipv4FromGroups(groups[1]!, groups[2]!)) // 2002::/16 (6to4)

  return false
}

/**
 * Rejects reserved and single-label names, literal non-public IPv4/IPv6
 * addresses, and IPv6 forms that embed a non-public IPv4 address.
 */
export function isBlockedHost(hostname: string): boolean {
  // A trailing dot (possibly repeated) marks an absolute FQDN (`localhost.`)
  // but resolves to the exact same name, so it must not slip past the suffix
  // checks below.
  const host = hostname.toLowerCase().replace(/\.+$/, '')

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true

  const ipv4 = parseIpv4(host)
  if (ipv4) return isBlockedIpv4(ipv4)

  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = expandIpv6(host.slice(1, -1))
    // An IPv6 literal the parser above cannot make sense of is refused rather
    // than let through: this check only ever needs to fail closed.
    return groups === null || isBlockedIpv6(groups)
  }

  // A single-label name (no dot at all) never resolves on the public
  // internet: it is either a bare loopback alias or resolved by a search
  // domain into something internal (`http://metadata/`, `http://printer/`).
  if (!host.includes('.')) return true

  return false
}

/**
 * Validates a caller-supplied (or a redirect's) URL before it is fetched:
 * only plain http/https, no embedded credentials, and not a blocked host.
 */
export function validateFetchUrl(raw: string): ValidateFetchUrlResult {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, code: 'invalid_url' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, code: 'invalid_url' }
  if (url.username !== '' || url.password !== '') return { ok: false, code: 'invalid_url' }
  if (isBlockedHost(url.hostname)) return { ok: false, code: 'blocked_host' }

  return { ok: true, url }
}
