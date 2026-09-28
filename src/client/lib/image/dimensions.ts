/** Pure dimension math for the encode pipeline, kept apart from the worker so it is unit-testable. */

/**
 * Scales `width`/`height` down so the longest edge is at most `maxEdge`,
 * preserving aspect ratio. Images already within the limit are returned
 * unchanged; the result never rounds a dimension below 1.
 */
export function scaleToMaxEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longestEdge = Math.max(width, height)
  if (longestEdge <= maxEdge) return { width, height }

  const scale = maxEdge / longestEdge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
