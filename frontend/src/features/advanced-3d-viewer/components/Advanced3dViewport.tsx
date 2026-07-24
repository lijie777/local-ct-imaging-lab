import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  createAdvanced3dRuntime,
  type Advanced3dRuntime,
  type Advanced3dRuntimeProgress,
} from '../core/advanced3dCornerstone'
import {
  clampSurfaceThreshold,
  DEFAULT_ADVANCED_3D_STATE,
  defaultSurfaceThreshold,
  type Advanced3dMode,
  type StandardViewDirection,
  type VolumePreset,
} from '../model/advanced3dViewer'
import { Advanced3dToolbar } from './Advanced3dToolbar'


interface Advanced3dViewportProps {
  imageIds: readonly string[]
  metadata?: ReactNode
  onRetry?: () => void | Promise<void>
}

const genericRuntimeError = '无法构建高级 3D，请重试或返回轴位查看器'
const surfaceRuntimeError = '无法重建表面，请调整阈值或切换其他模式'
const approvedRuntimeErrors = new Set([
  genericRuntimeError,
  '本机 DICOM 文件缺失，请恢复文件后重试',
  '无法连接本机服务，请确认服务已启动',
  '本机影像服务异常，请重试或返回轴位查看器',
  '本机影像数据暂时不可用，请重试或返回轴位查看器',
  '当前浏览器无法使用高级 3D，请使用支持三维图形的现代浏览器',
])

const MODE_LABELS: Record<Advanced3dMode, string> = {
  volume: '体绘制',
  mip: 'MIP',
  surface: '表面重建',
}

type SurfaceStatus =
  | { kind: 'building' }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'idle' }
  | { kind: 'ready'; thresholdHu: number }

function safeRuntimeMessage(error: unknown): string {
  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : ''
  return approvedRuntimeErrors.has(message) ? message : genericRuntimeError
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function Advanced3dViewport({
  imageIds,
  metadata,
  onRetry,
}: Advanced3dViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<Advanced3dRuntime | null>(null)
  const primaryDragStartRef = useRef<{ x: number; y: number } | null>(null)
  const runtimeTokenRef = useRef(0)
  const runtimeActionTokenRef = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<Advanced3dMode>(
    DEFAULT_ADVANCED_3D_STATE.mode,
  )
  const [preset, setPreset] = useState<VolumePreset>(
    DEFAULT_ADVANCED_3D_STATE.preset,
  )
  const [direction, setDirection] = useState<StandardViewDirection | null>(
    DEFAULT_ADVANCED_3D_STATE.direction,
  )
  const [mipThicknessRange, setMipThicknessRange] = useState<
    readonly [number, number]
  >([0, 0])
  const [mipThickness, setMipThickness] = useState(0)
  const [surfaceRange, setSurfaceRange] = useState<readonly [number, number]>([0, 0])
  const [surfaceThreshold, setSurfaceThreshold] = useState(0)
  const [surfaceStride, setSurfaceStride] = useState(1)
  const [surfaceStatus, setSurfaceStatus] = useState<SurfaceStatus>({ kind: 'idle' })
  const [progress, setProgress] = useState<Advanced3dRuntimeProgress>({
    loaded: 0,
    processed: 0,
    total: imageIds.length,
  })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) {
      return
    }

    const controller = new AbortController()
    runtimeTokenRef.current += 1
    const runtimeToken = runtimeTokenRef.current
    let ownedRuntime: Advanced3dRuntime | null = null
    let resizeObserver: ResizeObserver | null = null
    let runtimeFailed = false
    runtimeRef.current = null
    runtimeActionTokenRef.current += 1
    setMode(DEFAULT_ADVANCED_3D_STATE.mode)
    setPreset(DEFAULT_ADVANCED_3D_STATE.preset)
    setDirection(DEFAULT_ADVANCED_3D_STATE.direction)
    setMipThicknessRange([0, 0])
    setMipThickness(0)
    setSurfaceRange([0, 0])
    setSurfaceThreshold(0)
    setSurfaceStride(1)
    setSurfaceStatus({ kind: 'idle' })
    setProgress({ loaded: 0, processed: 0, total: imageIds.length })
    setReady(false)
    setError(null)

    function isCurrentRuntime(): boolean {
      return !controller.signal.aborted && runtimeTokenRef.current === runtimeToken
    }

    function syncRuntimeRanges(runtime: Advanced3dRuntime): void {
      const mipRange = runtime.getMipThicknessRange()
      setMipThicknessRange(mipRange)
      setMipThickness(mipRange[1])
      const nextSurfaceRange = runtime.getSurfaceRange()
      setSurfaceRange(nextSurfaceRange)
      setSurfaceThreshold(defaultSurfaceThreshold(nextSurfaceRange))
    }

    void createAdvanced3dRuntime(
      { viewport },
      imageIds,
      {
        onError: (message) => {
          if (!isCurrentRuntime()) {
            return
          }
          runtimeFailed = true
          runtimeActionTokenRef.current += 1
          setReady(false)
          setError(safeRuntimeMessage(message))
        },
        onProgress: (nextProgress) => {
          if (isCurrentRuntime()) {
            setProgress(nextProgress)
          }
        },
        onReady: () => {
          if (isCurrentRuntime() && !runtimeFailed) {
            if (runtimeRef.current !== null) {
              syncRuntimeRanges(runtimeRef.current)
            }
            setReady(true)
            setError(null)
          }
        },
      },
      controller.signal,
    ).then((runtime) => {
      if (!isCurrentRuntime()) {
        runtime.destroy()
        return
      }
      ownedRuntime = runtime
      runtimeRef.current = runtime
      viewport.tabIndex = 0
      runtime.resize()
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (isCurrentRuntime() && runtimeRef.current === runtime) {
            runtime.resize()
          }
        })
        resizeObserver.observe(viewport)
      }
      syncRuntimeRanges(runtime)
    }).catch((runtimeError) => {
      if (!isCurrentRuntime() || isAbortError(runtimeError)) {
        return
      }
      runtimeFailed = true
      setReady(false)
      setError(safeRuntimeMessage(runtimeError))
    })

    return () => {
      resizeObserver?.disconnect()
      resizeObserver = null
      controller.abort()
      runtimeActionTokenRef.current += 1
      ownedRuntime?.destroy()
      if (runtimeRef.current === ownedRuntime) {
        runtimeRef.current = null
      }
    }
  }, [attempt, imageIds])

  function failRuntimeAction(runtimeError: unknown): void {
    setReady(false)
    setError(safeRuntimeMessage(runtimeError))
  }

  function changeMode(nextMode: Advanced3dMode): void {
    const runtime = runtimeRef.current
    if (runtime === null) {
      return
    }
    const runtimeToken = runtimeTokenRef.current
    runtimeActionTokenRef.current += 1
    const actionToken = runtimeActionTokenRef.current
    setSurfaceStatus((current) => current.kind === 'building'
      ? { kind: 'idle' }
      : current)
    try {
      if (nextMode === 'mip') {
        const fullThickness = mipThicknessRange[1]
        runtime.setDirection(DEFAULT_ADVANCED_3D_STATE.direction)
        runtime.setMipThickness(fullThickness)
        setDirection(DEFAULT_ADVANCED_3D_STATE.direction)
        setMipThickness(fullThickness)
      }
      const result = runtime.setMode(nextMode)
      setMode(nextMode)
      void result.catch((runtimeError) => {
        if (
          runtimeRef.current === runtime &&
          runtimeTokenRef.current === runtimeToken &&
          runtimeActionTokenRef.current === actionToken
        ) {
          failRuntimeAction(runtimeError)
        }
      })
    } catch (runtimeError) {
      failRuntimeAction(runtimeError)
    }
  }

  function changePreset(nextPreset: VolumePreset): void {
    const runtime = runtimeRef.current
    if (runtime === null) {
      return
    }
    runtimeActionTokenRef.current += 1
    try {
      runtime.setPreset(nextPreset)
      setPreset(nextPreset)
    } catch (runtimeError) {
      failRuntimeAction(runtimeError)
    }
  }

  function changeDirection(nextDirection: StandardViewDirection): void {
    const runtime = runtimeRef.current
    if (runtime === null) {
      return
    }
    runtimeActionTokenRef.current += 1
    try {
      runtime.setDirection(nextDirection)
      setDirection(nextDirection)
    } catch (runtimeError) {
      failRuntimeAction(runtimeError)
    }
  }

  function changeMipThickness(value: number): void {
    const runtime = runtimeRef.current
    if (runtime === null) {
      return
    }
    const clamped = Math.min(
      mipThicknessRange[1],
      Math.max(mipThicknessRange[0], value),
    )
    runtimeActionTokenRef.current += 1
    try {
      runtime.setMipThickness(clamped)
      setMipThickness(clamped)
    } catch (runtimeError) {
      failRuntimeAction(runtimeError)
    }
  }

  function changeSurfaceThreshold(value: number): void {
    setSurfaceThreshold(clampSurfaceThreshold(value, surfaceRange))
  }

  async function applySurfaceThreshold(): Promise<void> {
    const runtime = runtimeRef.current
    if (runtime === null) {
      return
    }
    const runtimeToken = runtimeTokenRef.current
    runtimeActionTokenRef.current += 1
    const actionToken = runtimeActionTokenRef.current
    setSurfaceStatus({ kind: 'building' })

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    if (
      runtimeRef.current !== runtime ||
      runtimeTokenRef.current !== runtimeToken ||
      runtimeActionTokenRef.current !== actionToken
    ) {
      return
    }

    try {
      const result = await runtime.setSurfaceThreshold(surfaceThreshold)
      if (
        runtimeRef.current !== runtime ||
        runtimeTokenRef.current !== runtimeToken ||
        runtimeActionTokenRef.current !== actionToken
      ) {
        return
      }
      setSurfaceThreshold(result.thresholdHu)
      setSurfaceStride(result.stride)
      setSurfaceStatus(result.kind === 'ready'
        ? { kind: 'ready', thresholdHu: result.thresholdHu }
        : { kind: 'empty' })
    } catch {
      if (
        runtimeRef.current === runtime &&
        runtimeTokenRef.current === runtimeToken &&
        runtimeActionTokenRef.current === actionToken
      ) {
        setSurfaceStatus({ kind: 'error' })
      }
    }
  }

  function reset(): void {
    const runtime = runtimeRef.current
    if (runtime === null) {
      return
    }
    runtimeActionTokenRef.current += 1
    try {
      runtime.reset()
      setMode(DEFAULT_ADVANCED_3D_STATE.mode)
      setPreset(DEFAULT_ADVANCED_3D_STATE.preset)
      setDirection(DEFAULT_ADVANCED_3D_STATE.direction)
      setMipThickness(mipThicknessRange[1])
      setSurfaceThreshold(defaultSurfaceThreshold(surfaceRange))
      setSurfaceStride(1)
      setSurfaceStatus({ kind: 'idle' })
    } catch (runtimeError) {
      failRuntimeAction(runtimeError)
    }
  }

  return (
    <section aria-label="CT 高级 3D 查看器" className="advanced-3d-runtime-shell">
      <Advanced3dToolbar
        busy={!ready || error !== null || surfaceStatus.kind === 'building'}
        direction={direction}
        mipThickness={mipThickness}
        mipThicknessRange={mipThicknessRange}
        mode={mode}
        onApplySurfaceThreshold={() => {
          void applySurfaceThreshold()
        }}
        onDirectionChange={changeDirection}
        onMipThicknessChange={changeMipThickness}
        onModeChange={changeMode}
        onPresetChange={changePreset}
        onReset={reset}
        onSurfaceThresholdChange={changeSurfaceThreshold}
        preset={preset}
        surfaceRange={surfaceRange}
        surfaceStride={surfaceStride}
        surfaceThreshold={surfaceThreshold}
      />

      <p aria-live="polite" className="advanced-3d-mode-status">
        {`当前模式：${MODE_LABELS[mode]}`}
      </p>

      {mode === 'surface' ? (
        <p aria-live="polite" className="advanced-3d-surface-status">
          {surfaceStatus.kind === 'building'
            ? '正在重建表面…'
            : surfaceStatus.kind === 'ready'
              ? `表面已生成：${surfaceStatus.thresholdHu} HU`
              : surfaceStatus.kind === 'empty'
                ? '该阈值未生成可见表面'
                : surfaceStatus.kind === 'error'
                  ? surfaceRuntimeError
                  : `当前阈值 ${surfaceThreshold} HU`}
        </p>
      ) : null}

      {error === null && !ready ? (
        <div aria-live="polite" className="advanced-3d-load-status">
          <p>正在构建高级 3D…</p>
          <p>{`已处理 ${progress.processed} / ${progress.total} 张`}</p>
        </div>
      ) : null}
      {ready ? (
        <p aria-live="polite" className="advanced-3d-load-status">
          高级 3D 已就绪
        </p>
      ) : null}
      {error !== null ? (
        <div className="viewer-message viewer-message--error" role="alert">
          <p>{error}</p>
          <button
            className="button button--secondary"
            onClick={() => {
              if (onRetry === undefined) {
                setAttempt((current) => current + 1)
                return
              }
              void onRetry()
            }}
            type="button"
          >
            重试高级 3D
          </button>
        </div>
      ) : null}

      <div className="advanced-3d-layout">
        <div className="advanced-3d-canvas-container">
          <div
            aria-label="CT 高级 3D 图像画布"
            className="advanced-3d-viewport"
            onPointerDown={(event) => {
              if (mode === 'mip' && event.button === 0) {
                primaryDragStartRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                }
              } else {
                primaryDragStartRef.current = null
              }
            }}
            onPointerMove={(event) => {
              const start = primaryDragStartRef.current
              if (
                mode !== 'mip' ||
                start === null ||
                (event.buttons & 1) !== 1
              ) {
                return
              }
              if (
                Math.hypot(event.clientX - start.x, event.clientY - start.y) > 2
              ) {
                primaryDragStartRef.current = null
                setDirection(null)
              }
            }}
            onPointerUp={() => {
              primaryDragStartRef.current = null
            }}
            onPointerCancel={() => {
              primaryDragStartRef.current = null
            }}
            ref={viewportRef}
            tabIndex={0}
          />
        </div>
        <aside aria-label="高级 3D 元数据" className="advanced-3d-metadata-panel">
          {metadata ?? (
            <>
              <h2>影像摘要</h2>
              <p>高级 3D 使用当前所选的本机 CT 序列。</p>
            </>
          )}
        </aside>
      </div>
    </section>
  )
}
