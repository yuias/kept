import { describe, expect, it } from 'vitest'
import {
  COMPACT_MEDIA_QUERY,
  closeDrawerModel,
  initialSidebarModel,
  isSidebarVisible,
  storedSidebarValue,
  toggleSidebarModel,
} from './sidebar-model'

describe('COMPACT_MEDIA_QUERY', () => {
  it('matches the width copied into the CSS files', () => {
    expect(COMPACT_MEDIA_QUERY).toBe('(max-width: 720px)')
  })
})

describe('initialSidebarModel', () => {
  it('opens the desktop column when nothing is stored', () => {
    expect(initialSidebarModel(null)).toEqual({ pinnedOpen: true, drawerOpen: false })
  })

  it("opens the desktop column for '1'", () => {
    expect(initialSidebarModel('1')).toEqual({ pinnedOpen: true, drawerOpen: false })
  })

  it.each(['0', 'x', ''])('closes the desktop column for %j', (stored) => {
    expect(initialSidebarModel(stored)).toEqual({ pinnedOpen: false, drawerOpen: false })
  })
})

describe('isSidebarVisible', () => {
  const model = { pinnedOpen: true, drawerOpen: false }

  it('reads drawerOpen when compact', () => {
    expect(isSidebarVisible(model, true)).toBe(false)
    expect(isSidebarVisible({ ...model, drawerOpen: true }, true)).toBe(true)
  })

  it('reads pinnedOpen otherwise', () => {
    expect(isSidebarVisible(model, false)).toBe(true)
    expect(isSidebarVisible({ ...model, pinnedOpen: false }, false)).toBe(false)
  })
})

describe('toggleSidebarModel', () => {
  const model = { pinnedOpen: true, drawerOpen: false }

  it('flips only drawerOpen when compact', () => {
    expect(toggleSidebarModel(model, true)).toEqual({ pinnedOpen: true, drawerOpen: true })
  })

  it('flips only pinnedOpen otherwise', () => {
    expect(toggleSidebarModel(model, false)).toEqual({ pinnedOpen: false, drawerOpen: false })
  })
})

describe('closeDrawerModel', () => {
  it('returns the same object when the drawer is already closed', () => {
    const model = { pinnedOpen: false, drawerOpen: false }
    expect(closeDrawerModel(model)).toBe(model)
  })

  it('clears drawerOpen and keeps pinnedOpen', () => {
    expect(closeDrawerModel({ pinnedOpen: true, drawerOpen: true })).toEqual({ pinnedOpen: true, drawerOpen: false })
    expect(closeDrawerModel({ pinnedOpen: false, drawerOpen: true })).toEqual({ pinnedOpen: false, drawerOpen: false })
  })
})

describe('storedSidebarValue', () => {
  it('follows pinnedOpen only', () => {
    expect(storedSidebarValue({ pinnedOpen: true, drawerOpen: false })).toBe('1')
    expect(storedSidebarValue({ pinnedOpen: false, drawerOpen: true })).toBe('0')
  })
})
