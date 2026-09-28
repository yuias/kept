const STORAGE_KEY = 'kept.sidebar'

function readStoredOpen(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === '1'
  } catch {
    // Private browsing modes can throw on access; default to open.
    return true
  }
}

const state = $state<{ open: boolean }>({ open: readStoredOpen() })

export function sidebarOpen(): boolean {
  return state.open
}

export function toggleSidebar(): void {
  state.open = !state.open

  try {
    localStorage.setItem(STORAGE_KEY, state.open ? '1' : '0')
  } catch {
    // Persisting is best-effort; the choice still applies to this session.
  }
}
