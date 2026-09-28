import { describe, expect, it } from 'vitest'
import { listQueryFor, noteParam, parseRoute } from './routes'

describe('parseRoute', () => {
  it('parses the notes list at root', () => {
    expect(parseRoute('/', '')).toEqual({ name: 'notes' })
  })

  it('parses archive', () => {
    expect(parseRoute('/archive', '')).toEqual({ name: 'archive' })
  })

  it('parses trash', () => {
    expect(parseRoute('/trash', '')).toEqual({ name: 'trash' })
  })

  it('parses settings', () => {
    expect(parseRoute('/settings', '')).toEqual({ name: 'settings' })
  })

  it('parses a folder id', () => {
    expect(parseRoute('/folder/abc123', '')).toEqual({ name: 'folder', id: 'abc123' })
  })

  it('parses a label, decoding percent-encoding', () => {
    expect(parseRoute('/label/a%20b', '')).toEqual({ name: 'label', label: 'a b' })
  })

  it('parses search with a query string', () => {
    expect(parseRoute('/search', '?q=hello')).toEqual({ name: 'search', q: 'hello' })
  })

  it('parses search with no query param as an empty query', () => {
    expect(parseRoute('/search', '')).toEqual({ name: 'search', q: '' })
  })

  it('falls back to notfound for unknown paths', () => {
    expect(parseRoute('/nope', '')).toEqual({ name: 'notfound' })
  })

  it('falls back to notfound for a folder path with no id', () => {
    expect(parseRoute('/folder', '')).toEqual({ name: 'notfound' })
  })

  it('falls back to notfound for a label path with no name', () => {
    expect(parseRoute('/label', '')).toEqual({ name: 'notfound' })
  })

  it('falls back to notfound for deeper unknown segments', () => {
    expect(parseRoute('/folder/abc/extra', '')).toEqual({ name: 'notfound' })
  })

  it('falls back to notfound for a malformed percent-escape', () => {
    expect(parseRoute('/label/%', '')).toEqual({ name: 'notfound' })
  })
})

describe('listQueryFor', () => {
  it('maps notes to view notes', () => {
    expect(listQueryFor({ name: 'notes' })).toEqual({ view: 'notes' })
  })

  it('maps archive to view archive', () => {
    expect(listQueryFor({ name: 'archive' })).toEqual({ view: 'archive' })
  })

  it('maps trash to view trash', () => {
    expect(listQueryFor({ name: 'trash' })).toEqual({ view: 'trash' })
  })

  it('maps folder to view notes scoped to the folder', () => {
    expect(listQueryFor({ name: 'folder', id: 'f1' })).toEqual({ view: 'notes', folder: 'f1' })
  })

  it('maps label to view notes scoped to the label', () => {
    expect(listQueryFor({ name: 'label', label: 'work' })).toEqual({ view: 'notes', label: 'work' })
  })

  it('maps search to view all with the query', () => {
    expect(listQueryFor({ name: 'search', q: 'hello' })).toEqual({ view: 'all', q: 'hello' })
  })

  it('returns null for settings', () => {
    expect(listQueryFor({ name: 'settings' })).toBeNull()
  })

  it('returns null for notfound', () => {
    expect(listQueryFor({ name: 'notfound' })).toBeNull()
  })
})

describe('noteParam', () => {
  it('reads the note query param', () => {
    expect(noteParam('?note=abc123')).toBe('abc123')
  })

  it('reads note=new', () => {
    expect(noteParam('?note=new')).toBe('new')
  })

  it('returns null when absent', () => {
    expect(noteParam('')).toBeNull()
  })

  it('returns null among other params', () => {
    expect(noteParam('?q=hello')).toBeNull()
  })
})
