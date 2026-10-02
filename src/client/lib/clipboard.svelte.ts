/**
 * Writes plain text to the clipboard. A pending text goes in as a
 * ClipboardItem promise so the write starts within the click's user
 * activation, which Safari requires; awaiting a fetch before writeText would
 * be rejected there.
 */
export async function copyText(text: string | Promise<string>): Promise<void> {
  if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined') {
    const blob = text.then((value) => new Blob([value], { type: 'text/plain' }))
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
    return
  }
  await navigator.clipboard.writeText(await text)
}

export type CopyState = 'idle' | 'copied' | 'failed'

const FEEDBACK_MS = 1500

/** Copy action whose result shows briefly on the button, then resets. */
export function createCopyAction(): {
  readonly state: CopyState
  run: (text: string | Promise<string>) => Promise<void>
  dispose: () => void
} {
  let state = $state<CopyState>('idle')
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    get state() {
      return state
    },
    async run(text) {
      clearTimeout(timer)
      try {
        await copyText(text)
        state = 'copied'
      } catch {
        state = 'failed'
      }
      timer = setTimeout(() => (state = 'idle'), FEEDBACK_MS)
    },
    dispose() {
      clearTimeout(timer)
    },
  }
}
