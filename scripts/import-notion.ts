// Converts an unzipped Notion "Markdown & CSV" export into a D1 SQL file and
// WebP images for R2, placed under a new `imported` folder.
//
//   node scripts/import-notion.ts --src <export-dir> --out <out-dir> --owner <email>
//     [--base-url https://kept.example.com] [--skip <top-level page name>]...
//
// Then: `sh <out-dir>/apply.sh --local` (or `--remote`).
//
// Note and folder ids are deterministic, so a re-import into the same account
// needs every folder and note of the earlier import gone for good. Deleting the
// `imported` folder moves its whole tree to the trash; emptying the trash (or
// deleting those notes forever) removes them.
//
// Unzip with `ditto -x -k` on macOS: `unzip` garbles the non-ASCII names that
// Notion stores without the UTF-8 flag.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { runnerImport } from 'vite'
import { addEmptyHeaders, bookmarksToCards, collapseBlockGaps, csvTable, joinBrokenTableRows } from './notion-markdown.ts'

const { values: args } = parseArgs({
  options: {
    src: { type: 'string' },
    out: { type: 'string' },
    owner: { type: 'string' },
    'base-url': { type: 'string' },
    skip: { type: 'string', multiple: true, default: [] },
  },
})
if (!args.src || !args.out || !args.owner) {
  console.error('usage: node scripts/import-notion.ts --src <dir> --out <dir> --owner <email> [--base-url <url>] [--skip <name>]...')
  process.exit(1)
}
const SRC = resolve(args.src)
const OUT = resolve(args.out)
const OWNER = args.owner
const BASE_URL = args['base-url']?.replace(/\/+$/, '')
const SKIP = new Set(args.skip)

// Loaded through Vite so the extensionless imports inside src/ resolve.
const { module: plaintext } = await runnerImport<typeof import('../src/shared/plaintext.ts')>(
  resolve(import.meta.dirname, '../src/shared/plaintext.ts'),
  { configFile: false, logLevel: 'silent' },
)
const { module: limits } = await runnerImport<typeof import('../src/shared/limits.ts')>(
  resolve(import.meta.dirname, '../src/shared/limits.ts'),
  { configFile: false, logLevel: 'silent' },
)
const { module: linkCard } = await runnerImport<typeof import('../src/shared/link-card.ts')>(
  resolve(import.meta.dirname, '../src/shared/link-card.ts'),
  { configFile: false, logLevel: 'silent' },
)

const NOTION_ID = /([0-9a-f]{32})(?=(?:_all)?\.(?:md|csv)$)/
const IMPORT_NOW = Date.now()

// Deterministic ids keep reruns (local, then remote) producing the same ids,
// so links and image URLs written into bodies stay valid.
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
function keptId(seed: string): string {
  let n = BigInt('0x' + createHash('sha256').update(seed).digest('hex'))
  let id = ''
  for (let i = 0; i < 12; i++) {
    id += BASE62[Number(n % 62n)]
    n /= 62n
  }
  return id
}

interface Page {
  notionId: string
  file: string
  title: string
  props: Map<string, string>
  body: string
  /** Pages in the sibling directory named after this page. */
  children: Page[]
  /** The rows' directory when this page is only a database view. */
  databaseDir: string | null
}

function stripId(name: string): string {
  return name.replace(/ [0-9a-f]{32}(?:_all)?\.(?:md|csv)$/, '')
}

function readPage(file: string, isDatabaseRow: boolean): Page {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')

  // A long title wraps onto following lines up to the first blank line.
  let i = 0
  const titleLines: string[] = []
  while (i < lines.length && lines[i] !== '') titleLines.push(lines[i++]!)
  const title = titleLines.join(' ').replace(/^# /, '').replace(/\s+/g, ' ').trim()
  while (lines[i] === '') i++

  // Only database rows carry a property block, so plain child pages are never
  // at risk of losing a first paragraph that happens to look like `Key: value`.
  const props = new Map<string, string>()
  if (isDatabaseRow) {
    while (i < lines.length && /^[^:\n]{1,40}: /.test(lines[i]!)) {
      const line = lines[i++]!
      const at = line.indexOf(': ')
      props.set(line.slice(0, at), line.slice(at + 2).trim())
    }
    while (lines[i] === '') i++
  }

  const body = lines.slice(i).join('\n').trimEnd()
  const notionId = NOTION_ID.exec(basename(file))![1]!

  // A database's own page holds only the CSV link and its view's filters/sort.
  const csvOnly = /^\[[^\]]*\]\([^)]*_all\.csv\)(\n+(filters|sort): ?\n[\s\S]*)?$/.test(body)
  const pageDir = join(dirname(file), stripId(basename(file)))
  const hasDir = statSync(pageDir, { throwIfNoEntry: false })?.isDirectory() ?? false

  const page: Page = { notionId, file, title, props, body, children: [], databaseDir: null }
  if (!hasDir) return page

  if (csvOnly) {
    page.databaseDir = pageDir
    page.children = listPages(pageDir).map((f) => readPage(f, true))
  } else {
    // Subdirectories other than child pages hold rows of inline databases,
    // whose content is read from the CSV instead.
    page.children = listPages(pageDir).map((f) => readPage(f, false))
  }
  return page
}

function listPages(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => NOTION_ID.test(name) && name.endsWith('.md'))
    .sort()
    .map((name) => join(dir, name))
}

// Notion writes dates in the workspace user's local time, assumed to be JST.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function parseNotionDate(value: string | undefined): number | null {
  if (!value) return null
  let m = /^(\w+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) (AM|PM))?$/.exec(value)
  if (m) {
    const month = MONTHS.indexOf(m[1]!)
    if (month < 0) return null
    let hour = Number(m[4] ?? 0) % 12
    if (m[6] === 'PM') hour += 12
    return Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5] ?? 0)) - JST_OFFSET_MS
  }
  m = /^@?(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (m) return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])) - JST_OFFSET_MS
  return null
}

function pageDates(page: Page): { created: number; updated: number } | null {
  const created = parseNotionDate(page.props.get('Created') ?? page.props.get('Created Date'))
  const updated = parseNotionDate(page.props.get('Last edited time') ?? page.props.get('Last Edited Time'))
  if (created === null && updated === null) return null
  return { created: created ?? updated!, updated: updated ?? created! }
}

interface ImageOut {
  id: string
  file: string
  width: number
  height: number
  bytes: number
}
const images = new Map<string, ImageOut>()

function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file)
  if (buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`not a PNG: ${file}`)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function convertImage(source: string, seed: string): ImageOut {
  const cached = images.get(seed)
  if (cached) return cached

  const id = keptId(`image:${seed}`)
  const { width: w, height: h } = pngSize(source)
  const scale = Math.min(1, limits.IMAGE_MAX_EDGE / Math.max(w, h))
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)
  const file = join(OUT, 'images', `${id}.webp`)
  execFileSync('cwebp', ['-quiet', '-q', String(limits.IMAGE_WEBP_QUALITY), '-resize', String(width), String(height), source, '-o', file])

  const out = { id, file, width, height, bytes: statSync(file).size }
  images.set(seed, out)
  return out
}

const notesByNotionId = new Map<string, { id: string; title: string }>()

function rewriteBody(page: Page): string {
  const dir = dirname(page.file)
  // Notion breaks a table row at a newline inside a cell; this runs first because
  // the parser misreads such rows. Notion's export does not say whether a page
  // table had a header row, so page tables get an empty one. Tables built from
  // database CSVs are substituted below, after this, and keep their real header.
  let body = addEmptyHeaders(joinBrokenTableRows(page.body))

  // The export writes a bookmark block as a paragraph holding only a link, the
  // same as a link typed on its own line, so every such paragraph becomes a
  // card. List items stay links: older Notion could not put bookmarks in lists.
  // This runs before page links are made absolute so those stay links.
  body = bookmarksToCards(body, linkCard.cardMarkup)

  // An inline database is a lone link line to its CSV.
  body = body.replace(/^\[[^\]]*\]\(([^)]*_all\.csv)\)$/gm, (_, href: string) => csvTable(readFileSync(join(dir, decodeURIComponent(href)), 'utf8')))

  body = body.replace(/!\[([^\]]*)\]\(([^)]*attachments\/[^)]+)\)/g, (_, alt: string, href: string) => {
    const source = join(dir, decodeURIComponent(href))
    const image = convertImage(source, href.replace(/^.*attachments\//, ''))
    return `![${alt}](/img/${image.id})`
  })

  // Relative hrefs are not clickable in the editor, so page links become
  // absolute when the deployment URL is known and plain text otherwise.
  body = body.replace(/\[([^\]]*)\]\(([^)]*?([0-9a-f]{32})\.md)\)/g, (match, text: string, _href, notionId: string) => {
    const target = notesByNotionId.get(notionId)
    if (!target) return match
    return BASE_URL ? `[${text || target.title}](${BASE_URL}/?note=${target.id})` : text || target.title
  })

  const lead: string[] = []
  const url = page.props.get('URL')
  const status = page.props.get('Status')
  if (url) lead.push(url)
  if (status) lead.push(`Status: ${status}`)
  return collapseBlockGaps([...lead, body].filter((s) => s !== '').join('\n\n'))
}

// Collect the tree.
const topLevel = listPages(SRC)
  .map((f) => readPage(f, false))
  .filter((p) => !SKIP.has(p.title) && (p.body !== '' || p.children.length > 0))

function registerIds(page: Page): void {
  if (page.databaseDir === null) notesByNotionId.set(page.notionId, { id: keptId(`note:${page.notionId}`), title: page.title })
  page.children.forEach(registerIds)
}
topLevel.forEach(registerIds)

mkdirSync(join(OUT, 'images'), { recursive: true })

const sql: string[] = []
const q = (s: string | null) => (s === null ? 'NULL' : `'${s.replace(/'/g, "''")}'`)
const counts = { folders: 0, notes: 0, images: 0 }

const ROOT_ID = keptId('folder:imported')
sql.push(
  `INSERT INTO folders (id, owner, parent_id, name, sort_order, created_at, updated_at) VALUES (${q(ROOT_ID)}, ${q(OWNER)}, NULL, 'imported', ` +
    `(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders WHERE owner = ${q(OWNER)} AND parent_id IS NULL), ${IMPORT_NOW}, ${IMPORT_NOW});`,
)
counts.folders++

const folderOrder = new Map<string, number>()
function addFolder(seed: string, parentId: string, name: string): string {
  const id = keptId(`folder:${seed}`)
  const order = folderOrder.get(parentId) ?? 0
  folderOrder.set(parentId, order + 1)
  const trimmed = name.slice(0, limits.FOLDER_NAME_MAX_CHARS)
  sql.push(
    `INSERT INTO folders (id, owner, parent_id, name, sort_order, created_at, updated_at) VALUES (${q(id)}, ${q(OWNER)}, ${q(parentId)}, ${q(trimmed)}, ${order}, ${IMPORT_NOW}, ${IMPORT_NOW});`,
  )
  counts.folders++
  return id
}

// D1 rejects SQL statements over 100 KB, so long bodies are appended in chunks.
// The first INSERT carries a chunk of both body and body_plain; at up to 4
// bytes per character that stays near 80 KB.
const CHUNK_CHARS = 10_000
function addNote(page: Page, folderId: string, fallback: { created: number; updated: number }): void {
  const id = notesByNotionId.get(page.notionId)!.id
  const dates = pageDates(page) ?? fallback
  const body = rewriteBody(page)
  const plain = plaintext.markdownToPlain(body)
  if (Buffer.byteLength(body) > limits.BODY_MAX_BYTES) throw new Error(`body too large: ${page.file}`)

  sql.push(
    `INSERT INTO notes (id, owner, folder_id, title, body, body_plain, format, pinned, archived, locked, created_at, updated_at) VALUES ` +
      `(${q(id)}, ${q(OWNER)}, ${q(folderId)}, ${q(page.title.slice(0, limits.TITLE_MAX_CHARS))}, ${q(body.slice(0, CHUNK_CHARS))}, ${q(plain.slice(0, CHUNK_CHARS))}, 'inherit', 0, 0, 0, ${dates.created}, ${dates.updated});`,
  )
  for (const [column, text] of [['body', body], ['body_plain', plain]] as const) {
    for (let at = CHUNK_CHARS; at < text.length; at += CHUNK_CHARS) {
      sql.push(`UPDATE notes SET ${column} = ${column} || ${q(text.slice(at, at + CHUNK_CHARS))} WHERE id = ${q(id)};`)
    }
  }
  counts.notes++
}

function emit(page: Page, parentFolderId: string, fallback: { created: number; updated: number }): void {
  const dates = pageDates(page) ?? fallback
  if (page.databaseDir !== null) {
    const folderId = addFolder(page.notionId, parentFolderId, page.title)
    for (const child of page.children) emit(child, folderId, dates)
  } else if (page.children.length > 0) {
    const folderId = addFolder(page.notionId, parentFolderId, page.title)
    addNote(page, folderId, dates)
    for (const child of page.children) emit(child, folderId, dates)
  } else {
    addNote(page, parentFolderId, dates)
  }
}

const importTime = { created: IMPORT_NOW, updated: IMPORT_NOW }
for (const page of topLevel) emit(page, ROOT_ID, importTime)

for (const image of images.values()) {
  sql.push(
    // Image rows are never garbage-collected, so a re-import finds them again.
    `INSERT OR IGNORE INTO images (id, owner, r2_key, bytes, width, height, source_url, created_at) VALUES ` +
      `(${q(image.id)}, ${q(OWNER)}, ${q(`img/${image.id}.webp`)}, ${image.bytes}, ${image.width}, ${image.height}, NULL, ${IMPORT_NOW});`,
  )
  counts.images++
}

writeFileSync(join(OUT, 'import.sql'), sql.join('\n') + '\n')

const puts = [...images.values()].map(
  (image) => `npx wrangler r2 object put "kept-images/img/${image.id}.webp" --file "${image.file}" --content-type image/webp "$1"`,
)
writeFileSync(
  join(OUT, 'apply.sh'),
  [
    '#!/bin/sh',
    '# usage: sh apply.sh --local | --remote   (run from the repository root)',
    'set -eu',
    'case "${1:-}" in --local|--remote) ;; *) echo "usage: $0 --local|--remote" >&2; exit 1 ;; esac',
    ...puts,
    `npx wrangler d1 execute kept-db "$1" --file "${join(OUT, 'import.sql')}"`,
    '',
  ].join('\n'),
)

console.log(JSON.stringify(counts))
