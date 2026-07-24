import { useEffect, useRef, useState } from 'react'

import {
  createAxialViewportRuntime,
  initializeCornerstone,
  toSafeViewerError,
  type AxialViewportRuntime,
} from '../core/cornerstone'
import { ViewerToolbar } from './ViewerToolbar'
import type { AxialTool } from '../model/axialViewer'
import { AnnotationTextDialog } from '../../viewer-annotations/components/AnnotationTextDialog'
import { ClearAnnotationsDialog } from '../../viewer-annotations/components/ClearAnnotationsDialog'
import { MeasurementToolbar } from '../../viewer-annotations/components/MeasurementToolbar'
import {
  CALIBRATION_UNAVAILABLE_MESSAGE,
  type AnnotationTextRequest,
  type MeasurementCalibration,
} from '../../viewer-annotations/model/viewerAnnotation'
import { getViewerState } from '../../viewer-state/api/viewerStateApi'
import {
  createViewerStateWriter,
  type ViewerStateWriter,
} from '../../viewer-state/core/viewerStateWriter'
import type { ViewerStatePayload } from '../../viewer-state/model/viewerState'
import {
  ViewerStateStatus,
  type ViewerStateStatusValue,
} from '../../viewer-state/components/ViewerStateStatus'


interface AxialViewportProps {
  imageIds: readonly string[]
  seriesId: string
}

export function AxialViewport({ imageIds, seriesId }: AxialViewportProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const clearButtonRef = useRef<HTMLButtonElement>(null)
  const runtimeRef = useRef<AxialViewportRuntime | null>(null)
  const writerRef = useRef<ViewerStateWriter | null>(null)
  const persistencePausedRef = useRef(false)
  const initialIndex = Math.floor(imageIds.length / 2)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [activeTool, setActiveTool] = useState<AxialTool>('windowLevel')
  const [annotationCount, setAnnotationCount] = useState(0)
  const [calibration, setCalibration] = useState<MeasurementCalibration>({
    available: false,
    reason: CALIBRATION_UNAVAILABLE_MESSAGE,
  })
  const [textRequest, setTextRequest] = useState<AnnotationTextRequest | null>(
    null,
  )
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [runtimeReady, setRuntimeReady] = useState(false)
  const [persistenceStatus, setPersistenceStatus] =
    useState<ViewerStateStatusValue | null>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const element = elementRef.current
    if (element === null) {
      return
    }
    let cancelled = false
    let runtimeErrorReported = false
    persistencePausedRef.current = false
    const controller = new AbortController()
    const writer = createViewerStateWriter({
      seriesId,
      onStatus: (status) => {
        if (cancelled || status === 'idle') {
          return
        }
        setPersistenceStatus(
          status === 'error' ? { kind: 'error', operation: 'save' } : { kind: status },
        )
      },
    })
    writerRef.current = writer
    let currentPayload: ViewerStatePayload = {
      axial: null,
      mpr: null,
      annotations: [],
    }
    setCurrentIndex(initialIndex)
    setActiveTool('windowLevel')
    setAnnotationCount(0)
    setCalibration({
      available: false,
      reason: CALIBRATION_UNAVAILABLE_MESSAGE,
    })
    setTextRequest(null)
    setClearDialogOpen(false)
    setRuntimeError(null)
    setRuntimeReady(false)
    setPersistenceStatus({ kind: 'loading' })

    const savedState = getViewerState(seriesId, controller.signal)
      .then((value) => ({ failed: false as const, value }))
      .catch(() => ({ failed: true as const, value: null }))

    void Promise.all([initializeCornerstone(), savedState])
      .then(([, saved]) => {
        if (cancelled) {
          return null
        }
        if (!saved.failed && saved.value !== null) {
          currentPayload = saved.value.state
        }
        return createAxialViewportRuntime(
          element,
          imageIds,
          initialIndex,
          (index) => {
            if (!cancelled) {
              setCurrentIndex(index)
            }
          },
          (message) => {
            if (!cancelled) {
              runtimeErrorReported = true
              setRuntimeError(toSafeViewerError(message))
            }
          },
          controller.signal,
          {
            onAnnotationCountChange: (count) => {
              if (!cancelled) {
                setAnnotationCount(count)
              }
            },
            onCalibrationChange: (value) => {
              if (!cancelled) {
                setCalibration(value)
              }
            },
            onTextRequest: (request) => {
              if (!cancelled) {
                setTextRequest(request)
              }
            },
          },
          () => {
            const runtime = runtimeRef.current
            if (
              cancelled ||
              persistencePausedRef.current ||
              runtime === null
            ) {
              return
            }
            const snapshot = runtime.captureState()
            currentPayload = {
              axial: snapshot.state,
              mpr: currentPayload.mpr,
              annotations: [
                ...snapshot.annotations,
                ...currentPayload.annotations.filter(
                  (annotation) => annotation.viewport !== 'axial',
                ),
              ],
            }
            writer.schedule(currentPayload)
          },
        )
          .then(async (runtime) => {
            if (saved.failed) {
              if (!cancelled) {
                setPersistenceStatus({ kind: 'error', operation: 'load' })
              }
              return runtime
            }
            const axialAnnotations = currentPayload.annotations.filter(
              (annotation) => annotation.viewport === 'axial',
            )
            if (
              currentPayload.axial === null &&
              axialAnnotations.length === 0
            ) {
              if (!cancelled) {
                setPersistenceStatus(null)
              }
              return runtime
            }
            try {
              const stateToRestore = currentPayload.axial ?? runtime.captureState().state
              const result = await runtime.applyState(
                stateToRestore,
                axialAnnotations,
              )
              if (!cancelled) {
                setActiveTool(runtime.captureState().state.active_tool)
                setPersistenceStatus(
                  result.skipped > 0
                    ? { kind: 'partial', skipped: result.skipped }
                    : { kind: 'restored' },
                )
              }
            } catch {
              if (!cancelled) {
                setPersistenceStatus({ kind: 'error', operation: 'load' })
              }
            }
            return runtime
          })
      })
      .then((runtime) => {
        if (runtime === null) {
          return
        }
        if (cancelled) {
          runtime.destroy()
          return
        }
        runtimeRef.current = runtime
        setRuntimeReady(true)
      })
      .catch(() => {
        if (!cancelled && !runtimeErrorReported) {
          setRuntimeError('无法加载该影像，请重试或返回病人管理')
        }
      })

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => runtimeRef.current?.resize())
    resizeObserver?.observe(element)
    const resumePersistence = () => {
      persistencePausedRef.current = false
    }
    for (const eventName of ['focusin', 'pointerdown']) {
      element.addEventListener(eventName, resumePersistence)
    }
    element.addEventListener('wheel', resumePersistence, { passive: true })
    const flushOnPageHide = () => {
      void writer.flush({ keepalive: true }).catch(() => undefined)
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        void writer.flush().catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flushOnPageHide)

    return () => {
      cancelled = true
      controller.abort()
      resizeObserver?.disconnect()
      for (const eventName of ['focusin', 'pointerdown']) {
        element.removeEventListener(eventName, resumePersistence)
      }
      element.removeEventListener('wheel', resumePersistence)
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flushOnPageHide)
      void writer.destroy().catch(() => undefined)
      runtimeRef.current?.destroy()
      runtimeRef.current = null
      if (writerRef.current === writer) {
        writerRef.current = null
      }
    }
  }, [attempt, imageIds, initialIndex, seriesId])

  function clearSavedState(): void {
    persistencePausedRef.current = true
    const writer = writerRef.current
    if (writer === null) {
      return
    }
    void writer.clear()
      .then(() => setPersistenceStatus({ kind: 'cleared' }))
      .catch(() => setPersistenceStatus({ kind: 'error', operation: 'clear' }))
  }

  function retryPersistence(): void {
    if (persistenceStatus?.kind !== 'error') {
      return
    }
    if (persistenceStatus.operation === 'load') {
      setAttempt((value) => value + 1)
      return
    }
    if (persistenceStatus.operation === 'clear') {
      clearSavedState()
      return
    }
    void writerRef.current?.flush().catch(() => undefined)
  }

  return (
    <section aria-label="轴位影像" className="axial-viewport-shell">
      <ViewerToolbar
        activeTool={activeTool}
        currentIndex={currentIndex}
        disabled={!runtimeReady}
        onNext={() => {
          persistencePausedRef.current = false
          void runtimeRef.current?.next()
        }}
        onPrevious={() => {
          persistencePausedRef.current = false
          void runtimeRef.current?.previous()
        }}
        onReset={() => {
          persistencePausedRef.current = true
          setActiveTool('windowLevel')
          setAnnotationCount(0)
          runtimeRef.current?.clearAnnotations()
          void runtimeRef.current?.reset()
          clearSavedState()
        }}
        onToolChange={(tool) => {
          persistencePausedRef.current = false
          setActiveTool(tool)
          runtimeRef.current?.activateTool(tool)
        }}
        total={imageIds.length}
      />
      <MeasurementToolbar
        activeTool={activeTool}
        annotationCount={annotationCount}
        calibration={calibration}
        clearButtonRef={clearButtonRef}
        disabled={!runtimeReady}
        onActivateTool={(tool) => {
          persistencePausedRef.current = false
          setActiveTool(tool)
          runtimeRef.current?.activateTool(tool)
        }}
        onRequestClear={() => setClearDialogOpen(true)}
      />
      <ViewerStateStatus
        onClear={clearSavedState}
        onRetry={retryPersistence}
        status={persistenceStatus}
      />
      {!runtimeReady && runtimeError === null ? (
        <div className="viewer-message" role="status">
          正在加载影像…
        </div>
      ) : null}
      {runtimeError === null ? null : (
        <div className="viewer-message viewer-message--error" role="alert">
          <p>{runtimeError}</p>
          <button
            className="button button--secondary"
            onClick={() => {
              setRuntimeError(null)
              if (runtimeRef.current === null) {
                setAttempt((value) => value + 1)
              } else {
                void runtimeRef.current.retry()
              }
            }}
            type="button"
          >
            重试当前影像
          </button>
        </div>
      )}
      <div
        aria-label="CT 轴位图像画布"
        className="axial-viewport"
        ref={elementRef}
        tabIndex={0}
      />
      <AnnotationTextDialog
        request={textRequest}
        returnFocusRef={elementRef}
      />
      <ClearAnnotationsDialog
        annotationCount={annotationCount}
        onCancel={() => setClearDialogOpen(false)}
        onConfirm={() => {
          runtimeRef.current?.clearAnnotations()
          setClearDialogOpen(false)
        }}
        open={clearDialogOpen}
        returnFocusRef={clearButtonRef}
      />
    </section>
  )
}
