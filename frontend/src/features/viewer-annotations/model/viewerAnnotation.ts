export const ANNOTATION_TEXT_MAX_LENGTH = 200
export const CALIBRATION_UNAVAILABLE_MESSAGE =
  '影像缺少可靠 Pixel Spacing，无法进行几何测量'

export const VIEWER_ANNOTATION_TOOLS = [
  'length',
  'angle',
  'rectangleRoi',
  'arrowAnnotate',
  'eraseAnnotation',
] as const

export const GEOMETRY_MEASUREMENT_TOOLS = [
  'length',
  'angle',
  'rectangleRoi',
] as const

export type ViewerAnnotationTool = typeof VIEWER_ANNOTATION_TOOLS[number]
export type GeometryMeasurementTool = typeof GEOMETRY_MEASUREMENT_TOOLS[number]

export interface MeasurementCalibration {
  available: boolean
  reason: string | null
}

export interface AnnotationTextRequest {
  initialValue: string
  mode: 'create' | 'edit'
  cancel(): void
  complete(value: string): void
}

export interface ViewerAnnotationCallbacks {
  onAnnotationsChange?(): void
  onAnnotationCountChange(count: number): void
  onCalibrationChange(calibration: MeasurementCalibration): void
  onTextRequest(request: AnnotationTextRequest | null): void
}

interface ImagePlaneModule {
  rowPixelSpacing?: unknown
  columnPixelSpacing?: unknown
  usingDefaultValues?: unknown
}

const controlCharacterPattern = /[\u0000-\u001f\u007f]/u

export function validateAnnotationText(value: string): {
  error: string | null
  value: string | null
} {
  const normalized = value.trim()
  if (normalized.length === 0) {
    return { error: '请输入标注文字', value: null }
  }
  if (controlCharacterPattern.test(normalized)) {
    return { error: '标注文字不能包含换行或控制字符', value: null }
  }
  if (normalized.length > ANNOTATION_TEXT_MAX_LENGTH) {
    return {
      error: `标注文字不能超过 ${ANNOTATION_TEXT_MAX_LENGTH} 个字符`,
      value: null,
    }
  }
  return { error: null, value: normalized }
}

export function isViewerAnnotationTool(value: string): value is ViewerAnnotationTool {
  return (VIEWER_ANNOTATION_TOOLS as readonly string[]).includes(value)
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function consistent(value: number, reference: number): boolean {
  const tolerance = Math.max(1e-6, Math.abs(reference) * 1e-6)
  return Math.abs(value - reference) <= tolerance
}

export function deriveMeasurementCalibration(
  modules: ReadonlyArray<ImagePlaneModule | undefined>,
): MeasurementCalibration {
  const first = modules[0]
  if (
    first === undefined ||
    first.usingDefaultValues === true ||
    !positiveFinite(first.rowPixelSpacing) ||
    !positiveFinite(first.columnPixelSpacing)
  ) {
    return { available: false, reason: CALIBRATION_UNAVAILABLE_MESSAGE }
  }
  const rowReference = first.rowPixelSpacing
  const columnReference = first.columnPixelSpacing
  const available = modules.every((module) =>
    module !== undefined &&
    module.usingDefaultValues !== true &&
    positiveFinite(module.rowPixelSpacing) &&
    positiveFinite(module.columnPixelSpacing) &&
    consistent(module.rowPixelSpacing, rowReference) &&
    consistent(module.columnPixelSpacing, columnReference),
  )
  return available
    ? { available: true, reason: null }
    : { available: false, reason: CALIBRATION_UNAVAILABLE_MESSAGE }
}
