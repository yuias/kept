<script lang="ts">
  import { messages } from '../lib/i18n.svelte'
  import { currentRoute, navigate } from '../lib/router.svelte'

  const m = $derived(messages())
  const route = $derived(currentRoute())

  // Set from the effect below, which also runs on mount, so the box starts
  // in step with the current route without capturing a stale initial value.
  let value = $state('')
  let helpOpen = $state(false)
  let inputEl: HTMLInputElement | undefined
  let containerEl: HTMLDivElement | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  // Keeps the box in step with navigation that did not originate here (Back
  // button, a sidebar link away from search). Also drops a pending debounce
  // from before the route changed elsewhere, so it cannot fire afterwards and
  // stomp on the new location.
  $effect(() => {
    value = route.name === 'search' ? route.q : ''
    clearTimeout(debounceTimer)
  })

  // Never puts a trimmed string in the URL: `route.q` must round-trip to
  // exactly `value`, or the sync effect above would edit the input's text
  // (dropping trailing spaces) out from under whatever the user is typing.
  function go(replace: boolean): void {
    navigate(value.trim() ? `/search?q=${encodeURIComponent(value)}` : '/', { replace })
  }

  function handleInput(): void {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => go(true), 300)
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      clearTimeout(debounceTimer)
      go(false)
    } else if (event.key === 'Escape') {
      clearTimeout(debounceTimer)
      value = ''
      helpOpen = false
      navigate('/')
      inputEl?.blur()
    }
  }

  function handleWindowClick(event: MouseEvent): void {
    if (helpOpen && containerEl && !containerEl.contains(event.target as Node)) helpOpen = false
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="search-box" bind:this={containerEl}>
  <svg class="search-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="6.8" cy="6.8" r="4.8" />
    <path d="M10.4 10.4 14 14" />
  </svg>
  <input
    bind:this={inputEl}
    bind:value
    type="search"
    class="search-input"
    placeholder={m.search.placeholder}
    aria-label={m.search.ariaLabel}
    oninput={handleInput}
    onkeydown={handleKeydown}
  />
  <button
    type="button"
    class="search-help-toggle ghost"
    aria-label={m.search.helpLabel}
    aria-expanded={helpOpen}
    onclick={() => (helpOpen = !helpOpen)}
  >
    ?
  </button>
  {#if helpOpen}
    <div class="search-help card">
      <p>{m.search.helpIntro}</p>
      <ul>
        <li>{m.search.helpWords}</li>
        <li>{m.search.helpPhrase}</li>
        <li>{m.search.helpOr}</li>
        <li>{m.search.helpLabelFilter}</li>
        <li>{m.search.helpRegex}</li>
      </ul>
    </div>
  {/if}
</div>

<style>
  .search-box {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    width: min(480px, 100%);
    margin: 0 auto;
    padding: 4px 6px 4px 10px;
    border-radius: var(--radius);
    background: var(--surface-muted);
  }

  .search-icon {
    flex-shrink: 0;
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    padding: 4px 0;
  }

  .search-input:focus-visible {
    outline: none;
  }

  .search-help-toggle {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .search-help {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 20;
    padding: 12px 14px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .search-help p {
    margin: 0 0 6px;
    color: var(--text);
  }

  .search-help ul {
    margin: 0;
    padding-left: 18px;
  }

  .search-help li {
    margin-bottom: 4px;
  }

  @media (max-width: 720px) {
    /* .top-bar is sticky, so the help panel anchors to it and spans the screen. */
    .search-box {
      position: static;
      width: 100%;
    }

    .search-help {
      left: 8px;
      right: 8px;
    }
  }

  @media (pointer: coarse) {
    .search-box {
      padding: 0 0 0 10px;
    }

    .search-help-toggle {
      min-width: 44px;
      min-height: 44px;
      justify-content: center;
    }
  }
</style>
