import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'

interface SettingsRow {
  data: string
}

export async function loadSettings(db: D1Database, owner: string): Promise<AppSettings> {
  const row = await db.prepare('SELECT data FROM settings WHERE owner = ?').bind(owner).first<SettingsRow>()
  if (!row) return { ...DEFAULT_SETTINGS }
  // Merge over the defaults so a settings row written before a new key
  // existed still reports a complete AppSettings.
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.data) as Partial<AppSettings>) }
}
