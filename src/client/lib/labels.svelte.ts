import { asciiLower, sortLabelsCaseInsensitive } from '../../shared/labels'
import type { LabelCount } from '../../shared/types'
import { listLabels as listLabelsRequest } from './api'
import { describeApiError } from './errors'
import { messages } from './i18n.svelte'

const EXPANDED_KEY = 'kept.labels.expanded'

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1'
  } catch {
    // Private browsing modes can throw on access; start collapsed.
    return false
  }
}

function persistExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0')
  } catch {
    // Persisting is best-effort; expansion still applies to this session.
  }
}

const state = $state<{ labels: LabelCount[]; loaded: boolean; expanded: boolean; error: string | null }>({
  labels: [],
  loaded: false,
  expanded: readExpanded(),
  error: null,
})

async function load(): Promise<void> {
  try {
    state.labels = await listLabelsRequest()
  } catch {
    // The sidebar just shows no labels; list routes surface their own errors.
  } finally {
    state.loaded = true
  }
}

/** Settles once the initial load has finished, successfully or not. */
export const labelsReady: Promise<void> = load()

export function labelCounts(): LabelCount[] {
  return state.labels
}

export function labelError(): string | null {
  return state.error
}

export function isLabelsExpanded(): boolean {
  return state.expanded
}

export function toggleLabelsExpanded(): void {
  state.expanded = !state.expanded
  persistExpanded(state.expanded)
}

/** Reloads from the server; used after label edits and after trash/empty-trash change counts. */
export async function reloadLabels(): Promise<void> {
  state.error = null
  try {
    state.labels = await listLabelsRequest()
  } catch (cause) {
    state.error = describeApiError(cause, messages())
  }
}

/**
 * Order- and NOCASE-insensitive equality, matching how SQLite's unique index
 * on `labels(owner, name COLLATE NOCASE)` treats two spellings as the same
 * label. `asciiLower`, not `toLowerCase()`: SQLite's NOCASE folds ASCII only,
 * so e.g. "CAFÉ" and "café" are distinct there but would wrongly compare
 * equal with a full Unicode fold.
 */
export function sameLabelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const foldedA = sortLabelsCaseInsensitive(a).map(asciiLower)
  const foldedB = sortLabelsCaseInsensitive(b).map(asciiLower)
  return foldedA.join('\u0000') === foldedB.join('\u0000')
}
