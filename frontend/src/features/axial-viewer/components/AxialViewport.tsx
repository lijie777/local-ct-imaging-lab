import { useEffect, useRef, useState } from 'react'

import {
  createAxialViewportRuntime,
  initializeCornerstone,
  toSafeViewerError,
  type AxialViewportRuntime,
} from '../core/cornerstone'
import { ViewerToolbar } from './ViewerToolbar'
import type { ViewerTool } from '../model/axialViewer'


interface AxialViewportProps {
  imageIds: readonly string[]
}

export function AxialViewport({ imageIds }: AxialViewportProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<AxialViewportRuntime | null>(null)
  const initialIndex = Math.floor(imageIds.length / 2)
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [activeTool, setActiveTool] = useState<ViewerTool>('windowLevel')
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [runtimeReady, setRuntimeReady] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const element = elementRef.current
    if (element === null) {
      return
    }
    let cancelled = false
    let runtimeErrorReported = false
    const controller = new AbortController()
    setCurrentIndex(initialIndex)
    setActiveTool('windowLevel')
    setRuntimeError(null)
    setRuntimeReady(false)

    void initializeCornerstone()
      .then(() => {
        if (cancelled) {
          return null
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
        )
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

    return () => {
      cancelled = true
      controller.abort()
      resizeObserver?.disconnect()
      runtimeRef.current?.destroy()
      runtimeRef.current = null
    }
  }, [attempt, imageIds, initialIndex])

  return (
    <section aria-label="轴位影像" className="axial-viewport-shell">
      <ViewerToolbar
        activeTool={activeTool}
        currentIndex={currentIndex}
        disabled={!runtimeReady}
        onNext={() => void runtimeRef.current?.next()}
        onPrevious={() => void runtimeRef.current?.previous()}
        onReset={() => {
          setActiveTool('windowLevel')
          runtimeRef.current?.activateTool('windowLevel')
          void runtimeRef.current?.reset()
        }}
        onToolChange={(tool) => {
          setActiveTool(tool)
          runtimeRef.current?.activateTool(tool)
        }}
        total={imageIds.length}
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
      />
    </section>
  )
}
