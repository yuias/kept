<script lang="ts">
  import { reorderSiblings, type FolderTreeNode } from '../../shared/folder-tree'
  import type { Folder } from '../../shared/types'
  import {
    canCreateSubfolder,
    createFolder,
    disabledMoveTargets,
    folders,
    isFolderExpanded,
    isReordering,
    moveFolder,
    removeFolder,
    renameFolder,
    reorderFolders,
    toggleFolderExpanded,
  } from '../lib/folders.svelte'
  import { messages } from '../lib/i18n.svelte'
  import { closeMenu, isMenuOpen, menuRoot, toggleMenu } from '../lib/menu.svelte'
  import { currentRoute, navigate, link } from '../lib/router.svelte'
  import { settings } from '../lib/settings.svelte'
  import FolderPicker from './FolderPicker.svelte'
  import FolderTree from './FolderTree.svelte'

  const { nodes }: { nodes: FolderTreeNode<Folder>[] } = $props()

  const manualSort = $derived(settings().folderSort === 'manual')
  const dragEnabled = $derived(manualSort && !isReordering())

  const m = $derived(messages())
  const route = $derived(currentRoute())

  // Which node (if any) has its move picker open; per recursive instance. The
  // open "..." menu is app-wide state in lib/menu.svelte.
  let movingFolder = $state<Folder | null>(null)

  const moveDisabledIds = $derived(movingFolder ? disabledMoveTargets(movingFolder.id) : [])

  async function handleNewSubfolder(parentId: string): Promise<void> {
    const name = window.prompt(m.folders.namePrompt)
    if (!name || !name.trim()) return
    await createFolder(name.trim(), parentId)
  }

  async function handleRename(folder: Folder): Promise<void> {
    closeMenu()
    const name = window.prompt(m.folders.renamePrompt, folder.name)
    if (!name || !name.trim() || name.trim() === folder.name) return
    await renameFolder(folder.id, name.trim())
  }

  function handleMoveClick(folder: Folder): void {
    closeMenu()
    movingFolder = folder
  }

  async function handleMovePick(parentId: string | null): Promise<void> {
    const folder = movingFolder
    movingFolder = null
    if (!folder || parentId === folder.parentId) return
    await moveFolder(folder.id, parentId)
  }

  // Each recursive instance renders one sibling level, so drag state held
  // here only ever matches rows of the same level: no reparenting possible.
  let dragId = $state<string | null>(null)
  let dropTarget = $state<{ id: string; after: boolean } | null>(null)

  function dropAfter(event: DragEvent): boolean {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return event.clientY > rect.top + rect.height / 2
  }

  function handleDragStart(event: DragEvent, id: string): void {
    dragId = id
    closeMenu()
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      // Firefox does not start a drag without data.
      event.dataTransfer.setData('text/plain', id)
    }
  }

  function handleDragOver(event: DragEvent, id: string): void {
    if (dragId === null) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const after = dropAfter(event)
    if (dropTarget?.id !== id || dropTarget.after !== after) dropTarget = { id, after }
  }

  function handleDragLeave(event: DragEvent, id: string): void {
    const to = event.relatedTarget
    // relatedTarget is null when leaving the window or entering a non-element.
    if (to instanceof Node && (event.currentTarget as HTMLElement).contains(to)) return
    if (dropTarget?.id === id) dropTarget = null
  }

  function handleDragEnd(): void {
    dragId = null
    dropTarget = null
  }

  async function handleDrop(event: DragEvent, id: string): Promise<void> {
    if (dragId === null) return
    if (isReordering()) {
      event.preventDefault()
      handleDragEnd()
      return
    }
    event.preventDefault()
    const source = dragId
    const next = reorderSiblings(
      nodes.map((n) => n.folder.id),
      source,
      id,
      dropAfter(event),
    )
    handleDragEnd()
    if (next) await reorderFolders(nodes[0]?.folder.parentId ?? null, next)
  }

  async function handleDelete(folder: Folder): Promise<void> {
    closeMenu()
    if (!window.confirm(m.folders.deleteConfirm(folder.name))) return
    const ok = await removeFolder(folder.id)
    // Its notes and subfolders moved to the parent, so a route pointing at
    // the now-gone folder would 404; send the user up one level instead.
    if (ok && route.name === 'folder' && route.id === folder.id) {
      navigate(folder.parentId ? `/folder/${encodeURIComponent(folder.parentId)}` : '/')
    }
  }
</script>

<ul class="folder-tree">
  {#each nodes as node (node.folder.id)}
    <li>
      <div
        class="folder-row"
        class:dragging={dragId === node.folder.id}
        class:drop-before={dropTarget?.id === node.folder.id && !dropTarget.after}
        class:drop-after={dropTarget?.id === node.folder.id && dropTarget.after}
        role="presentation"
        title={manualSort ? undefined : m.folders.reorderDisabled}
        draggable={dragEnabled}
        ondragstart={dragEnabled ? (e) => handleDragStart(e, node.folder.id) : undefined}
        ondragover={manualSort ? (e) => handleDragOver(e, node.folder.id) : undefined}
        ondragleave={manualSort ? (e) => handleDragLeave(e, node.folder.id) : undefined}
        ondrop={manualSort ? (e) => handleDrop(e, node.folder.id) : undefined}
        ondragend={manualSort ? handleDragEnd : undefined}
      >
        {#if node.children.length > 0}
          <button
            type="button"
            class="folder-toggle"
            aria-label={isFolderExpanded(node.folder.id) ? m.folders.collapse : m.folders.expand}
            onclick={() => toggleFolderExpanded(node.folder.id)}
          >
            {isFolderExpanded(node.folder.id) ? '▾' : '▸'}
          </button>
        {:else}
          <span class="folder-toggle-spacer"></span>
        {/if}
        <a
          class="sidebar-link folder-link"
          href={`/folder/${encodeURIComponent(node.folder.id)}`}
          use:link
          draggable="false"
          aria-current={route.name === 'folder' && route.id === node.folder.id ? 'page' : undefined}
        >
          {node.folder.name}
        </a>
        <button
          type="button"
          class="folder-add"
          aria-label={m.folders.newSubfolder}
          title={m.folders.newSubfolder}
          disabled={!canCreateSubfolder(node.folder.id)}
          onclick={() => handleNewSubfolder(node.folder.id)}
        >
          +
        </button>
        <div class="folder-menu-wrap" use:menuRoot={`folder:${node.folder.id}`}>
          <button
            type="button"
            class="folder-menu-trigger"
            aria-label={m.folders.actions}
            title={m.folders.actions}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen(`folder:${node.folder.id}`)}
            onclick={() => toggleMenu(`folder:${node.folder.id}`)}
          >
            ⋯
          </button>
          {#if isMenuOpen(`folder:${node.folder.id}`)}
            <div class="popup-menu" role="menu">
              <button type="button" role="menuitem" onclick={() => handleRename(node.folder)}>
                {m.folders.rename}
              </button>
              <button type="button" role="menuitem" onclick={() => handleMoveClick(node.folder)}>
                {m.folders.move}
              </button>
              <button type="button" role="menuitem" class="danger" onclick={() => handleDelete(node.folder)}>
                {m.folders.delete}
              </button>
            </div>
          {/if}
        </div>
      </div>
      {#if node.children.length > 0 && isFolderExpanded(node.folder.id)}
        <div class="folder-children">
          <FolderTree nodes={node.children} />
        </div>
      {/if}
    </li>
  {/each}
</ul>

{#if movingFolder}
  <FolderPicker
    title={m.folders.moveTitle}
    folders={folders()}
    disabledIds={moveDisabledIds}
    onpick={handleMovePick}
    oncancel={() => (movingFolder = null)}
  />
{/if}

<style>
  .folder-tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .folder-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .folder-row.dragging {
    opacity: 0.5;
  }

  .folder-row.drop-before {
    box-shadow: 0 -2px 0 var(--accent, currentColor);
  }

  .folder-row.drop-after {
    box-shadow: 0 2px 0 var(--accent, currentColor);
  }

  .folder-link {
    padding: 5px 10px;
    font-size: 0.88rem;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-toggle,
  .folder-toggle-spacer {
    width: 18px;
    flex-shrink: 0;
    text-align: center;
  }

  .folder-toggle {
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
  }

  .folder-add {
    flex-shrink: 0;
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 6px;
  }

  .folder-add:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .folder-menu-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .folder-menu-trigger {
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 6px;
  }

  .folder-children {
    padding-left: 16px;
  }
</style>
