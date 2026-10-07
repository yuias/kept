import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosave } from './autosave'

describe('createAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('merges patches queued before the debounce fires into a single save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const statuses: string[] = []
    const autosave = createAutosave<{ title?: string; body?: string }>(save, 800, (s) => statuses.push(s))

    autosave.update({ title: 'a' })
    autosave.update({ body: 'b' })

    await vi.advanceTimersByTimeAsync(800)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ title: 'a', body: 'b' })
    expect(statuses).toEqual(['saving', 'saved'])
  })

  it('flush saves immediately without waiting for the debounce, and resolves true', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const autosave = createAutosave<{ title?: string }>(save, 800, () => {})

    autosave.update({ title: 'a' })
    await expect(autosave.flush()).resolves.toBe(true)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ title: 'a' })
  })

  it('flush resolves true and does nothing when there is no pending patch', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const autosave = createAutosave<{ title?: string }>(save, 800, () => {})

    await expect(autosave.flush()).resolves.toBe(true)

    expect(save).not.toHaveBeenCalled()
  })

  it('keeps a failed patch pending and reports an error status, retrying on the next flush', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    const statuses: string[] = []
    const autosave = createAutosave<{ title?: string }>(save, 800, (s) => statuses.push(s))

    autosave.update({ title: 'a' })
    await expect(autosave.flush()).resolves.toBe(false)

    expect(statuses).toEqual(['saving', 'error'])

    await expect(autosave.flush()).resolves.toBe(true)

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ title: 'a' })
    expect(statuses).toEqual(['saving', 'error', 'saving', 'saved'])
  })

  it('merges a newer patch ahead of a retained failed one', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    const autosave = createAutosave<{ title?: string; body?: string }>(save, 800, () => {})

    autosave.update({ title: 'a' })
    await autosave.flush()

    autosave.update({ body: 'b' })
    await autosave.flush()

    expect(save).toHaveBeenLastCalledWith({ title: 'a', body: 'b' })
  })

  it('serializes saves: an update during a slow save waits, then sends once with the merged patch', async () => {
    let resolveFirst: (() => void) | undefined
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(undefined)
    const statuses: string[] = []
    const autosave = createAutosave<{ title?: string; body?: string }>(save, 800, (s) => statuses.push(s))

    autosave.update({ title: 'a' })
    await vi.advanceTimersByTimeAsync(800)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ title: 'a' })

    // Queued while the first save is still in flight.
    autosave.update({ body: 'b' })
    await vi.advanceTimersByTimeAsync(800)

    // The debounce for the second update fired, but it must wait behind the
    // first save rather than running alongside it.
    expect(save).toHaveBeenCalledTimes(1)

    resolveFirst?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ body: 'b' })
    expect(statuses).toEqual(['saving', 'saved', 'saving', 'saved'])
  })

  it('flush waits through a save chained by an update during a slow save', async () => {
    let resolveFirst: (() => void) | undefined
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(undefined)
    const autosave = createAutosave<{ title?: string; body?: string }>(save, 800, () => {})

    autosave.update({ title: 'a' })
    await vi.advanceTimersByTimeAsync(800)
    autosave.update({ body: 'b' })

    let settled = false
    const flushed = autosave.flush().then((result) => {
      settled = true
      return result
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false) // still waiting on the first, slow save

    resolveFirst?.()
    await expect(flushed).resolves.toBe(true)

    expect(settled).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ body: 'b' })
  })
})

describe('hasPending', () => {
  it('is false at the "saved" status only when nothing queued during the save', async () => {
    let release: () => void = () => {}
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const pendingAtSaved: boolean[] = []
    const autosave = createAutosave<{ body?: string }>(save, 800, (status) => {
      if (status === 'saved') pendingAtSaved.push(autosave.hasPending())
    })

    expect(autosave.hasPending()).toBe(false)
    autosave.update({ body: 'a' })
    expect(autosave.hasPending()).toBe(true)

    const first = autosave.flush()
    expect(autosave.hasPending()).toBe(false)
    autosave.update({ body: 'ab' })
    release()
    await first

    const second = autosave.flush()
    release()
    await second

    expect(pendingAtSaved).toEqual([true, false])
  })
})
