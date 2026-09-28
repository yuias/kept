import { isDevMode } from './auth'
import type { AppEnv } from './http'

const DAY_MS = 86_400_000

/** Used when `BACKUP_RETENTION_DAYS` is missing or not a usable number. */
const DEFAULT_RETENTION_DAYS = 56

/** Local runs write here so testing the handler never lands among real backups. */
const PREFIX = isDevMode ? 'dev-backups/' : 'backups/'

/**
 * The export API dumps asynchronously and only hands back a download URL once it
 * has finished, so the request has to be repeated until it reports completion.
 */
const POLL_INTERVAL_MS = 2_000
const MAX_POLLS = 15

interface ExportResult {
  status?: string
  at_bookmark?: string
  error?: string
  result?: { filename?: string; signed_url?: string }
}

interface ApiEnvelope {
  success: boolean
  errors?: { code: number; message: string }[]
  result?: ExportResult
}

/** Runs one backup: export the database, store the dump, drop what has expired. */
export async function runBackup(env: AppEnv, now: number): Promise<void> {
  if (!env.D1_EXPORT_API_TOKEN) {
    throw new Error('D1_EXPORT_API_TOKEN is not set; the export API cannot be called')
  }

  const signedUrl = await exportDatabase(env)
  const key = await storeBackup(env, signedUrl, now)
  const removed = await deleteExpired(env, now)

  console.log(`backup: wrote ${key}, removed ${removed} expired object(s)`)
}

async function exportDatabase(env: AppEnv): Promise<string> {
  let bookmark: string | null = null

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const result = await requestExport(env, bookmark)

    if (result.status === 'error') {
      throw new Error(`export failed: ${result.error ?? 'no reason given'}`)
    }

    const signedUrl = result.result?.signed_url
    if (result.status === 'complete' && signedUrl) return signedUrl

    // Every poll has to quote the latest bookmark back; a request without one
    // starts a fresh export instead of continuing the running one.
    bookmark = result.at_bookmark ?? bookmark
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`export did not finish within ${MAX_POLLS} polls`)
}

async function requestExport(env: AppEnv, bookmark: string | null): Promise<ExportResult> {
  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}` +
    `/d1/database/${env.D1_DATABASE_ID}/export`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.D1_EXPORT_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      output_format: 'polling',
      ...(bookmark ? { current_bookmark: bookmark } : {}),
    }),
  })

  const body = (await response.json()) as ApiEnvelope

  if (!response.ok || !body.success) {
    const reason = body.errors?.map((error) => error.message).join('; ') || `HTTP ${response.status}`
    throw new Error(`export request rejected: ${reason}`)
  }

  return body.result ?? {}
}

async function storeBackup(env: AppEnv, signedUrl: string, now: number): Promise<string> {
  // The signed URL is only valid for an hour, so it is spent straight away.
  const download = await fetch(signedUrl)
  if (!download.ok) throw new Error(`could not download the dump: HTTP ${download.status}`)

  const key = `${PREFIX}${new Date(now).toISOString().slice(0, 10)}.sql`

  await env.BACKUPS.put(key, await download.arrayBuffer(), {
    httpMetadata: { contentType: 'application/sql' },
    // Stamping the expiry at write time is what keeps a change to
    // BACKUP_RETENTION_DAYS from reaching backwards into existing backups.
    customMetadata: { expiresAt: String(now + retentionDays(env) * DAY_MS) },
  })

  return key
}

async function deleteExpired(env: AppEnv, now: number): Promise<number> {
  const listed = await env.BACKUPS.list({ prefix: PREFIX, include: ['customMetadata'] })
  const expired = listed.objects.filter((object) => expiryOf(object, env) <= now)

  if (expired.length > 0) await env.BACKUPS.delete(expired.map((object) => object.key))
  return expired.length
}

/** Anything written without a stamp is judged by the retention in force now. */
function expiryOf(object: R2Object, env: AppEnv): number {
  const stamped = Number(object.customMetadata?.expiresAt)
  return Number.isFinite(stamped) && stamped > 0
    ? stamped
    : object.uploaded.getTime() + retentionDays(env) * DAY_MS
}

function retentionDays(env: AppEnv): number {
  const days = Number(env.BACKUP_RETENTION_DAYS)
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
