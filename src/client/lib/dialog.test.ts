import { describe, expect, it } from 'vitest'
import { isOutsideRect } from './dialog'

const rect = { left: 10, top: 20, right: 110, bottom: 220 }

describe('isOutsideRect', () => {
  it('treats an interior point as inside', () => {
    expect(isOutsideRect(rect, 50, 100)).toBe(false)
  })

  it('detects points left of the rect', () => {
    expect(isOutsideRect(rect, 9, 100)).toBe(true)
  })

  it('detects points right of the rect', () => {
    expect(isOutsideRect(rect, 111, 100)).toBe(true)
  })

  it('detects points above the rect', () => {
    expect(isOutsideRect(rect, 50, 19)).toBe(true)
  })

  it('detects points below the rect', () => {
    expect(isOutsideRect(rect, 50, 221)).toBe(true)
  })

  it('counts edge and corner points as inside', () => {
    expect(isOutsideRect(rect, 10, 100)).toBe(false)
    expect(isOutsideRect(rect, 110, 100)).toBe(false)
    expect(isOutsideRect(rect, 50, 20)).toBe(false)
    expect(isOutsideRect(rect, 50, 220)).toBe(false)
    expect(isOutsideRect(rect, 10, 20)).toBe(false)
    expect(isOutsideRect(rect, 110, 220)).toBe(false)
  })
})
