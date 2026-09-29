<script lang="ts">
  import type { NoteSummary, UpdateNoteInput } from '../../shared/types'
  import NoteCard from './NoteCard.svelte'

  let {
    notes,
    onopen,
    onupdate,
    onmove,
  }: {
    notes: NoteSummary[]
    onopen: (id: string) => void
    onupdate: (id: string, patch: Pick<UpdateNoteInput, 'pinned' | 'archived'>) => Promise<void>
    onmove: (note: NoteSummary) => void
  } = $props()

  let container: HTMLDivElement | undefined
  let width = $state(0)

  $effect(() => {
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) width = entry.contentRect.width
    })
    observer.observe(container)
    return () => observer.disconnect()
  })

  // Round-robin assignment keeps reading order row-major, matching how a
  // masonry grid without JS-computed heights is expected to read.
  const columns = $derived(Math.max(1, Math.floor(width / 240)))
  const buckets = $derived.by(() => {
    const result: NoteSummary[][] = Array.from({ length: columns }, () => [])
    notes.forEach((note, i) => result[i % columns]!.push(note))
    return result
  })
</script>

<div class="note-grid" bind:this={container}>
  {#each buckets as bucket, i (i)}
    <div class="note-column">
      {#each bucket as note (note.id)}
        <NoteCard {note} {onopen} {onupdate} {onmove} />
      {/each}
    </div>
  {/each}
</div>

<style>
  .note-grid {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .note-column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
</style>
