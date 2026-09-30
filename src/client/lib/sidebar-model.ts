/** Widths at or below this use the phone layout. CSS repeats the number; see app.css. */
export const COMPACT_MAX_WIDTH_PX = 720
export const COMPACT_MEDIA_QUERY = `(max-width: ${COMPACT_MAX_WIDTH_PX}px)`

export interface SidebarModel {
  /** Desktop column shown; persisted. */
  readonly pinnedOpen: boolean
  /** Phone drawer shown; never persisted. */
  readonly drawerOpen: boolean
}

/** `stored` is the raw localStorage value: null (never set) → open, '1' → open, anything else → closed. The drawer starts closed. */
export function initialSidebarModel(stored: string | null): SidebarModel {
  return { pinnedOpen: stored === null || stored === '1', drawerOpen: false }
}

/** Visible in the current mode: the phone drawer when compact, the desktop column otherwise. */
export function isSidebarVisible(model: SidebarModel, compact: boolean): boolean {
  return compact ? model.drawerOpen : model.pinnedOpen
}

/** Flips only the field that belongs to the current mode. */
export function toggleSidebarModel(model: SidebarModel, compact: boolean): SidebarModel {
  return compact ? { ...model, drawerOpen: !model.drawerOpen } : { ...model, pinnedOpen: !model.pinnedOpen }
}

/** Returns `model` itself when the drawer is already closed. */
export function closeDrawerModel(model: SidebarModel): SidebarModel {
  return model.drawerOpen ? { ...model, drawerOpen: false } : model
}

export function storedSidebarValue(model: SidebarModel): '1' | '0' {
  return model.pinnedOpen ? '1' : '0'
}
