export interface ViewportBox {
  height: number
  offsetTop: number
}

export const VV_HEIGHT_VAR = '--vv-height'
export const VV_TOP_VAR = '--vv-top'

/**
 * null when there is nothing usable (no box, or a height that is not a positive
 * finite number); otherwise whole-pixel values, with a negative offset clamped to 0.
 */
export function viewportCssVars(box: ViewportBox | null): ReadonlyArray<readonly [string, string]> | null {
  if (!box || !Number.isFinite(box.height) || box.height <= 0) return null
  // A non-finite offset would produce an invalid length, so treat it as 0.
  const top = Number.isFinite(box.offsetTop) ? Math.max(0, box.offsetTop) : 0
  return [
    [VV_HEIGHT_VAR, `${Math.round(box.height)}px`],
    [VV_TOP_VAR, `${Math.round(top)}px`],
  ]
}

/**
 * Keeps the variables on `root` in step with `vv` (resize + scroll, one update per
 * animation frame). Removes both when viewportCssVars returns null. Returns an unsubscribe.
 * No-op (returns a no-op) when `vv` is null/undefined.
 */
export function trackVisualViewport(vv: VisualViewport | null | undefined, root: HTMLElement): () => void {
  if (!vv) return () => {}

  const apply = () => {
    const vars = viewportCssVars({ height: vv.height, offsetTop: vv.offsetTop })
    if (vars) {
      for (const [name, value] of vars) root.style.setProperty(name, value)
    } else {
      root.style.removeProperty(VV_HEIGHT_VAR)
      root.style.removeProperty(VV_TOP_VAR)
    }
  }

  let frame: number | null = null
  const schedule = () => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      apply()
    })
  }

  apply()
  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  return () => {
    vv.removeEventListener('resize', schedule)
    vv.removeEventListener('scroll', schedule)
    if (frame !== null) {
      cancelAnimationFrame(frame)
      frame = null
    }
  }
}
