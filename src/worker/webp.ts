/**
 * Trusts nothing about a declared content type: an upload's real format is
 * decided by its magic bytes, per the RIFF/WEBP container header.
 */
export function isWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false

  const riff = new TextDecoder().decode(bytes.subarray(0, 4))
  const webp = new TextDecoder().decode(bytes.subarray(8, 12))
  return riff === 'RIFF' && webp === 'WEBP'
}
