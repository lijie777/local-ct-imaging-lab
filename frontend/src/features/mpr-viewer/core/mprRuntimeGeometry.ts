import type { Point3 } from '../model/mprViewer'

export interface VoiRange {
  lower: number
  upper: number
}

function point3(value: unknown): Point3 | null {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((component) => typeof component === 'number' && Number.isFinite(component))
  ) {
    return null
  }
  return [value[0], value[1], value[2]]
}

function dot(left: Point3, right: Point3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: Point3, right: Point3): Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

export function intersectCameraPlanes(cameras: Array<{
  focalPoint?: unknown
  viewPlaneNormal?: unknown
}>): Point3 | null {
  if (cameras.length !== 3) {
    return null
  }
  const planes = cameras.map((camera) => ({
    normal: point3(camera.viewPlaneNormal),
    point: point3(camera.focalPoint),
  }))
  if (planes.some(({ normal, point }) => normal === null || point === null)) {
    return null
  }
  const [first, second, third] = planes as Array<{
    normal: Point3
    point: Point3
  }>
  const secondCrossThird = cross(second.normal, third.normal)
  const denominator = dot(first.normal, secondCrossThird)
  if (Math.abs(denominator) < 1e-8) {
    return null
  }
  const thirdCrossFirst = cross(third.normal, first.normal)
  const firstCrossSecond = cross(first.normal, second.normal)
  const distances = planes.map(({ normal, point }) => dot(normal!, point!))
  const coordinate = (component: 0 | 1 | 2) => {
    const value = (
      distances[0] * secondCrossThird[component] +
      distances[1] * thirdCrossFirst[component] +
      distances[2] * firstCrossSecond[component]
    ) / denominator
    return Object.is(value, -0) ? 0 : value
  }
  const intersection: Point3 = [coordinate(0), coordinate(1), coordinate(2)]
  return intersection.every(Number.isFinite) ? intersection : null
}

export function voiRange(value: unknown): VoiRange | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('lower' in value) ||
    !('upper' in value) ||
    typeof value.lower !== 'number' ||
    typeof value.upper !== 'number' ||
    !Number.isFinite(value.lower) ||
    !Number.isFinite(value.upper)
  ) {
    return null
  }
  return { lower: value.lower, upper: value.upper }
}
