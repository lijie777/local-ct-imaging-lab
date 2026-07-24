import {
  deriveMeasurementCalibration,
  type AnnotationTextRequest,
  type ViewerAnnotationCallbacks,
  type ViewerAnnotationTool,
} from '../model/viewerAnnotation'
import {
  scopedEraserToolClass,
  SCOPED_ERASER_TOOL_NAME,
} from './ScopedAnnotationEraserTool'
import {
  capturePersistedAnnotations,
  restorePersistedAnnotations,
  type AnnotationRestoreResult,
  type AnnotationViewportLike,
  type AnnotationViewportMap,
} from '../../viewer-state/core/annotationPersistence'
import type {
  PersistedViewerAnnotation,
  ViewerViewport,
} from '../../viewer-state/model/viewerState'


type CoreModule = typeof import('@cornerstonejs/core')
type ToolsModule = typeof import('@cornerstonejs/tools')

interface ToolGroupLike {
  addTool(name: string, configuration?: Record<string, unknown>): void
  getToolInstance(name: string): unknown
  setToolActive(
    name: string,
    options: { bindings: Array<{ mouseButton: number }> },
  ): void
  setToolPassive(
    name: string,
    options?: { removeAllBindings?: boolean },
  ): void
}

interface AnnotationLike {
  annotationUID?: string
  data?: { label?: unknown }
}

export const ANNOTATION_TOOL_NAMES: Record<ViewerAnnotationTool, string> = {
  angle: 'Angle',
  arrowAnnotate: 'ArrowAnnotate',
  eraseAnnotation: SCOPED_ERASER_TOOL_NAME,
  length: 'Length',
  rectangleRoi: 'RectangleROI',
}

const stateToolNames = [
  ANNOTATION_TOOL_NAMES.length,
  ANNOTATION_TOOL_NAMES.angle,
  ANNOTATION_TOOL_NAMES.rectangleRoi,
  ANNOTATION_TOOL_NAMES.arrowAnnotate,
] as const

export interface ViewerAnnotationController {
  activate(tool: ViewerAnnotationTool): void
  capture(
    elements: Partial<Record<ViewerViewport, HTMLDivElement>>,
  ): PersistedViewerAnnotation[]
  clearAnnotations(): void
  destroy(): void
  restore(
    viewports: AnnotationViewportMap,
    annotations: readonly PersistedViewerAnnotation[],
  ): AnnotationRestoreResult
}

function safeRemove(
  tools: ToolsModule,
  annotationUID: string,
): void {
  try {
    tools.annotation.state.removeAnnotation(annotationUID)
  } catch {
    console.warn('Unable to remove viewer annotation safely')
  }
}

export function installViewerAnnotationTools({
  callbacks,
  core,
  elements,
  imageIds,
  toolGroup,
  tools,
}: {
  callbacks: ViewerAnnotationCallbacks
  core: CoreModule
  elements: readonly HTMLDivElement[]
  imageIds: readonly string[]
  toolGroup: ToolGroupLike
  tools: ToolsModule
}): ViewerAnnotationController {
  let destroyed = false
  let restoring = false
  let activeTextRequest: AnnotationTextRequest | null = null

  function closeTextRequest(request: AnnotationTextRequest): void {
    if (activeTextRequest === request) {
      activeTextRequest = null
      callbacks.onTextRequest(null)
    }
  }

  function requestText(
    mode: 'create' | 'edit',
    initialValue: string,
    done: (value?: string) => void,
  ): void {
    activeTextRequest?.cancel()
    if (destroyed) {
      if (mode === 'create') {
        done(undefined)
      }
      return
    }
    const request: AnnotationTextRequest = {
      initialValue,
      mode,
      cancel: () => {
        if (activeTextRequest !== request) {
          return
        }
        if (mode === 'create') {
          done(undefined)
        }
        closeTextRequest(request)
      },
      complete: (value) => {
        if (destroyed || activeTextRequest !== request) {
          return
        }
        done(value)
        closeTextRequest(request)
      },
    }
    activeTextRequest = request
    callbacks.onTextRequest(request)
  }

  const ScopedEraser = scopedEraserToolClass(tools)
  const toolClasses = [
    tools.LengthTool,
    tools.AngleTool,
    tools.RectangleROITool,
    tools.ArrowAnnotateTool,
    ScopedEraser,
  ]
  for (const toolClass of toolClasses) {
    if (!tools.store.hasTool(toolClass.toolName)) {
      tools.addTool(toolClass)
    }
  }
  toolGroup.addTool(tools.LengthTool.toolName)
  toolGroup.addTool(tools.AngleTool.toolName)
  toolGroup.addTool(tools.RectangleROITool.toolName)
  toolGroup.addTool(tools.ArrowAnnotateTool.toolName, {
    changeTextCallback: (
      annotation: AnnotationLike,
      _event: unknown,
      done: (value?: string) => void,
    ) => requestText(
      'edit',
      typeof annotation.data?.label === 'string' ? annotation.data.label : '',
      done,
    ),
    getTextCallback: (done: (value?: string) => void) =>
      requestText('create', '', done),
  })
  toolGroup.addTool(SCOPED_ERASER_TOOL_NAME)

  callbacks.onCalibrationChange(deriveMeasurementCalibration(
    imageIds.map((imageId) =>
      core.metaData.get('imagePlaneModule', imageId) as {
        rowPixelSpacing?: unknown
        columnPixelSpacing?: unknown
      } | undefined,
    ),
  ))

  function annotationUIDs(): Set<string> {
    const result = new Set<string>()
    for (const element of elements) {
      for (const toolName of stateToolNames) {
        const annotations = tools.annotation.state.getAnnotations(
          toolName,
          element,
        ) as AnnotationLike[]
        for (const annotation of annotations ?? []) {
          if (typeof annotation.annotationUID === 'string') {
            result.add(annotation.annotationUID)
          }
        }
      }
    }
    return result
  }

  function captureViewports(
    elementsByViewport: Partial<Record<ViewerViewport, HTMLDivElement>>,
  ): AnnotationViewportMap {
    const result: AnnotationViewportMap = {}
    for (const viewport of Object.keys(elementsByViewport) as ViewerViewport[]) {
      const element = elementsByViewport[viewport]
      if (element === undefined) {
        continue
      }
      let resolved: AnnotationViewportLike = { element }
      try {
        const enabledViewport = core.getEnabledElement(element)?.viewport
        if (enabledViewport !== undefined) {
          resolved = enabledViewport as AnnotationViewportLike
        }
      } catch {
        // A single stack viewport can still be captured from its element.
      }
      result[viewport] = resolved
    }
    return result
  }

  function reportCount(): void {
    callbacks.onAnnotationCountChange(annotationUIDs().size)
  }

  function handleAnnotationChange(): void {
    reportCount()
    if (!restoring && !destroyed) {
      callbacks.onAnnotationsChange?.()
    }
  }

  const annotationEventTypes = [
    tools.Enums.Events.ANNOTATION_COMPLETED,
    tools.Enums.Events.ANNOTATION_MODIFIED,
    tools.Enums.Events.ANNOTATION_REMOVED,
  ]
  for (const eventType of annotationEventTypes) {
    core.eventTarget.addEventListener(eventType, handleAnnotationChange)
  }
  reportCount()

  function clearAnnotations(): void {
    const annotationUIDsToRemove = annotationUIDs()
    for (const annotationUID of annotationUIDsToRemove) {
      safeRemove(tools, annotationUID)
    }
    if (annotationUIDsToRemove.size > 0) {
      for (const element of elements) {
        tools.utilities.triggerAnnotationRender(element)
      }
    }
    reportCount()
    if (!restoring && !destroyed && annotationUIDsToRemove.size > 0) {
      callbacks.onAnnotationsChange?.()
    }
  }

  return {
    activate: (tool) => {
      for (const toolName of Object.values(ANNOTATION_TOOL_NAMES)) {
        toolGroup.setToolPassive(toolName, { removeAllBindings: true })
      }
      toolGroup.setToolActive(ANNOTATION_TOOL_NAMES[tool], {
        bindings: [{ mouseButton: tools.Enums.MouseBindings.Primary }],
      })
    },
    capture: (elementsByViewport) =>
      destroyed
        ? []
        : capturePersistedAnnotations(
            tools,
            captureViewports(elementsByViewport),
            imageIds,
          ),
    clearAnnotations,
    destroy: () => {
      if (destroyed) {
        return
      }
      activeTextRequest?.cancel()
      for (const element of elements) {
        tools.cancelActiveManipulations(element)
      }
      for (const eventType of annotationEventTypes) {
        core.eventTarget.removeEventListener(eventType, handleAnnotationChange)
      }
      restoring = true
      clearAnnotations()
      callbacks.onTextRequest(null)
      destroyed = true
    },
    restore: (viewports, annotations) => {
      if (destroyed) {
        return { restored: 0, skipped: annotations.length }
      }
      restoring = true
      try {
        return restorePersistedAnnotations(tools, viewports, annotations, imageIds)
      } finally {
        restoring = false
        reportCount()
      }
    },
  }
}
