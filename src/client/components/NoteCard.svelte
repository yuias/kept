<script lang="ts">
  import { sortLabelsCaseInsensitive } from '../../shared/labels'
  import type { NoteSummary, UpdateNoteInput } from '../../shared/types'
  import { messages } from '../lib/i18n.svelte'
  import Icon from './Icon.svelte'

  type CardPatch = Pick<UpdateNoteInput, 'pinned' | 'archived'>

  let {
    note,
    onopen,
    onupdate,
  }: {
    note: NoteSummary
    onopen: (id: string) => void
    onupdate: (id: string, patch: CardPatch) => Promise<void>
  } = $props()

  const m = $derived(messages())

  let busy = $state(false)

  async function run(patch: CardPatch): Promise<void> {
    busy = true
    try {
      await onupdate(note.id, patch)
    } finally {
      busy = false
    }
  }

  const pinLabel = $derived(note.pinned ? m.editor.unpin : m.editor.pin)
  const archiveLabel = $derived(note.archived ? m.editor.unarchive : m.editor.archive)
</script>

<div class="note-card card">
  <button
    type="button"
    class="note-card-open"
    onclick={() => onopen(note.id)}
    aria-label={!note.title && !note.preview ? m.notes.untitledNote : undefined}
  >
    <span class="note-card-text">
      {#if note.title}
        <span class="note-title">{note.title}</span>
      {/if}
      {#if note.preview}
        <span class="note-preview">{note.preview}</span>
      {/if}
      {#if note.labels.length > 0}
        <span class="note-labels">
          {#each sortLabelsCaseInsensitive(note.labels) as label (label)}
            <span class="note-label-chip">{label}</span>
          {/each}
        </span>
      {/if}
    </span>
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
    </span>
  {/if}
</div>

<style>
  .note-card {
    position: relative;
    overflow: hidden;
    min-width: 0;
    max-width: 100%;
  }

  .note-card:hover,
  .note-card:focus-within {
    border-color: var(--accent);
  }

  .note-card-open {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: inherit;
    text-align: left;
    white-space: normal;
  }

  .note-card-open:focus-visible {
    outline-offset: -2px;
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

  /* Opacity rather than display/visibility keeps the buttons focusable. */
  .note-card-actions button {
    background: var(--surface);
    opacity: 0;
    transition: opacity 0.12s;
  }

  .note-card:hover .note-card-actions button,
  .note-card:focus-within .note-card-actions button,
  .note-card-actions button.active {
    opacity: 1;
  }

  /* Must out-rank the hover/focus-within reveal rules above. */
  .note-card-actions button:disabled,
  .note-card:hover .note-card-actions button:disabled,
  .note-card:focus-within .note-card-actions button:disabled {
    opacity: 0.5;
  }

  @media (hover: none) {
    .note-card-actions button {
      opacity: 1;
    }
  }

  .note-title {
    font-weight: 600;
    color: var(--text);
    overflow-wrap: anywhere;
    max-width: 100%;
    min-width: 0;
    padding-right: 60px;
  }

  .note-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-width: 100%;
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
</style>
