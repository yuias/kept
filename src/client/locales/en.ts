/**
 * The default catalog, and the source of truth for the message shape: every
 * other locale is typed as `Messages`, so a missing or mistyped key is a
 * compile error rather than a blank label at runtime.
 */
export const en = {
  meta: {
    /** Shown in the language picker; always written in its own language. */
    localeName: 'English',
    htmlLang: 'en',
  },
  nav: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    /** Shown instead of Sign in when Access presented a token we refuse. */
    sessionStale: 'Session expired',
    /** Badge next to the email in local dev, where Access is not in front of the Worker. */
    dev: 'dev',
    /** Shown when the Worker reports no identity but is not asking to sign in. */
    notSignedIn: 'Not signed in',
    theme: 'Theme',
    themeAuto: 'Auto',
    themeLight: 'Light',
    themeDark: 'Dark',
    toggleSidebar: 'Toggle sidebar',
  },
  sidebar: {
    notes: 'Notes',
    folders: 'Folders',
    labels: 'Labels',
    archive: 'Archive',
    trash: 'Trash',
    settings: 'Settings',
  },
  app: {
    settingsComingSoon: 'Settings are coming soon.',
    notFound: 'Page not found.',
  },
  notes: {
    pinned: 'Pinned',
    others: 'Others',
    pinnedIndicator: 'Pinned',
    loadMore: 'Load more',
    loading: 'Loading…',
    emptyNotes: 'No notes yet.',
    emptyArchive: 'No archived notes.',
    emptyTrash: 'Trash is empty.',
    emptySearch: 'No notes match your search.',
    emptyTrashAction: 'Empty trash',
    emptyTrashConfirm: 'Delete every note in the trash permanently? This cannot be undone.',
  },
  errors: {
    badRequest: 'That request was invalid.',
    unauthorized: 'Sign in to continue.',
    sessionStale: 'Your session is no longer accepted. Sign out, then sign in again.',
    notFound: 'That could not be found.',
    conflict: 'That change conflicts with the current state.',
    payloadTooLarge: 'That is too large.',
    unsupportedMediaType: 'That file type is not supported.',
    badGateway: 'The upstream server did not respond.',
    internalError: 'Something went wrong.',
    folderNotFound: 'That folder could not be found.',
    formatLocked: 'This note already has a fixed format and cannot go back to automatic.',
    noteTrashed: 'This note is in the trash and cannot be edited.',
    noteNotTrashed: 'Move this note to the trash before deleting it forever.',
    network: 'The server could not be reached.',
  },
}

/**
 * Deliberately not `as const`: the literal types that would produce force every
 * other locale to repeat the English wording verbatim.
 */
export type Messages = typeof en
