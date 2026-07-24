import type { SeriesDetail } from '../../dicom-import/model/dicomImport'
import { viewabilityReasonLabel } from '../../dicom-import/model/viewability'
import type { ViewerTool } from '../../axial-viewer/model/axialViewer'
import type { ViewerAnnotationTool } from '../../viewer-annotations/model/viewerAnnotation'


export type MprViewportId = 'axial' | 'coronal' | 'sagittal'
export type MprTool = 'crosshairs' | ViewerTool | ViewerAnnotationTool
export type Point3 = readonly [number, number, number]

export interface MprEligibility {
  eligible: boolean
  reason: string | null
  sliceSpacing: number | null
}

export type MprErrorKind =
  | 'notFound'
  | 'notViewable'
  | 'geometry'
  | 'service'
  | 'validation'
  | 'persistence'
  | 'unknown'

export type MprSeriesStatus = 'idle' | 'loading' | 'success' | 'error'
export type MprRuntimeStatus =
  | 'creating'
  | 'loading'
  | 'ready'
  | 'error'
  | 'cancelled'
  | 'destroyed'

export interface MprViewportOrientation {
  top: string
  right: string
  bottom: string
  left: string
}

export interface MprViewportPosition {
  id: MprViewportId
  position: Point3
  orientation: MprViewportOrientation
}

export interface LinkedPosition {
  world: Point3
  sourceViewport: MprViewportId
}

const ORIENTATION_TOLERANCE = 1e-6
const NORMAL_TOLERANCE = 1e-6
const POSITION_TOLERANCE_MM = 1e-3

const ineligible = (reason: string): MprEligibility => ({
  eligible: false,
  reason,
  sliceSpacing: null,
})

function finiteVector(value: number[] | null, length: number): number[] | null {
  return value !== null &&
    value.length === length &&
    value.every(Number.isFinite)
    ? value
    : null
}

function normalFromOrientation(orientation: readonly number[]): Point3 | null {
  const [rx, ry, rz, cx, cy, cz] = orientation
  const normal: [number, number, number] = [
    ry * cz - rz * cy,
    rz * cx - rx * cz,
    rx * cy - ry * cx,
  ]
  const length = Math.hypot(...normal)
  return length <= NORMAL_TOLERANCE
    ? null
    : [normal[0] / length, normal[1] / length, normal[2] / length]
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export function deriveMprEligibility(detail: SeriesDetail): MprEligibility {
  if (detail.viewability_status !== 'eligible') {
    return ineligible(viewabilityReasonLabel(detail.viewability_reason))
  }
  if (detail.modality !== 'CT') {
    return ineligible('当前仅支持 CT 序列构建三视图')
  }
  if (detail.instances.length < 2) {
    return ineligible('至少需要两个不同空间位置的切片')
  }

  const positions: number[][] = []
  const orientations: number[][] = []
  let rows: number | null = null
  let columns: number | null = null
  for (const instance of detail.instances) {
    const position = finiteVector(instance.image_position_patient, 3)
    const orientation = finiteVector(instance.image_orientation_patient, 6)
    if (position === null || orientation === null) {
      return ineligible('影像空间信息不完整，无法构建三视图')
    }
    if (
      !Number.isInteger(instance.rows) ||
      !Number.isInteger(instance.columns) ||
      instance.rows === null ||
      instance.columns === null ||
      instance.rows <= 0 ||
      instance.columns <= 0 ||
      (rows !== null && rows !== instance.rows) ||
      (columns !== null && columns !== instance.columns)
    ) {
      return ineligible('图像尺寸无效或不一致，无法构建三视图')
    }
    rows ??= instance.rows
    columns ??= instance.columns
    positions.push(position)
    orientations.push(orientation)
  }

  const referenceOrientation = orientations[0]
  const normal = normalFromOrientation(referenceOrientation)
  if (normal === null) {
    return ineligible('影像方向无效，无法构建三视图')
  }
  for (const orientation of orientations) {
    if (normalFromOrientation(orientation) === null) {
      return ineligible('影像方向无效，无法构建三视图')
    }
    if (
      orientation.some(
        (component, index) =>
          Math.abs(component - referenceOrientation[index]) > ORIENTATION_TOLERANCE,
      )
    ) {
      return ineligible('图像方向不一致，无法构建三视图')
    }
  }

  const projections = positions
    .map((position) =>
      position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2],
    )
    .sort((left, right) => left - right)
  const distinctProjections: number[] = []
  for (const projection of projections) {
    const previous = distinctProjections.at(-1)
    if (previous === undefined || projection - previous > POSITION_TOLERANCE_MM) {
      distinctProjections.push(projection)
    }
  }
  if (distinctProjections.length < 2) {
    return ineligible('至少需要两个不同空间位置的切片')
  }

  const spacings = distinctProjections.slice(1).map(
    (projection, index) => projection - distinctProjections[index],
  )
  if (spacings.some((spacing) => spacing <= 0)) {
    return ineligible('至少需要两个不同空间位置的切片')
  }
  const sliceSpacing = median(spacings)
  const spacingTolerance = Math.max(POSITION_TOLERANCE_MM, sliceSpacing * 0.01)
  const spacingIsUniform = spacings.every(
    (spacing) => Math.abs(spacing - sliceSpacing) <= spacingTolerance,
  )
  return {
    eligible: true,
    reason: null,
    sliceSpacing: spacingIsUniform ? sliceSpacing : null,
  }
}
