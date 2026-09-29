<script lang="ts">
  import { TRASH_RETENTION_PRESETS } from '../../shared/retention'
  import type { AppSettings, ConcreteFormat, FolderSort } from '../../shared/types'
  import { describeApiError } from '../lib/errors'
  import { LOCALES, localeOverride, messages, setLocaleOverride, type Locale } from '../lib/i18n.svelte'
  import { settings, updateSettings } from '../lib/settings.svelte'
  import { en } from '../locales/en'
  import { ja } from '../locales/ja'

  const m = $derived(messages())
  const current = $derived(settings())
  const override = $derived(localeOverride())

  // Keep a stored non-preset value (the API accepts any 1..3650) selectable.
  const retentionOptions = $derived.by(() => {
    const days = current.trashRetentionDays
    const options = days !== null && !TRASH_RETENTION_PRESETS.includes(days) ? [...TRASH_RETENTION_PRESETS, days] : [...TRASH_RETENTION_PRESETS]
    return options.sort((a, b) => a - b)
  })

  let error = $state<string | null>(null)
  let saved = $state(false)

  // Each locale names itself in its own language, so the picker never needs translation.
  const LOCALE_LABELS: Record<Locale, string> = { en: en.meta.localeName, ja: ja.meta.localeName }

  async function save(patch: Partial<AppSettings>): Promise<void> {
    error = null
    saved = false
    try {
      await updateSettings(patch)
      saved = true
    } catch (cause) {
      error = describeApiError(cause, m)
    }
  }

  function handleFormat(event: Event): void {
    void save({ defaultFormat: (event.currentTarget as HTMLSelectElement).value as ConcreteFormat })
  }

  function handleSort(event: Event): void {
    void save({ folderSort: (event.currentTarget as HTMLSelectElement).value as FolderSort })
  }

  function handleRetention(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value
    void save({ trashRetentionDays: value === 'never' ? null : Number(value) })
  }

  // Per-browser only: localStorage, never sent to the Worker.
  function handleLocale(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value
    setLocaleOverride(value === 'auto' ? null : (value as Locale))
  }
</script>

<div class="settings-page">
  <h1>{m.settings.title}</h1>

  <div class="field">
    <label for="settings-default-format">{m.settings.defaultFormat}</label>
    <select id="settings-default-format" value={current.defaultFormat} onchange={handleFormat}>
      <option value="formatted">{m.editor.formatFormatted}</option>
      <option value="syntax">{m.editor.formatSyntax}</option>
    </select>
  </div>

  <div class="field">
    <label for="settings-folder-sort">{m.settings.folderSort}</label>
    <select id="settings-folder-sort" value={current.folderSort} onchange={handleSort}>
      <option value="name">{m.settings.sortName}</option>
      <option value="created">{m.settings.sortCreated}</option>
      <option value="updated">{m.settings.sortUpdated}</option>
      <option value="manual">{m.settings.sortManual}</option>
    </select>
  </div>

  <div class="field">
    <label for="settings-trash-retention">{m.settings.trashRetention}</label>
    <select
      id="settings-trash-retention"
      value={current.trashRetentionDays === null ? 'never' : String(current.trashRetentionDays)}
      onchange={handleRetention}
    >
      {#each retentionOptions as days (days)}
        <option value={String(days)}>{m.settings.trashRetentionDays(days)}</option>
      {/each}
      <option value="never">{m.settings.trashRetentionNever}</option>
    </select>
    <p class="hint">{m.settings.trashRetentionHint}</p>
  </div>

  <div class="field">
    <label for="settings-language">{m.settings.language}</label>
    <select id="settings-language" value={override ?? 'auto'} onchange={handleLocale}>
      <option value="auto">{m.settings.languageAuto}</option>
      {#each LOCALES as code (code)}
        <option value={code}>{LOCALE_LABELS[code]}</option>
      {/each}
    </select>
  </div>

  {#if saved}
    <p class="status">{m.settings.saved}</p>
  {/if}
  {#if error}
    <p class="status error">{error}</p>
  {/if}
</div>

<style>
  .settings-page {
    max-width: 32rem;
    margin: 0 auto;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field label {
    font-weight: 600;
    color: var(--text-muted);
  }

  .hint {
    margin: 0;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .status {
    margin: 0;
  }

  .status.error {
    color: var(--danger);
  }
</style>
