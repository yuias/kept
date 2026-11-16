<script lang="ts">
  import { messages } from '../../lib/i18n.svelte'

  const { onlink, oncard }: { onlink: () => void; oncard: () => void } = $props()

  const m = $derived(messages().editor)
</script>

<!-- mousedown is prevented so the editor keeps its focus until the click lands. -->
<div class="paste-choice" role="group" aria-label={m.pasteAsLabel}>
  <button type="button" onmousedown={(event) => event.preventDefault()} onclick={onlink}>{m.pasteAsLink}</button>
  <button type="button" onmousedown={(event) => event.preventDefault()} onclick={oncard}>{m.pasteAsCard}</button>
</div>

<style>
  .paste-choice {
    display: flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  }

  button {
    min-width: 0;
    min-height: 0;
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;
  }

  button:hover {
    background: var(--surface-muted);
  }
</style>
