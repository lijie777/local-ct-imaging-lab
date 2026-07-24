import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  createMprRuntime,
  type MprRuntime,
  type MprRuntimeProgress,
} from '../core/mprCornerstone'
import type {
  MprTool,
  MprViewportId,
  MprViewportOrientation,
  Point3,
} from '../model/mprViewer'
import { MprToolbar } from './MprToolbar'
import { ViewportOverlay } from './ViewportOverlay'
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


interface MprViewportGridProps {
  imageIds: readonly string[]
  metadata?: ReactNode
  seriesId: string
}

const VIEWPORTS = [
  { id: 'axial', label: '轴位' },
  { id: 'coronal', label: '冠状位' },
  { id: 'sagittal', label: '矢状位' },
] as const

const INITIAL_POSITIONS: Record<MprViewportId, Point3> = {
  axial: [0, 0, 0],
  coronal: [0, 0, 0],
  sagittal: [0, 0, 0],
}

const INITIAL_ORIENTATIONS: Record<MprViewportId, MprViewportOrientation> = {
  axial: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
  coronal: { top: 'S', right: 'L', bottom: 'I', left: 'R' },
  sagittal: { top: 'S', right: 'P', bottom: 'I', left: 'A' },
}

const genericRuntimeError = '无法构建三视图，请重试或返回轴位查看器'
const partialRuntimeError = '部分影像加载失败，无法完整构建三视图，请重试或返回轴位查看器'
const approvedRuntimeErrors = new Set([
  genericRuntimeError,
  partialRuntimeError,
  '未找到该影像实例，请返回轴位查看器',
  '该序列暂不可查看，请返回轴位查看器',
  '本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器',
  '影像请求无效，请返回轴位查看器',
  '本机影像服务异常，请重试或返回轴位查看器',
  '无法连接本机服务，请确认服务已启动',
])

function safeRuntimeMessage(message: string): string {
  return approvedRuntimeErrors.has(message) ? message : genericRuntimeError
}

export function MprViewportGrid({
  imageIds,
  metadata,
  seriesId,
}: MprViewportGridProps) {
  const axialRef = useRef<HTMLDivElement>(null)
  const coronalRef = useRef<HTMLDivElement>(null)
  const sagittalRef = useRef<HTMLDivElement>(null)
  const clearButtonRef = useRef<HTMLButtonElement>(null)
  const runtimeRef = useRef<MprRuntime | null>(null)
  const writerRef = useRef<ViewerStateWriter | null>(null)
  const persistencePausedRef = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [activeViewport, setActiveViewport] = useState<MprViewportId>('axial')
  const [activeTool, setActiveTool] = useState<MprTool>('crosshairs')
  const [crosshairsVisible, setCrosshairsVisible] = useState(true)
  const [annotationCount, setAnnotationCount] = useState(0)
  const [calibration, setCalibration] = useState<MeasurementCalibration>({
    available: false,
    reason: CALIBRATION_UNAVAILABLE_MESSAGE,
  })
  const [textRequest, setTextRequest] = useState<AnnotationTextRequest | null>(
    null,
  )
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [positions, setPositions] = useState(INITIAL_POSITIONS)
  const [orientations, setOrientations] = useState(INITIAL_ORIENTATIONS)
  const [progress, setProgress] = useState<MprRuntimeProgress>({
    loaded: 0,
    processed: 0,
    total: imageIds.length,
  })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [persistenceStatus, setPersistenceStatus] =
    useState<ViewerStateStatusValue | null>({ kind: 'loading' })

  useEffect(() => {
    const axial = axialRef.current
    const coronal = coronalRef.current
    const sagittal = sagittalRef.current
    if (axial === null || coronal === null || sagittal === null) {
      return
    }
    const elements = { axial, coronal, sagittal }

    const controller = new AbortController()
    const writer = createViewerStateWriter({
      seriesId,
      onStatus: (status) => {
        if (controller.signal.aborted || status === 'idle') {
          return
        }
        setPersistenceStatus(
          status === 'error' ? { kind: 'error', operation: 'save' } : { kind: status },
        )
      },
    })
    writerRef.current = writer
    let resizeObserver: ResizeObserver | null = null
    let runtimeReportedReady = false
    let restoreStarted = false
    let persistenceReady = false
    persistencePausedRef.current = false
    let currentPayload: ViewerStatePayload = {
      axial: null,
      mpr: null,
      annotations: [],
    }
    setActiveViewport('axial')
    setActiveTool('crosshairs')
    setCrosshairsVisible(true)
    setAnnotationCount(0)
    setCalibration({
      available: false,
      reason: CALIBRATION_UNAVAILABLE_MESSAGE,
    })
    setTextRequest(null)
    setClearDialogOpen(false)
    setPositions(INITIAL_POSITIONS)
    setOrientations(INITIAL_ORIENTATIONS)
    setProgress({ loaded: 0, processed: 0, total: imageIds.length })
    setReady(false)
    setError(null)
    setPersistenceStatus({ kind: 'loading' })

    const savedState = getViewerState(seriesId, controller.signal)
      .then((value) => ({ failed: false as const, value }))
      .catch(() => ({ failed: true as const, value: null }))

    async function finishReady(): Promise<void> {
      const runtime = runtimeRef.current
      if (
        controller.signal.aborted ||
        runtime === null ||
        !runtimeReportedReady ||
        restoreStarted
      ) {
        return
      }
      restoreStarted = true
      const saved = await savedState
      if (controller.signal.aborted) {
        return
      }
      if (!saved.failed && saved.value !== null) {
        currentPayload = saved.value.state
      }
      if (saved.failed) {
        setPersistenceStatus({ kind: 'error', operation: 'load' })
      } else if (
        currentPayload.mpr !== null ||
        currentPayload.annotations.length > 0
      ) {
        try {
          const stateToRestore = currentPayload.mpr ?? runtime.captureState().state
          const result = await runtime.applyState(
            stateToRestore,
            currentPayload.annotations,
          )
          const restored = runtime.captureState().state
          setActiveViewport(restored.active_viewport)
          setActiveTool(restored.active_tool)
          setCrosshairsVisible(restored.crosshairs_visible)
          setPersistenceStatus(
            result.skipped > 0
              ? { kind: 'partial', skipped: result.skipped }
              : { kind: 'restored' },
          )
        } catch {
          setPersistenceStatus({ kind: 'error', operation: 'load' })
        }
      } else {
        setPersistenceStatus(null)
      }
      if (!controller.signal.aborted) {
        persistenceReady = true
        setReady(true)
        setError(null)
      }
    }

    const finishReadySafely = () => {
      void finishReady().catch(() => {
        if (!controller.signal.aborted) {
          persistenceReady = true
          setReady(true)
          setPersistenceStatus({ kind: 'error', operation: 'load' })
        }
      })
    }

    void createMprRuntime(
      elements,
      imageIds,
      {
        onActiveViewport: (viewport) => {
          if (!controller.signal.aborted) {
            setActiveViewport(viewport)
          }
        },
        onError: (message) => {
          if (!controller.signal.aborted) {
            setReady(false)
            setError(safeRuntimeMessage(message))
          }
        },
        onOrientation: (viewport, orientation) => {
          if (!controller.signal.aborted) {
            setOrientations((current) => ({ ...current, [viewport]: orientation }))
          }
        },
        onPosition: (viewport, position) => {
          if (!controller.signal.aborted) {
            setPositions((current) => ({ ...current, [viewport]: position }))
          }
        },
        onProgress: (nextProgress) => {
          if (!controller.signal.aborted) {
            setProgress(nextProgress)
          }
        },
        onReady: () => {
          if (!controller.signal.aborted) {
            runtimeReportedReady = true
            finishReadySafely()
          }
        },
        onStateChange: () => {
          const runtime = runtimeRef.current
          if (
            !persistenceReady ||
            persistencePausedRef.current ||
            controller.signal.aborted ||
            runtime === null
          ) {
            return
          }
          const snapshot = runtime.captureState()
          currentPayload = {
            axial: currentPayload.axial,
            mpr: snapshot.state,
            annotations: snapshot.annotations,
          }
          writer.schedule(currentPayload)
        },
      },
      controller.signal,
      {
        onAnnotationCountChange: (count) => {
          if (!controller.signal.aborted) {
            setAnnotationCount(count)
          }
        },
        onCalibrationChange: (value) => {
          if (!controller.signal.aborted) {
            setCalibration(value)
          }
        },
        onTextRequest: (request) => {
          if (!controller.signal.aborted) {
            setTextRequest(request)
          }
        },
      },
    ).then((runtime) => {
      if (controller.signal.aborted) {
        runtime.destroy()
        return
      }
      runtimeRef.current = runtime
      runtime.resize()
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => runtime.resize())
        for (const element of Object.values(elements)) {
          resizeObserver.observe(element)
        }
      }
      finishReadySafely()
    }).catch((runtimeError) => {
      if (
        controller.signal.aborted ||
        (runtimeError instanceof DOMException && runtimeError.name === 'AbortError')
      ) {
        return
      }
      setReady(false)
      setError(safeRuntimeMessage(
        runtimeError instanceof Error ? runtimeError.message : genericRuntimeError,
      ))
    })

    const flushOnPageHide = () => {
      void writer.flush({ keepalive: true }).catch(() => undefined)
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        void writer.flush().catch(() => undefined)
      }
    }
    const resumePersistence = () => {
      persistencePausedRef.current = false
    }
    for (const element of Object.values(elements)) {
      for (const eventName of ['focusin', 'pointerdown']) {
        element.addEventListener(eventName, resumePersistence)
      }
      element.addEventListener('wheel', resumePersistence, { passive: true })
    }
    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flushOnPageHide)

    return () => {
      controller.abort()
      resizeObserver?.disconnect()
      for (const element of Object.values(elements)) {
        for (const eventName of ['focusin', 'pointerdown']) {
          element.removeEventListener(eventName, resumePersistence)
        }
        element.removeEventListener('wheel', resumePersistence)
      }
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flushOnPageHide)
      void writer.destroy().catch(() => undefined)
      runtimeRef.current?.destroy()
      runtimeRef.current = null
      if (writerRef.current === writer) {
        writerRef.current = null
      }
    }
  }, [attempt, imageIds, seriesId])

  function activateTool(tool: MprTool): void {
    persistencePausedRef.current = false
    if (tool === 'crosshairs' && !crosshairsVisible) {
      runtimeRef.current?.setCrosshairsVisible(true)
      setCrosshairsVisible(true)
    }
    runtimeRef.current?.activateTool(tool)
    setActiveTool(tool)
  }

  function toggleCrosshairs(): void {
    persistencePausedRef.current = false
    const visible = !crosshairsVisible
    runtimeRef.current?.setCrosshairsVisible(visible)
    setCrosshairsVisible(visible)
    if (!visible && activeTool === 'crosshairs') {
      setActiveTool('windowLevel')
    }
  }

  function reset(): void {
    persistencePausedRef.current = true
    setActiveViewport('axial')
    setActiveTool('crosshairs')
    setCrosshairsVisible(true)
    setPositions(INITIAL_POSITIONS)
    setOrientations(INITIAL_ORIENTATIONS)
    setAnnotationCount(0)
    runtimeRef.current?.clearAnnotations()
    runtimeRef.current?.reset()
    clearSavedState()
  }

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
      setAttempt((current) => current + 1)
      return
    }
    if (persistenceStatus.operation === 'clear') {
      clearSavedState()
      return
    }
    void writerRef.current?.flush().catch(() => undefined)
  }

  const activeViewportRef = activeViewport === 'axial'
    ? axialRef
    : activeViewport === 'coronal'
      ? coronalRef
      : sagittalRef

  return (
    <section aria-label="CT 三视图画布" className="mpr-runtime-shell">
      <MprToolbar
        activeTool={activeTool}
        activeViewport={activeViewport}
        crosshairsVisible={crosshairsVisible}
        disabled={!ready || error !== null}
        onActivateTool={activateTool}
        onReset={reset}
        onToggleCrosshairs={toggleCrosshairs}
      />
      <MeasurementToolbar
        activeTool={activeTool}
        annotationCount={annotationCount}
        calibration={calibration}
        clearButtonRef={clearButtonRef}
        disabled={!ready || error !== null}
        onActivateTool={activateTool}
        onRequestClear={() => setClearDialogOpen(true)}
      />
      <ViewerStateStatus
        onClear={clearSavedState}
        onRetry={retryPersistence}
        status={persistenceStatus}
      />
      {error === null && !ready ? (
        <div aria-live="polite" className="mpr-load-status">
          <p>正在构建三视图…</p>
          {progress.processed > 0 ? (
            <p>{`已处理 ${progress.processed} / ${progress.total} 张`}</p>
          ) : null}
        </div>
      ) : null}
      {ready ? (
        <p aria-live="polite" className="mpr-load-status">三视图已就绪</p>
      ) : null}
      {error !== null ? (
        <div className="viewer-message viewer-message--error" role="alert">
          <p>{error}</p>
          <button
            className="button button--secondary"
            onClick={() => setAttempt((current) => current + 1)}
            type="button"
          >
            重试三视图
          </button>
        </div>
      ) : null}

      <div className="mpr-grid">
        {VIEWPORTS.map(({ id, label }) => (
          <div
            className={`mpr-viewport-card${activeViewport === id ? ' mpr-viewport-card--active' : ''}`}
            key={id}
          >
            <div
              aria-label={`CT ${label}图像画布`}
              className="mpr-viewport-canvas"
              ref={id === 'axial' ? axialRef : id === 'coronal' ? coronalRef : sagittalRef}
              tabIndex={0}
            />
            <ViewportOverlay
              active={activeViewport === id}
              label={label}
              orientation={orientations[id]}
              position={positions[id]}
            />
          </div>
        ))}
        <aside aria-label="三视图元数据" className="mpr-metadata-panel">
          {metadata ?? (
            <>
              <h2>影像摘要</h2>
              <p>三视图使用当前所选的本机 CT 序列。</p>
            </>
          )}
        </aside>
      </div>
      <AnnotationTextDialog
        request={textRequest}
        returnFocusRef={activeViewportRef}
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
