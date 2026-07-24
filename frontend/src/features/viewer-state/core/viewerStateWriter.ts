import {
  deleteViewerState,
  putViewerState,
} from '../api/viewerStateApi'
import { parseViewerStatePayload } from '../model/viewerState'
import type { ViewerStatePayload } from '../model/viewerState'


export type ViewerStateWriterStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface ViewerStateWriter {
  schedule(state: ViewerStatePayload): void
  flush(options?: { keepalive?: boolean }): Promise<void>
  clear(): Promise<void>
  destroy(): Promise<void>
}

interface WriterOptions {
  seriesId: string
  debounceMs?: number
  onStatus?(status: ViewerStateWriterStatus): void
  put?(
    seriesId: string,
    state: ViewerStatePayload,
    options?: { keepalive?: boolean },
  ): Promise<unknown>
  remove?(
    seriesId: string,
    options?: { keepalive?: boolean },
  ): Promise<void>
}

export function createViewerStateWriter({
  seriesId,
  debounceMs = 500,
  onStatus = () => undefined,
  put = putViewerState,
  remove = deleteViewerState,
}: WriterOptions): ViewerStateWriter {
  let latest: ViewerStatePayload | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<unknown> | null = null
  let accepting = true
  let clearing = false
  let clearPromise: Promise<void> | null = null
  let destroyPromise: Promise<void> | null = null

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function drain(options?: { keepalive?: boolean }): Promise<void> {
    cancelTimer()
    if (inFlight !== null) {
      try {
        await inFlight
      } catch (error) {
        if (latest === null) {
          throw error
        }
      }
      if (latest !== null) {
        await drain(options)
      }
      return
    }
    if (latest === null) {
      return
    }

    const snapshot = latest
    latest = null
    onStatus('saving')
    const request = put(seriesId, snapshot, options)
    inFlight = request
    try {
      await request
      onStatus('saved')
    } catch (error) {
      if (!clearing && latest === null) {
        latest = snapshot
      }
      onStatus('error')
      throw error
    } finally {
      if (inFlight === request) {
        inFlight = null
      }
    }

    if (latest !== null) {
      await drain(options)
    }
  }

  function schedule(state: ViewerStatePayload): void {
    if (!accepting || clearing) {
      return
    }
    try {
      latest = parseViewerStatePayload(state)
    } catch {
      latest = null
      cancelTimer()
      onStatus('error')
      return
    }
    cancelTimer()
    timer = setTimeout(() => {
      timer = null
      void drain().catch(() => undefined)
    }, debounceMs)
  }

  async function performClear(): Promise<void> {
    clearing = true
    cancelTimer()
    latest = null
    if (inFlight !== null) {
      try {
        await inFlight
      } catch {
        // DELETE still establishes the requested canonical empty state.
      }
    }
    latest = null
    try {
      await remove(seriesId, { keepalive: true })
      onStatus('idle')
    } catch (error) {
      onStatus('error')
      throw error
    } finally {
      clearing = false
    }
  }

  function clear(): Promise<void> {
    if (clearPromise !== null) {
      return clearPromise
    }
    const operation = performClear()
    clearPromise = operation
    void operation.then(
      () => {
        if (clearPromise === operation) {
          clearPromise = null
        }
      },
      () => {
        if (clearPromise === operation) {
          clearPromise = null
        }
      },
    )
    return operation
  }

  async function flush(options?: { keepalive?: boolean }): Promise<void> {
    if (clearPromise !== null) {
      await clearPromise
      return
    }
    await drain(options)
  }

  async function destroy(): Promise<void> {
    if (destroyPromise !== null) {
      return destroyPromise
    }
    accepting = false
    destroyPromise = flush()
    return destroyPromise
  }

  return {
    schedule,
    flush,
    clear,
    destroy,
  }
}
