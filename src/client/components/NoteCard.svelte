<script lang="ts">
  import { sortLabelsCaseInsensitive } from '../../shared/labels'
  import type { NoteSummary } from '../../shared/types'
  import { messages } from '../lib/i18n.svelte'

  let { note, onopen }: { note: NoteSummary; onopen: (id: string) => void } = $props()

  const m = $derived(messages())
</script>

<button type="button" class="note-card card" onclick={() => onopen(note.id)}>
  {#if note.pinned}
    <span class="pin" aria-label={m.notes.pinnedIndicator} title={m.notes.pinnedIndicator}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          d="M8 1.5a2 2 0 0 1 2 2v3.2l1.8 2.7a.6.6 0 0 1-.5.9H9v3.7a1 1 0 0 1-2 0V10.3H4.7a.6.6 0 0 1-.5-.9L6 6.7V3.5a2 2 0 0 1 2-2Z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    </span>
  {/if}
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
</button>

<style>
  .note-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 12px 14px;
    text-align: left;
    white-space: normal;
    align-items: flex-start;
  }

  .note-card:hover {
    border-color: var(--accent);
  }

  .pin {
    color: var(--accent);
  }

  .note-title {
    font-weight: 600;
    color: var(--text);
  }

  .note-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .note-label-chip {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-muted);
    color: var(--text-muted);
    font-size: 0.75rem;
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
  }
</style>
