import { describe, expect, it } from 'vitest'
import { clearDraft, type Draft, readDraft, writeDraft } from './drafts'

class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length(): number {
    return this.items.size
  }
  clear(): void {
    this.items.clear()
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
}

const draft: Draft = { title: 't', body: 'b', labelsText: 'a, b', baseUpdatedAt: 42 }

describe('drafts', () => {
  it('round-trips a draft and clears it', () => {
    const storage = new MemoryStorage()

    writeDraft('n1', draft, storage)
    expect(readDraft('n1', storage)).toEqual(draft)
    expect(readDraft('n2', storage)).toBeNull()

    clearDraft('n1', storage)
    expect(readDraft('n1', storage)).toBeNull()
  })

  it('keeps a null base for a note that was never created', () => {
    const storage = new MemoryStorage()

    writeDraft('new', { ...draft, baseUpdatedAt: null }, storage)

    expect(readDraft('new', storage)?.baseUpdatedAt).toBeNull()
  })

  it('treats corrupt or foreign values as no draft', () => {
    const storage = new MemoryStorage()

    storage.setItem('kept.draft.bad-json', '{')
    storage.setItem('kept.draft.wrong-shape', JSON.stringify({ title: 1 }))

    expect(readDraft('bad-json', storage)).toBeNull()
    expect(readDraft('wrong-shape', storage)).toBeNull()
  })

  it('swallows storage that throws', () => {
    const storage = new MemoryStorage()
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    storage.getItem = () => {
      throw new DOMException('blocked', 'SecurityError')
    }

    expect(() => writeDraft('n1', draft, storage)).not.toThrow()
    expect(readDraft('n1', storage)).toBeNull()
    expect(() => clearDraft('n1', null)).not.toThrow()
  })
})
