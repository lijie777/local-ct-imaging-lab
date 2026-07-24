import type {
  AnnotationTextBox,
  PersistedToolName,
  PersistedViewerAnnotation,
  ViewerViewport,
} from '../model/viewerState'
import { parseViewerStatePayload } from '../model/viewerState'


type ToolsModule = typeof import('@cornerstonejs/tools')
export interface AnnotationViewportLike {
  element: HTMLDivElement
  getCamera?(): {
    viewPlaneNormal?: unknown
    viewUp?: unknown
  }
  getViewReference?(): {
    viewPlaneNormal?: unknown
    viewUp?: unknown
  }
}

export type AnnotationViewportMap = Partial<
  Record<ViewerViewport, AnnotationViewportLike>
>

export interface AnnotationRestoreResult {
  restored: number
  skipped: number
}

const VIEWPORTS = ['axial', 'coronal', 'sagittal'] as const
export const PERSISTED_ANNOTATION_TOOL_NAMES = [
  'Length',
  'Angle',
  'RectangleROI',
  'ArrowAnnotate',
] as const satisfies readonly PersistedToolName[]

interface AnnotationLike {
  annotationUID?: unknown
  metadata?: {
    referencedImageId?: unknown
    volumeId?: unknown
    viewPlaneNormal?: unknown
    viewUp?: unknown
  }
  data?: {
    handles?: {
      points?: unknown
      textBox?: {
        hasMoved?: unknown
        worldPosition?: unknown
        worldBoundingBox?: {
          topLeft?: unknown
          topRight?: unknown
          bottomLeft?: unknown
          bottomRight?: unknown
        }
      }
    }
    label?: unknown
  }
}

interface HydratedAnnotationLike {
  metadata?: {
    referencedImageId?: unknown
  }
  data: {
    handles?: Record<string, unknown>
    label?: unknown
  }
  invalidated?: boolean
}

function textBoxCandidate(annotation: AnnotationLike): unknown {
  const textBox = annotation.data?.handles?.textBox
  const box = textBox?.worldBoundingBox
  if (textBox === undefined || box === undefined) {
    return null
  }
  return {
    has_moved: textBox.hasMoved,
    world_position: textBox.worldPosition,
    world_bounding_box: {
      top_left: box.topLeft,
      top_right: box.topRight,
      bottom_left: box.bottomLeft,
      bottom_right: box.bottomRight,
    },
  }
}

function safeAnnotation(
  value: unknown,
  viewport: ViewerViewport,
  toolName: PersistedToolName,
  availableImageIds: ReadonlySet<string>,
  seriesImageAnchor: string | null,
): PersistedViewerAnnotation | null {
  const annotation = value as AnnotationLike
  const metadata = annotation.metadata
  const candidateImageId = metadata?.referencedImageId
  let referencedImageId: string | null = null
  if (typeof candidateImageId === 'string') {
    if (!availableImageIds.has(candidateImageId)) {
      return null
    }
    referencedImageId = candidateImageId
  } else if (
    typeof metadata?.volumeId === 'string' &&
    metadata.volumeId.length > 0
  ) {
    referencedImageId = seriesImageAnchor
  }
  if (referencedImageId === null) {
    return null
  }
  const candidate = {
    viewport,
    tool_name: toolName,
    referenced_image_id: referencedImageId,
    points: annotation.data?.handles?.points,
    label: toolName === 'ArrowAnnotate' ? annotation.data?.label : null,
    text_box: textBoxCandidate(annotation),
  }
  try {
    return parseViewerStatePayload({
      axial: null,
      mpr: null,
      annotations: [candidate],
    }).annotations[0]
  } catch {
    return null
  }
}

function point3(value: unknown): readonly [number, number, number] | null {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? [value[0], value[1], value[2]]
    : null
}

function samePoint3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): boolean {
  return left.every((value, index) => Math.abs(value - right[index]) <= 1e-5)
}

function viewportOrientation(viewport: AnnotationViewportLike): {
  normal: readonly [number, number, number] | null
  up: readonly [number, number, number] | null
} {
  try {
    const reference = viewport.getViewReference?.() ?? viewport.getCamera?.()
    return {
      normal: point3(reference?.viewPlaneNormal),
      up: point3(reference?.viewUp),
    }
  } catch {
    return { normal: null, up: null }
  }
}

function annotationViewport(
  annotation: AnnotationLike,
  viewports: AnnotationViewportMap,
): ViewerViewport | null {
  const available = VIEWPORTS.filter((viewport) => viewports[viewport] !== undefined)
  if (available.length === 1) {
    return available[0]
  }
  const normal = point3(annotation.metadata?.viewPlaneNormal)
  if (normal === null) {
    return null
  }
  const up = point3(annotation.metadata?.viewUp)
  const matches = available.filter((viewport) => {
    const candidate = viewportOrientation(viewports[viewport]!)
    return candidate.normal !== null &&
      samePoint3(candidate.normal, normal) &&
      (up === null || (candidate.up !== null && samePoint3(candidate.up, up)))
  })
  return matches.length === 1 ? matches[0] : null
}

export function capturePersistedAnnotations(
  tools: ToolsModule,
  viewports: AnnotationViewportMap,
  availableImageIds: readonly string[],
): PersistedViewerAnnotation[] {
  const result: PersistedViewerAnnotation[] = []
  const seen = new Set<unknown>()
  const availableImageIdSet = new Set(availableImageIds)
  const seriesImageAnchor = availableImageIds[0] ?? null
  for (const queriedViewport of VIEWPORTS) {
    const queried = viewports[queriedViewport]
    if (queried === undefined) {
      continue
    }
    for (const toolName of PERSISTED_ANNOTATION_TOOL_NAMES) {
      const annotations = tools.annotation.state.getAnnotations(
        toolName,
        queried.element,
      ) as AnnotationLike[] | undefined
      for (const annotation of annotations ?? []) {
        const identity = annotation.annotationUID ?? annotation
        if (seen.has(identity)) {
          continue
        }
        seen.add(identity)
        const sourceViewport = annotationViewport(annotation, viewports)
        if (sourceViewport === null) {
          continue
        }
        const safe = safeAnnotation(
          annotation,
          sourceViewport,
          toolName,
          availableImageIdSet,
          seriesImageAnchor,
        )
        if (safe !== null) {
          result.push(safe)
          if (result.length > 500) {
            return result
          }
        }
      }
    }
  }
  return result
}

function camelTextBox(textBox: AnnotationTextBox): Record<string, unknown> {
  return {
    hasMoved: textBox.has_moved,
    worldPosition: [...textBox.world_position],
    worldBoundingBox: {
      topLeft: [...textBox.world_bounding_box.top_left],
      topRight: [...textBox.world_bounding_box.top_right],
      bottomLeft: [...textBox.world_bounding_box.bottom_left],
      bottomRight: [...textBox.world_bounding_box.bottom_right],
    },
  }
}

export function restorePersistedAnnotations(
  tools: ToolsModule,
  viewports: AnnotationViewportMap,
  annotations: readonly PersistedViewerAnnotation[],
  availableImageIds: readonly string[],
): AnnotationRestoreResult {
  let restored = 0
  let skipped = 0
  const rendered = new Set<HTMLDivElement>()
  const availableImageIdSet = new Set(availableImageIds)

  for (const candidate of annotations) {
    let annotation: PersistedViewerAnnotation
    try {
      annotation = parseViewerStatePayload({
        axial: null,
        mpr: null,
        annotations: [candidate],
      }).annotations[0]
    } catch {
      skipped += 1
      continue
    }
    const viewport = viewports[annotation.viewport]
    if (
      viewport === undefined ||
      !availableImageIdSet.has(annotation.referenced_image_id)
    ) {
      skipped += 1
      continue
    }
    try {
      const hydrated = tools.utilities.annotationHydration(
        viewport as never,
        annotation.tool_name,
        annotation.points,
      ) as HydratedAnnotationLike
      const metadata = hydrated.metadata ?? {}
      hydrated.metadata = metadata
      metadata.referencedImageId = annotation.referenced_image_id
      const handles = hydrated.data.handles ?? {}
      hydrated.data.handles = handles
      if (annotation.text_box !== null) {
        handles.textBox = camelTextBox(annotation.text_box)
      }
      if (annotation.tool_name === 'ArrowAnnotate') {
        hydrated.data.label = annotation.label
      }
      hydrated.invalidated = true
      restored += 1
      rendered.add(viewport.element)
    } catch {
      skipped += 1
    }
  }

  for (const element of rendered) {
    tools.utilities.triggerAnnotationRender(element)
  }
  return { restored, skipped }
}
