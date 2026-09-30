import {
  COMPACT_MEDIA_QUERY,
  closeDrawerModel,
  initialSidebarModel,
  isSidebarVisible,
  storedSidebarValue,
  toggleSidebarModel,
  type SidebarModel,
} from './sidebar-model'

const STORAGE_KEY = 'kept.sidebar'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private browsing modes can throw on access; treat as never set (open).
    return null
  }
}

const media = window.matchMedia(COMPACT_MEDIA_QUERY)
const state = $state<{ model: SidebarModel; compact: boolean }>({
  model: initialSidebarModel(readStored()),
  compact: media.matches,
})

// Crossing the breakpoint always closes the drawer, so rotating a tablet or
// resizing a window never leaves a drawer over the desktop layout.
media.addEventListener('change', (event) => {
  state.compact = event.matches
  state.model = closeDrawerModel(state.model)
})

export function isCompact(): boolean {
  return state.compact
}

/** Visible in the current mode: the desktop column, or the phone drawer. */
export function sidebarOpen(): boolean {
  return isSidebarVisible(state.model, state.compact)
}

export function toggleSidebar(): void {
  state.model = toggleSidebarModel(state.model, state.compact)
  if (state.compact) return

  try {
    localStorage.setItem(STORAGE_KEY, storedSidebarValue(state.model))
  } catch {
    // Persisting is best-effort; the choice still applies to this session.
  }
}

export function closeDrawer(): void {
  state.model = closeDrawerModel(state.model)
}
