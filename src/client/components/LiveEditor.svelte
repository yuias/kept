<script lang="ts">
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
  import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
  import { LanguageSupport } from '@codemirror/language'
  import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state'
  import {
    drawSelection,
    EditorView,
    highlightSpecialChars,
    keymap,
    placeholder as placeholderExtension,
  } from '@codemirror/view'
  import { onMount, untrack } from 'svelte'
  import { messages } from '../lib/i18n.svelte'
  import { placeholderRange } from '../lib/image/insert'
  import { blocksTheme, liveBlocks, taskLabel } from '../lib/live/blocks'
  import { liveDecorations, liveTheme } from '../lib/live/decorations'
  import { cardLabels, cardTheme, linkCards } from '../lib/live/link-cards'
  import { linkClicks } from '../lib/live/links'
  import { toLf } from '../lib/live/line-endings'
  import { minimalChange } from '../lib/live/sync'

  let {
    value = $bindable(''),
    onchange,
    onpaste,
    readonly = false,
    placeholder = '',
  }: {
    value?: string
    onchange?: (value: string) => void
    onpaste?: (event: ClipboardEvent) => void
    readonly?: boolean
    placeholder?: string
  } = $props()

  // Marks transactions that come from the `value` prop, so they are not
  // echoed back through `onchange` (which would re-trigger autosave).
  const external = Annotation.define<boolean>()
  const editableSlot = new Compartment()
  const placeholderSlot = new Compartment()

  let host: HTMLDivElement | undefined
  let view: EditorView | undefined
  // The last document text known to both sides; lets the effect below skip
  // the full-document comparison on every keystroke.
  let synced = untrack(() => value)

  const editableExtensions = (ro: boolean) => [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]

  onMount(() => {
    const paste = EditorView.domEventHandlers({
      paste: (event) => {
        onpaste?.(event)
        return event.defaultPrevented
      },
    })
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: untrack(() => value),
        extensions: [
          // Keep CR/CRLF bodies byte-exact; by default CodeMirror splits on
          // any line ending and rewrites them to LF on the next edit.
          EditorState.lineSeparator.of('\n'),
          // Pasted or dropped text is normalized instead: with the separator
          // above, its CRs would otherwise land in the body and show as [CR].
          EditorView.clipboardInputFilter.of(toLf),
          history(),
          drawSelection(),
          highlightSpecialChars(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // No syntax highlighter on purpose: `liveDecorations` does the styling.
          // Markdown key bindings continue lists on Enter.
          new LanguageSupport(markdownLanguage),
          keymap.of(markdownKeymap),
          EditorView.lineWrapping,
          liveDecorations,
          liveBlocks,
          linkClicks,
          linkCards,
          cardLabels.of(() => ({ edit: messages().editor.editCard })),
          taskLabel.of(() => messages().editor.toggleTask),
          liveTheme,
          blocksTheme,
          cardTheme,
          paste,
          placeholderSlot.of(placeholderExtension(untrack(() => placeholder))),
          editableSlot.of(editableExtensions(untrack(() => readonly))),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.some((tr) => tr.annotation(external))) return
            const next = update.state.doc.toString()
            synced = next
            value = next
            onchange?.(next)
          }),
        ],
      }),
    })
    return () => {
      view?.destroy()
      view = undefined
    }
  })

  $effect(() => {
    const next = value
    if (!view || next === synced) return
    synced = next
    view.dispatch({
      changes: minimalChange(view.state.doc.toString(), next),
      annotations: [external.of(true), Transaction.addToHistory.of(false)],
    })
  })

  $effect(() => {
    const ro = readonly
    view?.dispatch({ effects: editableSlot.reconfigure(editableExtensions(ro)) })
  })

  $effect(() => {
    const text = placeholder
    view?.dispatch({ effects: placeholderSlot.reconfigure(placeholderExtension(text)) })
  })

  /** Inserts `s` at the end of the main selection and puts the caret after it. */
  export function insertText(s: string): void {
    if (!view) return
    const at = view.state.selection.main.to
    view.dispatch({
      changes: { from: at, insert: s },
      selection: { anchor: at + s.length },
      scrollIntoView: true,
    })
  }

  /**
   * Replaces the first occurrence of `token` with `s`. Returns false, and
   * leaves the document alone, when the token is gone (edited away while an
   * upload was in flight).
   */
  export function replaceText(token: string, s: string): boolean {
    if (!view) return false
    const range = placeholderRange(view.state.doc.toString(), token)
    if (!range) return false
    view.dispatch({ changes: { ...range, insert: s } })
    return true
  }

  export function focus(): void {
    view?.focus()
  }
</script>

<div class="live-editor" bind:this={host}></div>

<style>
  .live-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
</style>
