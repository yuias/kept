/**
 * The smallest single edit that turns `from` into `to`. Applying an external
 * value change this way, rather than replacing the whole document, lets the
 * editor keep the caret and scroll position.
 */
export function minimalChange(from: string, to: string): { from: number; to: number; insert: string } {
  let start = 0
  const max = Math.min(from.length, to.length)
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++
  let endFrom = from.length
  let endTo = to.length
  while (endFrom > start && endTo > start && from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)) {
    endFrom--
    endTo--
  }
  return { from: start, to: endFrom, insert: to.slice(start, endTo) }
}
