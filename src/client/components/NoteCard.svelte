<script lang="ts">
  import { onDestroy } from 'svelte'
  import { sortLabelsCaseInsensitive } from '../../shared/labels'
  import { copyableNoteText } from '../../shared/note-text'
  import type { NoteSummary, UpdateNoteInput } from '../../shared/types'
  import { fetchNote } from '../lib/api'
  import { createCopyAction } from '../lib/clipboard.svelte'
  import { messages } from '../lib/i18n.svelte'
  import { closeMenu, isMenuOpen, menuRoot, toggleMenu } from '../lib/menu.svelte'
  import { writeNoteDrag } from '../lib/note-drag'
  import Icon from './Icon.svelte'

  type CardPatch = Pick<UpdateNoteInput, 'pinned' | 'archived' | 'locked'>

  let {
    note,
    onopen,
    onupdate,
    onmove,
  }: {
    note: NoteSummary
    onopen: (id: string) => void
    onupdate: (id: string, patch: CardPatch) => Promise<void>
    onmove: (note: NoteSummary) => void
  } = $props()

  const m = $derived(messages())

  let busy = $state(false)
  let dragging = $state(false)
  const menuKey = $derived(`note:${note.id}`)

  async function run(patch: CardPatch): Promise<void> {
    busy = true
    try {
      await onupdate(note.id, patch)
    } finally {
      busy = false
    }
  }

  // The summary has no body, so the note is fetched; copyText starts the
  // clipboard write before the fetch resolves.
  const copyAction = createCopyAction()
  onDestroy(() => copyAction.dispose())
  const copyLabel = $derived(
    copyAction.state === 'copied' ? m.editor.copied : copyAction.state === 'failed' ? m.editor.copyFailed : m.editor.copyText,
  )

  function copyNote(): Promise<void> {
    return copyAction.run(fetchNote(note.id).then((full) => copyableNoteText(full.title, full.body)))
  }

  function handleDragStart(event: DragEvent): void {
    if (!event.dataTransfer) return
    closeMenu()
    event.dataTransfer.effectAllowed = 'move'
    writeNoteDrag(event.dataTransfer, { id: note.id, folderId: note.folderId })
    dragging = true
  }

  // An empty note keeps its text strip so the card stays clickable.
  const showText = $derived(
    note.images.length === 0 || Boolean(note.title || note.preview || note.labels.length > 0 || note.locked),
  )
  const pinLabel = $derived(note.pinned ? m.editor.unpin : m.editor.pin)
  const archiveLabel = $derived(note.archived ? m.editor.unarchive : m.editor.archive)
</script>

<div class="note-card card" class:dragging>
  <!--
    Known limitation: Firefox may not start a drag from a <button>. The "Move to folder"
    menu is the fallback there, and the only path on touch devices.
  -->
  <button
    type="button"
    class="note-card-open"
    draggable={note.trashedAt === null}
    ondragstart={handleDragStart}
    ondragend={() => (dragging = false)}
    onclick={() => onopen(note.id)}
    aria-label={!note.title && !note.preview ? m.notes.untitledNote : undefined}
  >
    {#if note.images.length > 0}
      <span class="note-card-images" data-count={Math.min(note.images.length, 4)}>
        {#each note.images as src (src)}
          <img {src} alt="" draggable="false" loading="lazy" decoding="async" />
        {/each}
      </span>
    {/if}
    {#if showText}
      <span class="note-card-text">
        {#if note.title}
          <span class="note-title">{note.title}</span>
        {/if}
        {#if note.preview}
          <span class="note-preview">{note.preview}</span>
        {/if}
        {#if note.labels.length > 0 || note.locked}
          <span class="note-labels">
            {#if note.locked}
              <span class="note-card-lock" role="img" aria-label={m.notes.locked} title={m.notes.locked}>
                <Icon name="lock" size={12} />
              </span>
            {/if}
            {#each sortLabelsCaseInsensitive(note.labels) as label (label)}
              <span class="note-label-chip">{label}</span>
            {/each}
          </span>
        {/if}
      </span>
    {/if}
  </button>
  {#if note.trashedAt === null}
    <span class="note-card-actions">
      <button
        type="button"
        class="icon-button"
        class:active={note.pinned}
        aria-pressed={note.pinned}
        aria-label={pinLabel}
        title={pinLabel}
        disabled={busy}
        onclick={() => run({ pinned: !note.pinned })}
      >
        <Icon name="pin" filled={note.pinned} size={14} />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label={archiveLabel}
        title={archiveLabel}
        disabled={busy}
        onclick={() => run({ archived: !note.archived })}
      >
        <Icon name={note.archived ? 'unarchive' : 'archive'} size={14} />
      </button>
      <button
        type="button"
        class="icon-button"
        class:active={copyAction.state !== 'idle'}
        aria-label={copyLabel}
        title={copyLabel}
        onclick={copyNote}
      >
        <Icon name={copyAction.state === 'copied' ? 'check' : 'copy'} size={14} />
      </button>
      <span class="note-card-menu" use:menuRoot={menuKey}>
        <button
          type="button"
          class="icon-button note-card-menu-trigger"
          aria-label={m.notes.cardActions}
          title={m.notes.cardActions}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen(menuKey)}
          disabled={busy}
          onclick={() => toggleMenu(menuKey)}
        >
          <span class="note-card-menu-glyph" aria-hidden="true">⋯</span>
        </button>
        {#if isMenuOpen(menuKey)}
          <span class="popup-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onclick={() => {
                closeMenu()
                onmove(note)
              }}
            >
              {m.notes.moveToFolder}
            </button>
            <button
              type="button"
              role="menuitem"
              onclick={() => {
                closeMenu()
                void run({ locked: !note.locked })
              }}
            >
              {note.locked ? m.editor.unlock : m.editor.lock}
            </button>
          </span>
        {/if}
      </span>
    </span>
  {/if}
</div>

<style>
  .note-card {
    position: relative;
    min-width: 0;
    max-width: 100%;
  }

  .note-card:hover,
  .note-card:focus-within {
    border-color: var(--accent);
  }

  .note-card.dragging {
    opacity: 0.5;
  }

  .note-card-open {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    padding: 0;
    border: 0;
    /* The card no longer clips (its popup menu must overflow), so the button clips images itself. */
    border-radius: inherit;
    overflow: hidden;
    background: none;
    color: inherit;
    text-align: left;
    white-space: normal;
  }

  .note-card-open:focus-visible {
    outline-offset: -2px;
  }

  .note-card-images {
    display: grid;
    gap: 2px;
    width: 100%;
    height: 160px;
    overflow: hidden;
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }

  .note-card-images[data-count='2'] {
    grid-template-columns: 1fr 1fr;
  }

  .note-card-images[data-count='3'],
  .note-card-images[data-count='4'] {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }

  .note-card-images[data-count='3'] img:first-child {
    grid-row: span 2;
  }

  /* Zero minimums stop intrinsic image sizes from stretching the grid tracks. */
  .note-card-images img {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    object-fit: cover;
    background: var(--surface-muted);
  }

  .note-card-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    min-width: 0;
  }

  .note-card-actions {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 2px;
  }

  .note-card-menu {
    position: relative;
    display: inline-flex;
  }

  .note-card-menu-glyph {
    display: block;
    width: 14px;
    height: 14px;
    line-height: 14px;
    text-align: center;
  }

  /* Opacity rather than display/visibility keeps the buttons focusable. */
  .note-card-actions .icon-button {
    background: var(--surface);
    opacity: 0;
    transition: opacity 0.12s;
  }

  .note-card:hover .note-card-actions .icon-button,
  .note-card:focus-within .note-card-actions .icon-button,
  .note-card-actions .icon-button.active,
  .note-card-actions .icon-button[aria-expanded='true'] {
    opacity: 1;
  }

  /* Must out-rank the hover/focus-within reveal rules above. */
  .note-card-actions .icon-button:disabled,
  .note-card:hover .note-card-actions .icon-button:disabled,
  .note-card:focus-within .note-card-actions .icon-button:disabled {
    opacity: 0.5;
  }

  @media (hover: none) {
    .note-card-actions .icon-button {
      opacity: 1;
    }
  }

  .note-title {
    font-weight: 600;
    color: var(--text);
    overflow-wrap: anywhere;
    max-width: 100%;
    min-width: 0;
    padding-right: 88px;
  }

  .note-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-width: 100%;
  }

  .note-card-lock {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
  }

  .note-label-chip {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-muted);
    color: var(--text-muted);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
    max-width: 100%;
    min-width: 0;
  }

  .note-preview {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 10;
    line-clamp: 10;
    overflow: hidden;
    white-space: pre-line;
    color: var(--text-muted);
    font-size: 0.9rem;
    overflow-wrap: anywhere;
    max-width: 100%;
    min-width: 0;
  }

  /* Actions sit under the content so 44px buttons never cover the title. */
  @media (pointer: coarse) {
    .note-card-actions {
      position: static;
      justify-content: flex-end;
      padding: 0 4px 4px;
    }

    .note-title {
      padding-right: 0;
    }
  }
</style>
