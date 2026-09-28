import { describe, expect, it } from 'vitest'
import { createD1 } from './d1'

describe('createD1', () => {
  it('creates a table, inserts via bind/run, and reads it back with first/all', async () => {
    const db = createD1()
    await db.exec('CREATE TABLE widgets (id TEXT PRIMARY KEY, name TEXT NOT NULL)')

    const insert = await db.prepare('INSERT INTO widgets (id, name) VALUES (?, ?)').bind('w1', 'Widget').run()
    expect(insert.success).toBe(true)
    expect(insert.meta.changes).toBe(1)

    const one = await db
      .prepare('SELECT * FROM widgets WHERE id = ?')
      .bind('w1')
      .first<{ id: string; name: string }>()
    expect(one).toEqual({ id: 'w1', name: 'Widget' })

    const all = await db.prepare('SELECT * FROM widgets').all<{ id: string; name: string }>()
    expect(all.success).toBe(true)
    expect(all.results).toEqual([{ id: 'w1', name: 'Widget' }])
  })

  it('returns null from first() when there is no matching row', async () => {
    const db = createD1()
    await db.exec('CREATE TABLE widgets (id TEXT PRIMARY KEY, name TEXT NOT NULL)')

    const none = await db.prepare('SELECT * FROM widgets WHERE id = ?').bind('missing').first()
    expect(none).toBeNull()
  })

  it('binds one prepared statement to different params for each row of a batch', async () => {
    const db = createD1()
    await db.exec('CREATE TABLE widgets (id TEXT PRIMARY KEY, name TEXT NOT NULL)')

    const insert = db.prepare('INSERT INTO widgets (id, name) VALUES (?, ?)')
    await db.batch([insert.bind('w1', 'Widget'), insert.bind('w2', 'Another')])

    const all = await db.prepare('SELECT id, name FROM widgets ORDER BY id').all<{ id: string; name: string }>()
    expect(all.results).toEqual([
      { id: 'w1', name: 'Widget' },
      { id: 'w2', name: 'Another' },
    ])
  })

  it('rolls back the whole batch when one statement fails', async () => {
    const db = createD1()
    await db.exec('CREATE TABLE widgets (id TEXT PRIMARY KEY, name TEXT NOT NULL)')
    await db.prepare('INSERT INTO widgets (id, name) VALUES (?, ?)').bind('w1', 'Widget').run()

    await expect(
      db.batch([
        db.prepare('INSERT INTO widgets (id, name) VALUES (?, ?)').bind('w2', 'Another'),
        db.prepare('INSERT INTO widgets (id, name) VALUES (?, ?)').bind('w1', 'Duplicate'), // primary key collision
      ]),
    ).rejects.toThrow()

    // The pre-existing row survives, but the first statement of the failed batch does not.
    const all = await db.prepare('SELECT id FROM widgets').all<{ id: string }>()
    expect(all.results.map((row) => row.id)).toEqual(['w1'])
  })

  it('throws on a foreign key violation', async () => {
    const db = createD1()
    await db.exec('CREATE TABLE parents (id TEXT PRIMARY KEY)')
    await db.exec('CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id))')

    await expect(
      db.prepare('INSERT INTO children (id, parent_id) VALUES (?, ?)').bind('c1', 'missing-parent').run(),
    ).rejects.toThrow()
  })
})
