<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { createRichEditor, type RichEditorHandle } from '../lib/lexical/editor'
  import './rich-editor.css'

  let {
    value = $bindable(''),
    onchange,
    onpaste,
    onunsupported,
    readonly = false,
    tasksToggleable = false,
    placeholder = '',
  }: {
    value?: string
    onchange?: (value: string) => void
    onpaste?: (event: ClipboardEvent) => void
    onunsupported?: () => void
    readonly?: boolean
    tasksToggleable?: boolean
    placeholder?: string
  } = $props()

  let host: HTMLDivElement | undefined
  let handle: RichEditorHandle | undefined
  let empty = $state(false)
  // The last document text known to both sides; lets the effect below skip
  // the full-document comparison on every keystroke.
  let synced = untrack(() => value)

  // A note the editor cannot load (for example markdown nested deep enough to overflow the
  // parser's stack) opens in the textarea like an unsupported one, instead of an empty editor.
  const fallBack = (error: unknown): void => {
    console.error(error)
    handle?.destroy()
    handle = undefined
    onunsupported?.()
  }

  onMount(() => {
    try {
      handle = createRichEditor({
        root: host!,
        value: untrack(() => value),
        readOnly: untrack(() => readonly),
        tasksToggleable: untrack(() => tasksToggleable),
        onChange: (next) => {
          synced = next
          value = next
          onchange?.(next)
        },
        onPaste: (event) => onpaste?.(event),
        onUnsupported: () => onunsupported?.(),
        onEmptyChange: (next) => {
          empty = next
        },
      })
    } catch (error) {
      fallBack(error)
    }
    return () => {
      handle?.destroy()
      handle = undefined
    }
  })

  $effect(() => {
    const next = value
    if (!handle || next === synced) return
    synced = next
    try {
      handle.setValue(next)
    } catch (error) {
      fallBack(error)
    }
  })

  $effect(() => {
    const ro = readonly
    const tasks = tasksToggleable
    handle?.setReadOnly(ro, tasks)
  })

  export function insertText(s: string): void {
    handle?.insertText(s)
  }

  export function replaceText(token: string, s: string): boolean {
    return handle?.replaceText(token, s) ?? false
  }

  export function focus(): void {
    handle?.focus()
  }
</script>

<div class="rich-editor-wrap">
  <div class="rich-editor" bind:this={host}></div>
  {#if empty && placeholder}
    <div class="rich-editor-placeholder" aria-hidden="true">{placeholder}</div>
  {/if}
</div>
