<script lang="ts">
  import { messages } from '../../lib/i18n.svelte'
  import type { FormatBarState } from '../../lib/lexical/format'
  import Icon from '../Icon.svelte'

  type Format = 'bold' | 'italic' | 'strikethrough' | 'code'

  const {
    subscribe,
    onformat,
    onlink,
    onunlink,
    onfocuseditor,
  }: {
    /** Calls the listener with the active formats now and after every change; returns the unsubscribe. */
    subscribe: (listener: (active: FormatBarState['active']) => void) => () => void
    onformat: (format: Format) => void
    /** True when the URL was accepted; false keeps the field open. */
    onlink: (url: string) => boolean
    onunlink: () => void
    onfocuseditor: () => void
  } = $props()

  const m = $derived(messages().editor)

  let active = $state<FormatBarState['active']>(new Set())
  $effect(() => subscribe((next) => (active = next)))

  const FORMATS: ReadonlyArray<{ format: Format; label: 'barBold' | 'barItalic' | 'barStrikethrough' | 'barCode'; glyph: string }> = [
    { format: 'bold', label: 'barBold', glyph: 'B' },
    { format: 'italic', label: 'barItalic', glyph: 'I' },
    { format: 'strikethrough', label: 'barStrikethrough', glyph: 'S' },
    { format: 'code', label: 'barCode', glyph: '</>' },
  ]

  let editing = $state(false)
  let invalid = $state(false)
  let draft = $state('')

  function apply(): void {
    if (onlink(draft)) {
      editing = false
      onfocuseditor()
    } else {
      invalid = true
    }
  }

  function toggleLink(): void {
    if (active.has('link')) return onunlink()
    draft = ''
    invalid = false
    editing = true
  }

  // The field is outside the editor's root, so only the keys the page itself handles matter:
  // Esc would close the note's dialog unless its default is prevented. Native listener,
  // because Svelte's delegated ones run after the ancestors'.
  function field(node: HTMLInputElement) {
    const keydown = (event: KeyboardEvent): void => {
      event.stopPropagation()
      // Enter that confirms an IME conversion is not a commit.
      if (event.isComposing) return
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      event.preventDefault()
      if (event.key === 'Enter') {
        apply()
      } else {
        editing = false
        onfocuseditor()
      }
    }
    node.addEventListener('keydown', keydown)
    node.focus()
    return { destroy: () => node.removeEventListener('keydown', keydown) }
  }

  // The buttons must not take the focus: the editor keeps its selection, which they act on.
  function keepFocus(event: MouseEvent): void {
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
  }
</script>

<div class="format-bar" role="toolbar" tabindex="-1" aria-label={m.barLabel} onmousedown={keepFocus}>
  {#if editing}
    <input
      type="text"
      inputmode="url"
      enterkeyhint="done"
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      placeholder="https://"
      aria-label={m.barLinkUrl}
      aria-invalid={invalid}
      bind:value={draft}
      oninput={() => (invalid = false)}
      use:field
    />
    <button type="button" aria-label={m.barLinkApply} title={m.barLinkApply} onclick={apply}><Icon name="check" size={14} /></button>
  {:else}
    {#each FORMATS as { format, label, glyph } (format)}
      <button
        type="button"
        class={format}
        aria-label={m[label]}
        title={m[label]}
        aria-pressed={active.has(format)}
        onclick={() => onformat(format)}>{glyph}</button
      >
    {/each}
    <button
      type="button"
      aria-label={active.has('link') ? m.barUnlink : m.barLink}
      title={active.has('link') ? m.barUnlink : m.barLink}
      aria-pressed={active.has('link')}
      onclick={toggleLink}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.5 9.5l3-3" />
        <path d="M7 4.5l.9-.9a2.5 2.5 0 0 1 3.5 3.5l-.9.9" />
        <path d="M9 11.5l-.9.9a2.5 2.5 0 0 1-3.5-3.5l.9-.9" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .format-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
    user-select: none;
    -webkit-user-select: none;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 30px;
    min-height: 0;
    height: 28px;
    padding: 0 6px;
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

  button[aria-pressed='true'] {
    background: var(--surface-muted);
    color: var(--accent);
  }

  .bold {
    font-weight: 700;
  }

  .italic {
    font-style: italic;
  }

  .strikethrough {
    text-decoration: line-through;
  }

  .code {
    font-family: var(--mono);
    font-size: 0.8em;
  }

  input {
    box-sizing: border-box;
    width: 14rem;
    max-width: calc(100vw - 6rem);
    height: 28px;
    min-height: 0;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.9em;
  }

  input[aria-invalid='true'] {
    border-color: var(--danger);
  }

  @media (pointer: coarse) {
    button,
    input {
      height: 36px;
    }

    button {
      min-width: 38px;
    }

    /* Below 16px iOS zooms the page when the field takes the focus. */
    input {
      font-size: 16px;
    }
  }
</style>
