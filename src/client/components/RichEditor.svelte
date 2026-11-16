<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { createRichEditor, type RichEditorHandle } from '../lib/lexical/editor'

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

  onMount(() => {
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
    return () => {
      handle?.destroy()
      handle = undefined
    }
  })

  $effect(() => {
    const next = value
    if (!handle || next === synced) return
    synced = next
    handle.setValue(next)
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

<style>
  /* Not a flex container: Chrome mis-focuses a contenteditable whose parent is one. */
  .rich-editor-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .rich-editor {
    min-height: 40vh;
    max-height: 60vh;
    overflow: auto;
    padding: 4px 2px;
    outline: none;
    color: var(--text);
  }

  .rich-editor-placeholder {
    position: absolute;
    top: 4px;
    left: 2px;
    color: var(--text-muted);
    pointer-events: none;
  }
</style>
