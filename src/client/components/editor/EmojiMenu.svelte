<script module lang="ts">
  import type { EmojiEntry } from '../../lib/lexical/emoji'

  export interface EmojiMenuState {
    items: readonly EmojiEntry[]
    active: number
  }
</script>

<script lang="ts">
  import { messages } from '../../lib/i18n.svelte'

  const {
    subscribe,
    onpick,
    onhover,
  }: {
    /** Calls the listener with the list now and after every change; returns the unsubscribe. */
    subscribe: (listener: (state: EmojiMenuState) => void) => () => void
    onpick: (entry: EmojiEntry) => void
    onhover: (index: number) => void
  } = $props()

  const m = $derived(messages().editor)

  let state = $state<EmojiMenuState>({ items: [], active: 0 })
  $effect(() => subscribe((next) => (state = next)))
</script>

<!-- mousedown is prevented so the editor keeps its focus and its caret, which the pick acts on. -->
<div class="emoji-menu" role="listbox" tabindex="-1" aria-label={m.emojiSuggestions} onmousedown={(event) => event.preventDefault()}>
  {#each state.items as item, index (item.name)}
    <button
      type="button"
      role="option"
      tabindex="-1"
      aria-selected={index === state.active}
      onclick={() => onpick(item)}
      onmouseenter={() => onhover(index)}
    >
      <span class="glyph">{item.emoji}</span>
      <span class="name">{item.name}</span>
    </button>
  {/each}
</div>

<style>
  .emoji-menu {
    display: flex;
    flex-direction: column;
    min-width: 11rem;
    max-width: calc(100vw - 2rem);
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
    user-select: none;
    -webkit-user-select: none;
  }

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 0;
    padding: 5px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9em;
    text-align: left;
    cursor: pointer;
  }

  button[aria-selected='true'] {
    background: var(--surface-muted);
  }

  .glyph {
    flex: none;
    width: 1.4em;
    text-align: center;
    font-size: 1.15em;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (pointer: coarse) {
    button {
      padding: 10px 12px;
    }
  }
</style>
