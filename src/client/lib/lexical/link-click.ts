export type LinkClickAction = 'open' | 'caret' | 'none'

/**
 * What a click on a link does. `modifier` is Mod or the middle button; `href` is
 * `linkHref(url)`, null for a target that must never open.
 */
export function linkClickAction(p: {
  readOnly: boolean
  modifier: boolean
  caretInLink: boolean
  detail: number
  href: string | null
}): LinkClickAction {
  if (p.href === null) return 'none'
  // The second click of a double-click selects a word; it must not open another tab.
  if (p.detail > 1) return 'none'
  if (p.readOnly || p.modifier) return 'open'
  // With the caret already in the link the user is editing it.
  return p.caretInLink ? 'caret' : 'open'
}
