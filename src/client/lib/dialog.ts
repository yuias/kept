export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
}

/** True when (x, y) lies outside `rect`; points on the edge count as inside. */
export function isOutsideRect(rect: RectLike, x: number, y: number): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
}
