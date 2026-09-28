import { describe, expect, it } from 'vitest'
import { scaleToMaxEdge } from './dimensions'

describe('scaleToMaxEdge', () => {
  it('leaves an image within the limit unchanged', () => {
    expect(scaleToMaxEdge(800, 600, 2560)).toEqual({ width: 800, height: 600 })
  })

  it('leaves an image exactly at the limit unchanged', () => {
    expect(scaleToMaxEdge(2560, 100, 2560)).toEqual({ width: 2560, height: 100 })
  })

  it('downscales a landscape image so the longest edge matches the limit', () => {
    expect(scaleToMaxEdge(5120, 2560, 2560)).toEqual({ width: 2560, height: 1280 })
  })

  it('downscales a portrait image so the longest edge matches the limit', () => {
    expect(scaleToMaxEdge(2560, 5120, 2560)).toEqual({ width: 1280, height: 2560 })
  })

  it('never rounds a dimension below 1', () => {
    expect(scaleToMaxEdge(10000, 1, 100)).toEqual({ width: 100, height: 1 })
  })

  it('handles a square image', () => {
    expect(scaleToMaxEdge(4000, 4000, 1000)).toEqual({ width: 1000, height: 1000 })
  })
})
