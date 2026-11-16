<script module lang="ts">
  export type TableAction = 'insertRow' | 'insertColumn' | 'deleteRow' | 'deleteColumn'
</script>

<script lang="ts">
  import { messages } from '../../lib/i18n.svelte'

  const { onaction, onfocuseditor }: { onaction: (action: TableAction) => void; onfocuseditor: () => void } = $props()

  const m = $derived(messages().editor)

  const ITEMS: ReadonlyArray<{ action: TableAction; label: 'tableInsertRow' | 'tableInsertColumn' | 'tableDeleteRow' | 'tableDeleteColumn' }> = [
    { action: 'insertRow', label: 'tableInsertRow' },
    { action: 'insertColumn', label: 'tableInsertColumn' },
    { action: 'deleteRow', label: 'tableDeleteRow' },
    { action: 'deleteColumn', label: 'tableDeleteColumn' },
  ]

  let open = $state(false)
  let root: HTMLDivElement | undefined
  let menu = $state<HTMLDivElement>()
  // The button follows the table, so it can sit near either edge of the dialog; the menu
  // starts out below it and aligned to its right edge.
  let flip = $state({ left: false, up: false })

  function toggle(): void {
    flip = { left: false, up: false }
    open = !open
  }

  $effect(() => {
    if (!menu || !root) return
    const box = menu.getBoundingClientRect()
    const trigger = root.getBoundingClientRect()
    const bounds = root.closest('dialog')?.getBoundingClientRect()
    const edges = { left: bounds?.left ?? 0, top: bounds?.top ?? 0, bottom: bounds?.bottom ?? innerHeight }
    flip = { left: box.left < edges.left, up: box.bottom > edges.bottom && trigger.top - edges.top > box.height }
  })

  function choose(action: TableAction): void {
    open = false
    onaction(action)
    onfocuseditor()
  }

  // While open, Esc and an outside press are handled here, in the capture phase: Lexical
  // would blur the editor on Esc, and the note's dialog would close unless its default is
  // prevented. Native listeners, because Svelte's delegated ones run after the ancestors'.
  $effect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      open = false
      onfocuseditor()
    }
    const pointerdown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node && root?.contains(event.target))) open = false
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('pointerdown', pointerdown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('pointerdown', pointerdown, true)
    }
  })
</script>

<!-- mousedown is prevented so the editor keeps its focus and its caret, which the actions act on. -->
<div class="table-actions" bind:this={root} role="presentation" onmousedown={(event) => event.preventDefault()}>
  <button
    type="button"
    class="trigger"
    aria-label={m.tableActions}
    title={m.tableActions}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}
  >
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 7h12M7 3v10" />
    </svg>
  </button>
  {#if open}
    <div class="menu" class:left={flip.left} class:up={flip.up} bind:this={menu} role="menu" aria-label={m.tableActions}>
      {#each ITEMS as { action, label } (action)}
        <button type="button" role="menuitem" onclick={() => choose(action)}>{m[label]}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .table-actions {
    position: relative;
    display: flex;
    user-select: none;
    -webkit-user-select: none;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    min-width: 0;
    height: 24px;
    min-height: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
  }

  .trigger:hover,
  .trigger[aria-expanded='true'] {
    background: var(--surface-muted);
    color: var(--text);
  }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    display: flex;
    flex-direction: column;
    min-width: max-content;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  }

  .menu.left {
    right: auto;
    left: 0;
  }

  .menu.up {
    top: auto;
    bottom: calc(100% + 4px);
  }

  .menu button {
    min-width: 0;
    min-height: 0;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9em;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .menu button:hover {
    background: var(--surface-muted);
  }

  @media (pointer: coarse) {
    .trigger {
      width: 32px;
      height: 32px;
    }

    .menu button {
      padding: 10px 12px;
    }
  }
</style>
