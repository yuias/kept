<script lang="ts">
  import { messages } from '../../lib/i18n.svelte'

  const { onpointerdown }: { onpointerdown: (event: PointerEvent) => void } = $props()

  const m = $derived(messages().editor)

  let button = $state<HTMLButtonElement>()
  // A native listener: the drag captures the pointer, which has to happen while the
  // press is being dispatched, and Svelte's delegated handlers run after it.
  $effect(() => {
    if (!button) return
    const handler = onpointerdown
    button.addEventListener('pointerdown', handler)
    return () => button!.removeEventListener('pointerdown', handler)
  })
</script>

<!-- mousedown is prevented so the editor keeps its focus and its selection while the handle is used. -->
<!-- Not focusable: the keyboard path is Mod-Shift-Arrow in the editor. -->
<button
  type="button"
  class="block-handle"
  tabindex="-1"
  aria-label={m.blockHandle}
  title={m.blockHandle}
  bind:this={button}
  onmousedown={(event) => event.preventDefault()}
>
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">
    <circle cx="5.5" cy="3.5" r="1.2" />
    <circle cx="10.5" cy="3.5" r="1.2" />
    <circle cx="5.5" cy="8" r="1.2" />
    <circle cx="10.5" cy="8" r="1.2" />
    <circle cx="5.5" cy="12.5" r="1.2" />
    <circle cx="10.5" cy="12.5" r="1.2" />
  </svg>
</button>

<style>
  .block-handle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    min-width: 0;
    height: 24px;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: grab;
    /* The drag is the handle's own; the browser must not scroll or select instead. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .block-handle:hover {
    background: var(--surface-muted);
    color: var(--text);
  }
</style>
