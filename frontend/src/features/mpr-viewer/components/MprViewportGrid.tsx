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


interface MprViewportGridProps {
  imageIds: readonly string[]
  metadata?: ReactNode
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

export function MprViewportGrid({ imageIds, metadata }: MprViewportGridProps) {
  const axialRef = useRef<HTMLDivElement>(null)
  const coronalRef = useRef<HTMLDivElement>(null)
  const sagittalRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<MprRuntime | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [activeViewport, setActiveViewport] = useState<MprViewportId>('axial')
  const [activeTool, setActiveTool] = useState<MprTool>('crosshairs')
  const [crosshairsVisible, setCrosshairsVisible] = useState(true)
  const [positions, setPositions] = useState(INITIAL_POSITIONS)
  const [orientations, setOrientations] = useState(INITIAL_ORIENTATIONS)
  const [progress, setProgress] = useState<MprRuntimeProgress>({
    loaded: 0,
    processed: 0,
    total: imageIds.length,
  })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const axial = axialRef.current
    const coronal = coronalRef.current
    const sagittal = sagittalRef.current
    if (axial === null || coronal === null || sagittal === null) {
      return
    }
    const elements = { axial, coronal, sagittal }

    const controller = new AbortController()
    let resizeObserver: ResizeObserver | null = null
    setActiveViewport('axial')
    setActiveTool('crosshairs')
    setCrosshairsVisible(true)
    setPositions(INITIAL_POSITIONS)
    setOrientations(INITIAL_ORIENTATIONS)
    setProgress({ loaded: 0, processed: 0, total: imageIds.length })
    setReady(false)
    setError(null)

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
            setReady(true)
            setError(null)
          }
        },
      },
      controller.signal,
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

    return () => {
      controller.abort()
      resizeObserver?.disconnect()
      runtimeRef.current?.destroy()
      runtimeRef.current = null
    }
  }, [attempt, imageIds])

  function activateTool(tool: MprTool): void {
    if (tool === 'crosshairs' && !crosshairsVisible) {
      runtimeRef.current?.setCrosshairsVisible(true)
      setCrosshairsVisible(true)
    }
    runtimeRef.current?.activateTool(tool)
    setActiveTool(tool)
  }

  function toggleCrosshairs(): void {
    const visible = !crosshairsVisible
    runtimeRef.current?.setCrosshairsVisible(visible)
    setCrosshairsVisible(visible)
    if (!visible && activeTool === 'crosshairs') {
      setActiveTool('windowLevel')
    }
  }

  function reset(): void {
    setActiveViewport('axial')
    setActiveTool('crosshairs')
    setCrosshairsVisible(true)
    setPositions(INITIAL_POSITIONS)
    setOrientations(INITIAL_ORIENTATIONS)
    runtimeRef.current?.reset()
  }

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
    </section>
  )
}
