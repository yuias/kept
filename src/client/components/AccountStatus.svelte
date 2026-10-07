<script lang="ts">
  import { messages } from '../lib/i18n.svelte'
  import { SIGN_IN_URL, SIGN_OUT_URL, session } from '../lib/session.svelte'

  const me = $derived(session())
  const m = $derived(messages())
</script>

{#if me.loaded}
  <span class="account-status">
    <span class="identity" class:stale={me.me.stale}>
      {#if me.me.authenticated}
        {me.me.email}{#if me.me.dev}
          <span class="badge">{m.nav.dev}</span>
        {/if}
      {:else if me.me.stale}
        {m.nav.sessionStale}
      {:else}
        {m.nav.notSignedIn}
      {/if}
    </span>
    <!-- Access is not in front of the Worker in dev, so neither URL exists. -->
    {#if !me.me.dev}
      <!-- A stale token gets signing out, not signing in: Access would wave
           the same token through and land the reader right back here. -->
      {#if me.me.authenticated || me.me.stale}
        <a class="auth-link" href={SIGN_OUT_URL}>{m.nav.signOut}</a>
      {:else}
        <a class="auth-link" href={SIGN_IN_URL}>{m.nav.signIn}</a>
      {/if}
    {/if}
  </span>
{/if}
