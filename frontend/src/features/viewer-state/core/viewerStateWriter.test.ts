import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ViewerStatePayload } from '../model/viewerState'
import { createViewerStateWriter } from './viewerStateWriter'


function state(index: number): ViewerStatePayload {
  return {
    axial: {
      image_index: index,
      active_tool: 'windowLevel',
      presentation: null,
      voi: null,
    },
    mpr: null,
    annotations: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, reject, resolve }
}

describe('viewer state writer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('coalesces 20 changes into one trailing PUT after 500 ms', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const writer = createViewerStateWriter({ seriesId: 'series', put })

    for (let index = 0; index < 20; index += 1) {
      writer.schedule(state(index))
    }
    await vi.advanceTimersByTimeAsync(499)
    expect(put).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(put).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledWith('series', state(19), undefined)
  })

  it('sends only the newest snapshot queued during an in-flight PUT', async () => {
    const first = deferred<void>()
    const put = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined)
    const writer = createViewerStateWriter({ seriesId: 'series', put })

    writer.schedule(state(1))
    await vi.advanceTimersByTimeAsync(500)
    writer.schedule(state(2))
    writer.schedule(state(3))
    first.resolve()
    await first.promise
    await vi.runAllTimersAsync()

    expect(put.mock.calls.map(([, payload]) => payload)).toEqual([
      state(1),
      state(3),
    ])
  })

  it('flushes the latest snapshot, waits for it, and forwards keepalive', async () => {
    const pending = deferred<void>()
    const put = vi.fn().mockReturnValue(pending.promise)
    const writer = createViewerStateWriter({ seriesId: 'series', put })
    writer.schedule(state(4))

    const flushed = writer.flush({ keepalive: true })
    expect(put).toHaveBeenCalledWith('series', state(4), { keepalive: true })
    let settled = false
    void flushed.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    pending.resolve()
    await expect(flushed).resolves.toBeUndefined()
  })

  it('retains a failed snapshot for explicit retry and reports status', async () => {
    const failure = new Error('offline')
    const put = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const onStatus = vi.fn()
    const writer = createViewerStateWriter({ seriesId: 'series', put, onStatus })
    writer.schedule(state(5))

    await expect(writer.flush()).rejects.toBe(failure)
    expect(onStatus).toHaveBeenLastCalledWith('error')
    await expect(writer.flush()).resolves.toBeUndefined()
    expect(put).toHaveBeenCalledTimes(2)
    expect(onStatus).toHaveBeenLastCalledWith('saved')
  })

  it('retries a failed normal in-flight flush with pagehide keepalive options', async () => {
    const failure = new Error('unloaded')
    const first = deferred<void>()
    const put = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(undefined)
    const writer = createViewerStateWriter({ seriesId: 'series', put })
    writer.schedule(state(5))

    const normalFlush = writer.flush()
    const keepaliveFallback = writer.flush({ keepalive: true })
    const normalResult = expect(normalFlush).rejects.toBe(failure)
    const fallbackResult = expect(keepaliveFallback).resolves.toBeUndefined()
    first.reject(failure)

    await normalResult
    await fallbackResult
    expect(put).toHaveBeenNthCalledWith(1, 'series', state(5), undefined)
    expect(put).toHaveBeenNthCalledWith(
      2,
      'series',
      state(5),
      { keepalive: true },
    )
  })

  it('rejects an invalid local snapshot without throwing or sending a truncated PUT', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const onStatus = vi.fn()
    const writer = createViewerStateWriter({ seriesId: 'series', put, onStatus })
    const oversized = {
      ...state(5),
      annotations: Array.from({ length: 501 }, () => ({
        viewport: 'axial' as const,
        tool_name: 'Length' as const,
        referenced_image_id: 'image-axial',
        points: [[0, 0, 0], [1, 1, 0]] as [number, number, number][],
        label: null,
        text_box: null,
      })),
    }

    expect(() => writer.schedule(oversized)).not.toThrow()
    await vi.runAllTimersAsync()

    expect(put).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenLastCalledWith('error')
  })

  it('clear cancels queued PUTs, waits in-flight work, then DELETEs', async () => {
    const pending = deferred<void>()
    const put = vi.fn().mockReturnValue(pending.promise)
    const remove = vi.fn().mockResolvedValue(undefined)
    const writer = createViewerStateWriter({ seriesId: 'series', put, remove })
    writer.schedule(state(6))
    await vi.advanceTimersByTimeAsync(500)
    writer.schedule(state(7))

    const clearing = writer.clear()
    expect(remove).not.toHaveBeenCalled()
    pending.resolve()
    await clearing

    expect(put).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('series', { keepalive: true })
  })

  it('destroy waits for an in-flight clear DELETE', async () => {
    const pending = deferred<void>()
    const remove = vi.fn().mockReturnValue(pending.promise)
    const writer = createViewerStateWriter({ seriesId: 'series', remove })

    const clearing = writer.clear()
    const destroying = writer.destroy()
    let destroyed = false
    void destroying.then(() => { destroyed = true })
    await Promise.resolve()
    expect(destroyed).toBe(false)

    pending.resolve()
    await expect(clearing).resolves.toBeUndefined()
    await expect(destroying).resolves.toBeUndefined()
  })

  it('destroy flushes once, is idempotent, and ignores future schedules', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const writer = createViewerStateWriter({ seriesId: 'series', put })
    writer.schedule(state(8))

    await writer.destroy()
    await writer.destroy()
    writer.schedule(state(9))
    await vi.runAllTimersAsync()

    expect(put).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledWith('series', state(8), undefined)
  })
})
