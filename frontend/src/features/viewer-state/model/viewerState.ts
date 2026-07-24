export const VIEWER_STATE_SCHEMA_VERSION = 1 as const
export const VIEWER_STATE_MAX_ANNOTATIONS = 500
export const VIEWER_STATE_MAX_BYTES = 2 * 1024 * 1024

export type Point2 = [number, number]
export type Point3 = [number, number, number]
export type ViewerViewport = 'axial' | 'coronal' | 'sagittal'
export type PersistedToolName = 'Length' | 'Angle' | 'RectangleROI' | 'ArrowAnnotate'
export type AxialViewerTool =
  | 'windowLevel'
  | 'pan'
  | 'zoom'
  | 'length'
  | 'angle'
  | 'rectangleRoi'
  | 'arrowAnnotate'
  | 'eraseAnnotation'
export type MprViewerTool = AxialViewerTool | 'crosshairs'

export interface ViewPresentationState {
  zoom?: number | null
  pan?: Point2 | null
  rotation?: number | null
  flip_horizontal?: boolean | null
  flip_vertical?: boolean | null
}

export interface VoiState {
  lower: number
  upper: number
  invert: boolean
}

export interface ViewportDisplayState {
  presentation: ViewPresentationState | null
  voi: VoiState | null
}

export interface AxialViewerState extends ViewportDisplayState {
  image_index: number
  active_tool: AxialViewerTool
}

export interface MprViewerState {
  active_viewport: ViewerViewport
  active_tool: MprViewerTool
  crosshairs_visible: boolean
  crosshairs_position: Point3
  viewports: Record<ViewerViewport, ViewportDisplayState>
}

export interface WorldBoundingBox {
  top_left: Point3
  top_right: Point3
  bottom_left: Point3
  bottom_right: Point3
}

export interface AnnotationTextBox {
  has_moved: boolean
  world_position: Point3
  world_bounding_box: WorldBoundingBox
}

export interface PersistedViewerAnnotation {
  viewport: ViewerViewport
  tool_name: PersistedToolName
  referenced_image_id: string
  points: Point3[]
  label: string | null
  text_box: AnnotationTextBox | null
}

export interface ViewerStatePayload {
  axial: AxialViewerState | null
  mpr: MprViewerState | null
  annotations: PersistedViewerAnnotation[]
}

export interface ViewerStateRead {
  series_id: string
  schema_version: typeof VIEWER_STATE_SCHEMA_VERSION
  state: ViewerStatePayload
  created_at: string
  updated_at: string
}

export class ViewerStateParseError extends Error {
  constructor() {
    super('查看器状态无效')
    this.name = 'ViewerStateParseError'
  }
}

type JsonRecord = Record<string, unknown>

const VIEWPORTS = new Set<ViewerViewport>(['axial', 'coronal', 'sagittal'])
const AXIAL_TOOLS = new Set<AxialViewerTool>([
  'windowLevel',
  'pan',
  'zoom',
  'length',
  'angle',
  'rectangleRoi',
  'arrowAnnotate',
  'eraseAnnotation',
])
const MPR_TOOLS = new Set<MprViewerTool>([...AXIAL_TOOLS, 'crosshairs'])
const TOOL_POINTS: Record<PersistedToolName, number> = {
  Length: 2,
  Angle: 3,
  RectangleROI: 4,
  ArrowAnnotate: 2,
}
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

function invalid(): never {
  throw new ViewerStateParseError()
}

function record(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  return value as JsonRecord
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): void {
  const allowedSet = new Set(allowed)
  if (
    Object.keys(value).some((key) => !allowedSet.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    invalid()
  }
}

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalid()
  }
  return value
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    return invalid()
  }
  return value
}

function string(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid()
  }
  return value
}

function point(value: unknown, length: 2): Point2
function point(value: unknown, length: 3): Point3
function point(value: unknown, length: 2 | 3): Point2 | Point3 {
  if (!Array.isArray(value) || value.length !== length) {
    return invalid()
  }
  const parsed = value.map(finite)
  return parsed as Point2 | Point3
}

function nullableFinite(value: unknown): number | null {
  return value === null ? null : finite(value)
}

function parsePresentation(value: unknown): ViewPresentationState | null {
  if (value === null) {
    return null
  }
  const input = record(value)
  const keys = ['zoom', 'pan', 'rotation', 'flip_horizontal', 'flip_vertical'] as const
  exactKeys(input, keys, [])
  const result: ViewPresentationState = {}
  if (Object.hasOwn(input, 'zoom')) {
    result.zoom = nullableFinite(input.zoom)
    if (result.zoom !== null && result.zoom <= 0) {
      invalid()
    }
  }
  if (Object.hasOwn(input, 'pan')) {
    result.pan = input.pan === null ? null : point(input.pan, 2)
  }
  if (Object.hasOwn(input, 'rotation')) {
    result.rotation = nullableFinite(input.rotation)
  }
  if (Object.hasOwn(input, 'flip_horizontal')) {
    result.flip_horizontal = input.flip_horizontal === null
      ? null
      : boolean(input.flip_horizontal)
  }
  if (Object.hasOwn(input, 'flip_vertical')) {
    result.flip_vertical = input.flip_vertical === null
      ? null
      : boolean(input.flip_vertical)
  }
  return result
}

function parseVoi(value: unknown): VoiState | null {
  if (value === null) {
    return null
  }
  const input = record(value)
  exactKeys(input, ['lower', 'upper', 'invert'])
  const lower = finite(input.lower)
  const upper = finite(input.upper)
  if (lower >= upper) {
    invalid()
  }
  return { lower, upper, invert: boolean(input.invert) }
}

function parseDisplayState(value: unknown): ViewportDisplayState {
  const input = record(value)
  exactKeys(input, ['presentation', 'voi'])
  return {
    presentation: parsePresentation(input.presentation),
    voi: parseVoi(input.voi),
  }
}

function parseAxial(value: unknown): AxialViewerState | null {
  if (value === null) {
    return null
  }
  const input = record(value)
  exactKeys(input, ['image_index', 'active_tool', 'presentation', 'voi'])
  if (
    !Number.isInteger(input.image_index) ||
    (input.image_index as number) < 0 ||
    typeof input.active_tool !== 'string' ||
    !AXIAL_TOOLS.has(input.active_tool as AxialViewerTool)
  ) {
    invalid()
  }
  return {
    image_index: input.image_index as number,
    active_tool: input.active_tool as AxialViewerTool,
    presentation: parsePresentation(input.presentation),
    voi: parseVoi(input.voi),
  }
}

function parseViewport(value: unknown): ViewerViewport {
  if (typeof value !== 'string' || !VIEWPORTS.has(value as ViewerViewport)) {
    return invalid()
  }
  return value as ViewerViewport
}

function parseMpr(value: unknown): MprViewerState | null {
  if (value === null) {
    return null
  }
  const input = record(value)
  exactKeys(input, [
    'active_viewport',
    'active_tool',
    'crosshairs_visible',
    'crosshairs_position',
    'viewports',
  ])
  if (
    typeof input.active_tool !== 'string' ||
    !MPR_TOOLS.has(input.active_tool as MprViewerTool)
  ) {
    invalid()
  }
  const viewports = record(input.viewports)
  exactKeys(viewports, ['axial', 'coronal', 'sagittal'])
  return {
    active_viewport: parseViewport(input.active_viewport),
    active_tool: input.active_tool as MprViewerTool,
    crosshairs_visible: boolean(input.crosshairs_visible),
    crosshairs_position: point(input.crosshairs_position, 3),
    viewports: {
      axial: parseDisplayState(viewports.axial),
      coronal: parseDisplayState(viewports.coronal),
      sagittal: parseDisplayState(viewports.sagittal),
    },
  }
}

function parseBoundingBox(value: unknown): WorldBoundingBox {
  const input = record(value)
  exactKeys(input, ['top_left', 'top_right', 'bottom_left', 'bottom_right'])
  return {
    top_left: point(input.top_left, 3),
    top_right: point(input.top_right, 3),
    bottom_left: point(input.bottom_left, 3),
    bottom_right: point(input.bottom_right, 3),
  }
}

function parseTextBox(value: unknown): AnnotationTextBox | null {
  if (value === null) {
    return null
  }
  const input = record(value)
  exactKeys(input, ['has_moved', 'world_position', 'world_bounding_box'])
  return {
    has_moved: boolean(input.has_moved),
    world_position: point(input.world_position, 3),
    world_bounding_box: parseBoundingBox(input.world_bounding_box),
  }
}

function parseAnnotation(value: unknown): PersistedViewerAnnotation {
  const input = record(value)
  exactKeys(input, [
    'viewport',
    'tool_name',
    'referenced_image_id',
    'points',
    'label',
    'text_box',
  ])
  if (
    typeof input.tool_name !== 'string' ||
    !Object.hasOwn(TOOL_POINTS, input.tool_name)
  ) {
    invalid()
  }
  const toolName = input.tool_name as PersistedToolName
  const referencedImageId = string(input.referenced_image_id)
  if (
    referencedImageId.length < 1 ||
    referencedImageId.length > 2_048 ||
    CONTROL_CHARACTER_PATTERN.test(referencedImageId)
  ) {
    invalid()
  }
  if (!Array.isArray(input.points) || input.points.length !== TOOL_POINTS[toolName]) {
    invalid()
  }
  let label: string | null = null
  if (toolName === 'ArrowAnnotate') {
    label = string(input.label).trim()
    if (
      label.length < 1 ||
      label.length > 200 ||
      CONTROL_CHARACTER_PATTERN.test(label)
    ) {
      invalid()
    }
  } else if (input.label !== null) {
    invalid()
  }
  return {
    viewport: parseViewport(input.viewport),
    tool_name: toolName,
    referenced_image_id: referencedImageId,
    points: input.points.map((item) => point(item, 3)),
    label,
    text_box: parseTextBox(input.text_box),
  }
}

function assertSerializedSize(value: unknown): void {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return invalid()
  }
  if (new TextEncoder().encode(serialized).byteLength > VIEWER_STATE_MAX_BYTES) {
    invalid()
  }
}

export function parseViewerStatePayload(value: unknown): ViewerStatePayload {
  assertSerializedSize(value)
  const input = record(value)
  exactKeys(input, ['axial', 'mpr', 'annotations'])
  if (
    !Array.isArray(input.annotations) ||
    input.annotations.length > VIEWER_STATE_MAX_ANNOTATIONS
  ) {
    invalid()
  }
  return {
    axial: parseAxial(input.axial),
    mpr: parseMpr(input.mpr),
    annotations: input.annotations.map(parseAnnotation),
  }
}

export function parseViewerStateRead(value: unknown): ViewerStateRead | null {
  if (value === null) {
    return null
  }
  const input = record(value)
  exactKeys(input, [
    'series_id',
    'schema_version',
    'state',
    'created_at',
    'updated_at',
  ])
  if (input.schema_version !== VIEWER_STATE_SCHEMA_VERSION) {
    invalid()
  }
  const createdAt = string(input.created_at)
  const updatedAt = string(input.updated_at)
  if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) {
    invalid()
  }
  return {
    series_id: string(input.series_id),
    schema_version: VIEWER_STATE_SCHEMA_VERSION,
    state: parseViewerStatePayload(input.state),
    created_at: createdAt,
    updated_at: updatedAt,
  }
}
