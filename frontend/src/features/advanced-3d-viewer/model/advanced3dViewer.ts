export type Advanced3dMode = 'volume' | 'mip' | 'surface'
export type VolumePreset = 'CT-Bone' | 'CT-Soft-Tissue' | 'CT-Lung'
export type StandardViewDirection =
  | 'anterior'
  | 'posterior'
  | 'left'
  | 'right'
  | 'superior'
  | 'inferior'

export type Advanced3dSeriesStatus = 'idle' | 'loading' | 'success' | 'error'
export type Advanced3dErrorKind =
  | 'notFound'
  | 'notViewable'
  | 'geometry'
  | 'service'
  | 'validation'
  | 'persistence'
  | 'unknown'

export const MAX_SURFACE_SAMPLE_POINTS = 4_000_000

export const DEFAULT_ADVANCED_3D_STATE = {
  direction: 'anterior',
  mode: 'volume',
  preset: 'CT-Bone',
} as const satisfies {
  direction: StandardViewDirection
  mode: Advanced3dMode
  preset: VolumePreset
}

export function defaultSurfaceThreshold(
  [minimum, maximum]: readonly [number, number],
): number {
  return minimum <= 300 && maximum >= 300
    ? 300
    : (minimum + maximum) / 2
}

export function clampSurfaceThreshold(
  value: number,
  [minimum, maximum]: readonly [number, number],
): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('Surface threshold must be finite')
  }
  return Math.min(maximum, Math.max(minimum, value))
}

export function sampledDimensions(
  dimensions: readonly number[],
  stride: number,
): [number, number, number] {
  return dimensions.map(
    (size) => Math.floor((size - 1) / stride) + 1,
  ) as [number, number, number]
}

export function surfaceSampleStride(
  dimensions: readonly number[],
  limit = MAX_SURFACE_SAMPLE_POINTS,
): number {
  let stride = 1
  while (
    sampledDimensions(dimensions, stride)
      .reduce((count, size) => count * size, 1) > limit
  ) {
    stride += 1
  }
  return stride
}

export function volumeDiagonalMm(
  dimensions: readonly number[],
  spacing: readonly number[],
): number {
  const extents = dimensions.map(
    (size, index) => Math.max(0, size - 1) * spacing[index],
  )
  return Math.hypot(...extents)
}
