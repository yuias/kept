<script lang="ts">
  import { onMount } from 'svelte'
  import { buildTree, type FolderTreeNode } from '../../shared/folder-tree'
  import type { Folder } from '../../shared/types'
  import { messages } from '../lib/i18n.svelte'

  const {
    title,
    folders,
    disabledIds = [],
    onpick,
    oncancel,
  }: {
    title: string
    folders: Folder[]
    disabledIds?: string[]
    onpick: (id: string | null) => void
    oncancel: () => void
  } = $props()

  const m = $derived(messages())

  let dialogEl: HTMLDialogElement | undefined

  // `undefined` means "no selection made yet"; distinguishes a real pick of
  // the root (`null`) from a dialog closed via Cancel or Esc.
  let picked: string | null | undefined

  interface FlatRow {
    folder: Folder
    depth: number
  }

  function flatten(nodes: FolderTreeNode<Folder>[], depth = 0): FlatRow[] {
    const rows: FlatRow[] = []
    for (const node of nodes) {
      rows.push({ folder: node.folder, depth })
      rows.push(...flatten(node.children, depth + 1))
    }
    return rows
  }

  // Always sorted by name: this picker is a lookup tool, independent of the
  // sidebar's configurable sort order.
  const rows = $derived(flatten(buildTree(folders, 'name')))

  onMount(() => {
    dialogEl?.showModal()
  })

  function pick(id: string | null): void {
    picked = id
    dialogEl?.close()
  }

  // The single exit path for every way the dialog can close (a pick, Cancel,
  // or Esc), so `onpick`/`oncancel` each fire exactly once.
  function handleClose(): void {
    if (picked !== undefined) onpick(picked)
    else oncancel()
  }
</script>

<dialog bind:this={dialogEl} class="folder-picker" onclose={handleClose}>
  <h2 class="folder-picker-title">{title}</h2>
  <div class="folder-picker-list">
    <button type="button" class="folder-picker-row" onclick={() => pick(null)}>
      {m.folders.noFolder}
    </button>
    {#each rows as row (row.folder.id)}
      <button
        type="button"
        class="folder-picker-row"
        style={`padding-left: ${row.depth * 16 + 10}px`}
        disabled={disabledIds.includes(row.folder.id)}
        onclick={() => pick(row.folder.id)}
      >
        {row.folder.name}
      </button>
    {/each}
  </div>
  <div class="folder-picker-actions">
    <span class="folder-picker-spacer"></span>
    <button type="button" onclick={() => dialogEl?.close()}>{m.folders.cancel}</button>
  </div>
</dialog>

<style>
  .folder-picker {
    width: min(360px, 90vw);
    max-height: 70vh;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .folder-picker-title {
    margin: 0;
    font-size: 1rem;
  }

  .folder-picker-list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .folder-picker-row {
    text-align: left;
    background: none;
    border: 0;
    padding: 8px 10px;
    cursor: pointer;
  }

  .folder-picker-row:hover:not(:disabled) {
    background: var(--surface-muted);
  }

  .folder-picker-row:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .folder-picker-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .folder-picker-spacer {
    flex: 1;
  }

  @media (pointer: coarse) {
    .folder-picker-row {
      padding-top: 11px;
      padding-bottom: 11px;
    }
  }
</style>
