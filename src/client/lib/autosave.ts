/**
 * Debounced, patch-merging autosave. Plain TS (no runes) so `NoteEditor`
 * can import it and vitest can exercise it directly with fake timers.
 */

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface Autosave<Patch extends object> {
  /** Merges `patch` into whatever is pending and (re)starts the debounce timer. */
  update(patch: Patch): void
  /**
   * Sends the pending patch now, waiting for any save already in flight
   * first (and for whatever that save's own completion chains). Resolves
   * `true` when nothing is left pending afterwards, `false` if the last
   * attempt failed and a patch is still queued for retry.
   */
  flush(): Promise<boolean>
}

/** `Object.assign`, not `{ ...a, ...b }`: spreading a bare generic type parameter is a TS error. */
function merge<Patch extends object>(a: Patch, b: Patch): Patch {
  return Object.assign({}, a, b)
}

export function createAutosave<Patch extends object>(
  save: (patch: Patch) => Promise<void>,
  delayMs: number,
  onStatus: (status: AutosaveStatus) => void,
): Autosave<Patch> {
  let pending: Patch | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule(): void {
    clearTimer()
    timer = setTimeout(() => {
      void send()
    }, delayMs)
  }

  async function send(): Promise<void> {
    clearTimer()
    // A save already in flight must finish (and hand off to whatever it
    // chains via `schedule()` below) before this call takes its own patch;
    // otherwise two saves could run concurrently and race each other's
    // writes (duplicate creates, out-of-order PATCHes).
    while (inFlight) await inFlight
    if (!pending) return

    const patch = pending
    pending = null
    onStatus('saving')

    const attempt = (async () => {
      try {
        await save(patch)
        onStatus('saved')
        // More may have queued while this save was in flight.
        if (pending) schedule()
      } catch {
        // Put the failed patch back ahead of anything queued since, so a
        // later save still carries the fields that never made it through.
        pending = pending ? merge(patch, pending) : patch
        onStatus('error')
      } finally {
        inFlight = null
      }
    })()

    inFlight = attempt
    await attempt
  }

  return {
    update(patch: Patch): void {
      pending = pending ? merge(pending, patch) : Object.assign({}, patch)
      schedule()
    },
    async flush(): Promise<boolean> {
      clearTimer()
      // `send()` itself waits out any pre-existing in-flight save before
      // taking (and awaiting) its own, so one call drains the full chain.
      await send()
      return pending === null
    },
  }
}
