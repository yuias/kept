import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackVisualViewport, viewportCssVars } from './visual-viewport'

describe('viewportCssVars', () => {
  it('returns null without a box', () => {
    expect(viewportCssVars(null)).toBeNull()
  })

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])('returns null for height %s', (height) => {
    expect(viewportCssVars({ height, offsetTop: 0 })).toBeNull()
  })

  it('rounds to whole pixels', () => {
    expect(viewportCssVars({ height: 512.4, offsetTop: 280.6 })).toEqual([
      ['--vv-height', '512px'],
      ['--vv-top', '281px'],
    ])
  })

  it('clamps a negative offset to 0', () => {
    expect(viewportCssVars({ height: 500, offsetTop: -12 })).toEqual([
      ['--vv-height', '500px'],
      ['--vv-top', '0px'],
    ])
  })
})

describe('trackVisualViewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function setup(height = 600, offsetTop = 0) {
    const frames: Array<() => void> = []
    const raf = vi.fn((cb: () => void) => frames.push(cb))
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const vv = Object.assign(new EventTarget(), { height, offsetTop })
    const setProperty = vi.fn()
    const removeProperty = vi.fn()
    const root = { style: { setProperty, removeProperty } }
    const track = () => trackVisualViewport(vv as unknown as VisualViewport, root as unknown as HTMLElement)
    return { frames, raf, vv, setProperty, removeProperty, track }
  }

  it('sets both variables immediately', () => {
    const { track, setProperty } = setup(600, 0)
    track()
    expect(setProperty).toHaveBeenCalledWith('--vv-height', '600px')
    expect(setProperty).toHaveBeenCalledWith('--vv-top', '0px')
  })

  it('updates on resize once the animation frame runs', () => {
    const { track, vv, frames, setProperty } = setup(600, 0)
    track()
    setProperty.mockClear()
    vv.height = 320
    vv.offsetTop = 40
    vv.dispatchEvent(new Event('resize'))
    expect(setProperty).not.toHaveBeenCalled()
    frames[0]?.()
    expect(setProperty).toHaveBeenCalledWith('--vv-height', '320px')
    expect(setProperty).toHaveBeenCalledWith('--vv-top', '40px')
  })

  it('schedules one frame for several events', () => {
    const { track, vv, raf } = setup()
    track()
    vv.dispatchEvent(new Event('resize'))
    vv.dispatchEvent(new Event('scroll'))
    expect(raf).toHaveBeenCalledTimes(1)
  })

  it('schedules again after the frame has run', () => {
    const { track, vv, raf, frames } = setup()
    track()
    vv.dispatchEvent(new Event('scroll'))
    frames[0]?.()
    vv.dispatchEvent(new Event('scroll'))
    expect(raf).toHaveBeenCalledTimes(2)
  })

  it('removes both variables when the box is unusable', () => {
    const { track, vv, frames, removeProperty } = setup()
    track()
    vv.height = 0
    vv.dispatchEvent(new Event('resize'))
    frames[0]?.()
    expect(removeProperty).toHaveBeenCalledWith('--vv-height')
    expect(removeProperty).toHaveBeenCalledWith('--vv-top')
  })

  it('stops listening after unsubscribe', () => {
    const { track, vv, raf } = setup()
    const stop = track()
    stop()
    vv.dispatchEvent(new Event('resize'))
    vv.dispatchEvent(new Event('scroll'))
    expect(raf).not.toHaveBeenCalled()
  })

  it('returns a callable no-op without a visual viewport', () => {
    const root = { style: { setProperty: vi.fn(), removeProperty: vi.fn() } } as unknown as HTMLElement
    const stop = trackVisualViewport(undefined, root)
    expect(() => stop()).not.toThrow()
    expect(trackVisualViewport(null, root)).toBeTypeOf('function')
    expect(root.style.setProperty).not.toHaveBeenCalled()
  })
})

describe('module import', () => {
  it('does not touch window or document', async () => {
    expect(typeof window).toBe('undefined')
    vi.resetModules()
    await expect(import('./visual-viewport')).resolves.toBeDefined()
  })
})
