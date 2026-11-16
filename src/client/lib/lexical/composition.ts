import type { LexicalEditor } from 'lexical'

/**
 * Holds app-initiated updates back while an IME composition is active: an
 * update that Lexical did not make from an input event can break the composed
 * text (Lexical issue #9801). Operations run in the order they were given.
 */
export class CompositionGate {
  readonly #editor: LexicalEditor
  readonly #queue: Array<() => void> = []
  #composing = false
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(editor: LexicalEditor) {
    this.#editor = editor
  }

  /** The DOM said so (`compositionstart` to `compositionend`) or Lexical still tracks a composition. */
  get active(): boolean {
    return this.#composing || this.#editor.isComposing()
  }

  /** Root `compositionstart`. */
  begin(): void {
    this.#composing = true
  }

  /** Root `compositionend`. Flushes on the next macrotask, after Lexical has committed the composed text. */
  end(): void {
    this.#composing = false
    if (this.#queue.length > 0) this.#schedule()
  }

  /** Runs `op` now, or queues it behind everything that is waiting. */
  run(op: () => void): void {
    this.#queue.push(op)
    if (this.#timer === undefined) this.#drain()
  }

  /** Drops what is still queued and cancels the pending flush. */
  dispose(): void {
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#queue.length = 0
  }

  #schedule(): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.#drain()
    }, 0)
  }

  // One operation at a time. If one throws, the error propagates and the finally
  // block still schedules the rest. While the DOM composition is running, its
  // `end()` does the scheduling. A composition that only Lexical still reports
  // (it clears the key after `compositionend`) is polled, but only while
  // operations are waiting.
  #drain(): void {
    try {
      while (this.#queue.length > 0 && !this.active) this.#queue.shift()!()
    } finally {
      if (this.#queue.length > 0 && !this.#composing && this.#timer === undefined) this.#schedule()
    }
  }
}
