import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

// Resolved from this file's location, not `process.cwd()`, so it works no
// matter where vitest is invoked from.
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

function applyMigrations(db: DatabaseSync): void {
  if (!existsSync(MIGRATIONS_DIR)) return // the schema migration may not exist yet

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  for (const file of files) db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
}

/** node:sqlite rejects booleans outright, same as D1; both fold to 0/1 here. */
function toSqliteParams(values: unknown[]): unknown[] {
  return values.map((value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value))
}

function emptyMeta(): D1Meta & Record<string, unknown> {
  return { duration: 0, size_after: 0, rows_read: 0, rows_written: 0, last_row_id: 0, changed_db: false, changes: 0 }
}

class Statement {
  #statement: StatementSync
  #params: unknown[]

  constructor(statement: StatementSync, params: unknown[] = []) {
    this.#statement = statement
    this.#params = params
  }

  // D1's bind() returns a new prepared statement rather than mutating this one,
  // which callers rely on to bind the same SQL to different params in a batch
  // (e.g. one INSERT statement bound once per row).
  bind(...values: unknown[]): Statement {
    return new Statement(this.#statement, toSqliteParams(values))
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const row = this.#statement.get(...this.#params) as Record<string, unknown> | undefined
    if (row === undefined) return null
    return (columnName === undefined ? row : row[columnName] ?? null) as T
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.#statement.all(...this.#params) as T[]
    return { results, success: true, meta: emptyMeta() }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = this.#statement.run(...this.#params)
    return {
      results: [],
      success: true,
      meta: {
        ...emptyMeta(),
        changes: result.changes as number,
        last_row_id: Number(result.lastInsertRowid),
        changed_db: (result.changes as number) > 0,
      },
    }
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const rows = this.#statement.all(...this.#params) as Record<string, unknown>[]
    const values = rows.map((row) => Object.values(row)) as T[]
    if (!options?.columnNames) return values

    const names = this.#statement.columns().map((column) => String(column.name))
    return [names, ...values]
  }
}

export function createD1(): D1Database {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db)

  const shim = {
    prepare(sql: string): Statement {
      return new Statement(db.prepare(sql))
    },
    async batch<T = unknown>(statements: unknown[]): Promise<D1Result<T>[]> {
      const impls = statements as Statement[]
      db.exec('BEGIN')
      try {
        const results: D1Result<T>[] = []
        for (const statement of impls) results.push(await statement.run<T>())
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    async exec(sql: string): Promise<D1ExecResult> {
      db.exec(sql)
      return { count: sql.split(';').filter((statement) => statement.trim().length > 0).length, duration: 0 }
    },
  }

  return shim as unknown as D1Database
}
