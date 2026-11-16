// Reports how the Lexical markdown conversion treats the notes in a local D1
// database. Prints counts and note ids only, never note text.
//
//   node scripts/roundtrip-d1.ts [--db <path>] [--diff <dir>]
//
// Without --db it picks the .sqlite file under .wrangler/state/v3/d1/ that has
// the most rows in `notes`. --diff writes <id>.a.md (stored) and <id>.b.md
// (exported) for every non-identical note, for local inspection; point it at a
// directory outside the repository, since the files hold note text.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import { runnerImport } from 'vite'

const { values: args } = parseArgs({
  options: {
    db: { type: 'string' },
    diff: { type: 'string' },
  },
})

const ROOT = resolve(import.meta.dirname, '..')
const D1_DIR = join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')

const noteCount = (path: string): number | null => {
  try {
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      return (db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n
    } finally {
      db.close()
    }
  } catch {
    // Missing file or no notes table: not a usable database.
    return null
  }
}

const findDatabase = (): string | null => {
  if (args.db) return noteCount(resolve(args.db)) === null ? null : resolve(args.db)
  let files: string[]
  try {
    files = readdirSync(D1_DIR).filter((name) => name.endsWith('.sqlite'))
  } catch {
    return null
  }
  let best: { path: string; count: number } | null = null
  for (const name of files) {
    const path = join(D1_DIR, name)
    const count = noteCount(path)
    if (count !== null && (!best || count > best.count)) best = { path, count }
  }
  return best?.path ?? null
}

const dbPath = findDatabase()
if (!dbPath) {
  console.error('no local D1 database with a notes table found (use --db <path>)')
  process.exit(1)
}

// Loaded through Vite so the extensionless imports inside src/ resolve.
const load = async <T>(file: string): Promise<T> =>
  (await runnerImport<T>(resolve(ROOT, file), { configFile: false, logLevel: 'silent' })).module
const { roundTrip } = await load<typeof import('../src/client/lib/lexical/markdown.ts')>(
  'src/client/lib/lexical/markdown.ts',
)
const { classifyRoundTrip } = await load<typeof import('../src/client/lib/lexical/fidelity.ts')>(
  'src/client/lib/lexical/fidelity.ts',
)

const db = new DatabaseSync(dbPath, { readOnly: true })
const notes = db.prepare('SELECT id, body FROM notes ORDER BY id').all() as { id: string; body: string }[]
db.close()

const diffDir = args.diff ? resolve(args.diff) : null
if (diffDir) mkdirSync(diffDir, { recursive: true })

const counts = { identical: 0, 'render-equal': 0, 'render-different': 0 }
const different: string[] = []
const failed: string[] = []
for (const { id, body } of notes) {
  let exported: string
  try {
    exported = roundTrip(body)
  } catch {
    failed.push(id)
    continue
  }
  const kind = classifyRoundTrip(body, exported)
  counts[kind]++
  if (kind === 'render-different') different.push(id)
  if (diffDir && kind !== 'identical') {
    writeFileSync(join(diffDir, `${id}.a.md`), body)
    writeFileSync(join(diffDir, `${id}.b.md`), exported)
  }
}

console.log(`notes ${notes.length}`)
console.log(`identical ${counts.identical}`)
console.log(`render-equal ${counts['render-equal']}`)
console.log(`render-different ${counts['render-different']}`)
console.log(`render-different ids: ${different.join(' ')}`.trimEnd())
console.log(`errors ${failed.length}`)
if (failed.length > 0) console.log(`error ids: ${failed.join(' ')}`)
