<script lang="ts">
  import { messages } from '../lib/i18n.svelte'
  import { nextTheme, setTheme, theme, themeLabel } from '../lib/theme.svelte'

  const m = $derived(messages())
  const mode = $derived(theme())
  const label = $derived(themeLabel(mode, m))

  function cycle() {
    setTheme(nextTheme(mode))
  }
</script>

<button
  class="theme-toggle"
  type="button"
  aria-label="{m.nav.theme}: {label}"
  title="{m.nav.theme}: {label}"
  onclick={cycle}
>
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    {#if mode === 'light'}
      <circle cx="8" cy="8" r="3.2" />
      <path
        d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13"
      />
    {:else if mode === 'dark'}
      <path d="M13.6 10.3A6 6 0 0 1 5.7 2.4 6 6 0 1 0 13.6 10.3Z" fill="currentColor" />
    {:else}
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2a6 6 0 0 0 0 12Z" fill="currentColor" stroke="none" />
    {/if}
  </svg>
</button>

<style>
  .theme-toggle {
    padding: 4px 6px;
    color: var(--text-muted);
  }

  .theme-toggle svg {
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  @media (pointer: coarse) {
    .theme-toggle {
      min-width: 44px;
      justify-content: center;
    }
  }
</style>
