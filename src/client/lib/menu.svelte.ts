const state = $state<{ open: string | null }>({ open: null })
const roots = new Map<string, HTMLElement>()

/** Key of the one open popup menu, or null. Keys: `folder:<id>`, `note:<id>`. */
export function isMenuOpen(key: string): boolean {
  return state.open === key
}

export function toggleMenu(key: string): void {
  state.open = state.open === key ? null : key
}

export function closeMenu(): void {
  state.open = null
}

// Capture phase so a handler that stops propagation cannot keep a menu open.
// A press inside the open menu's root (including its trigger) is left to the
// trigger's own click toggle.
document.addEventListener(
  'pointerdown',
  (event) => {
    if (state.open === null) return
    const root = roots.get(state.open)
    if (event.target instanceof Node && root?.contains(event.target)) return
    state.open = null
  },
  true,
)

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || state.open === null) return
  // A cancelled Esc keydown does not become a close request, so a menu inside
  // the phone drawer (a modal dialog) closes alone and the drawer stays open.
  event.preventDefault()
  const root = roots.get(state.open)
  state.open = null
  root?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
})

/**
 * Action for the element that wraps a menu's trigger and its popup. While that
 * menu is open, a pointerdown outside the element or Esc closes it.
 */
export function menuRoot(node: HTMLElement, key: string): { update(key: string): void; destroy(): void } {
  let current = key
  roots.set(current, node)

  return {
    update(next) {
      if (roots.get(current) === node) roots.delete(current)
      if (state.open === current) state.open = next
      current = next
      roots.set(current, node)
    },
    destroy() {
      if (roots.get(current) === node) roots.delete(current)
      // The owner was unmounted (for example by a reload), so nothing is left
      // to dismiss the menu.
      if (state.open === current) state.open = null
    },
  }
}
