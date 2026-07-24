import type { RefObject } from 'react'

import {
  GEOMETRY_MEASUREMENT_TOOLS,
  type MeasurementCalibration,
  type ViewerAnnotationTool,
} from '../model/viewerAnnotation'


interface MeasurementToolbarProps {
  activeTool: string
  annotationCount: number
  calibration: MeasurementCalibration
  clearButtonRef: RefObject<HTMLButtonElement | null>
  disabled: boolean
  onActivateTool(tool: ViewerAnnotationTool): void
  onRequestClear(): void
}

const TOOLS: ReadonlyArray<{
  id: ViewerAnnotationTool
  label: string
}> = [
  { id: 'length', label: '长度' },
  { id: 'angle', label: '角度' },
  { id: 'rectangleRoi', label: '矩形 ROI' },
  { id: 'arrowAnnotate', label: '箭头标注' },
  { id: 'eraseAnnotation', label: '删除单项' },
]

const GEOMETRY_TOOL_SET = new Set<ViewerAnnotationTool>(
  GEOMETRY_MEASUREMENT_TOOLS,
)

export function MeasurementToolbar({
  activeTool,
  annotationCount,
  calibration,
  clearButtonRef,
  disabled,
  onActivateTool,
  onRequestClear,
}: MeasurementToolbarProps) {
  const hasAnnotations = annotationCount > 0

  return (
    <div
      aria-label="测量与标注工具"
      className="measurement-toolbar"
      role="toolbar"
    >
      <div className="measurement-toolbar__tools">
        {TOOLS.map(({ id, label }) => {
          const geometryUnavailable =
            GEOMETRY_TOOL_SET.has(id) && !calibration.available
          const requiresAnnotation = id === 'eraseAnnotation'
          return (
            <button
              aria-pressed={activeTool === id}
              className="button button--secondary"
              disabled={
                disabled ||
                geometryUnavailable ||
                (requiresAnnotation && !hasAnnotations)
              }
              key={id}
              onClick={() => onActivateTool(id)}
              type="button"
            >
              {label}
            </button>
          )
        })}
        <button
          className="button button--danger"
          disabled={disabled || !hasAnnotations}
          onClick={onRequestClear}
          ref={clearButtonRef}
          type="button"
        >
          全部清空
        </button>
      </div>
      <div className="measurement-toolbar__status">
        <span aria-live="polite">
          当前共有 {annotationCount} 项测量与标注
        </span>
        {!calibration.available && calibration.reason !== null ? (
          <span>{calibration.reason}</span>
        ) : null}
      </div>
    </div>
  )
}
