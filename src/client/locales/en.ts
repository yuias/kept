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
  },
}

/**
 * Deliberately not `as const`: the literal types that would produce force every
 * other locale to repeat the English wording verbatim.
 */
export type Messages = typeof en
