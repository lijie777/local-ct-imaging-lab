import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray'
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData'
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes'
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor'
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper'

import {
  sampledDimensions,
  surfaceSampleStride,
} from '../model/advanced3dViewer'

interface SurfaceInput {
  dimensions: readonly number[]
  direction: readonly number[]
  origin: readonly number[]
  scalarData: ArrayLike<number>
  spacing: readonly number[]
}

export interface PreparedSurfaceInput {
  imageData: ReturnType<typeof vtkImageData.newInstance>
  sampledDimensions: [number, number, number]
  sampledScalarData: Float32Array
  sampledSpacing: [number, number, number]
  scalarRange: readonly [number, number]
  scalars: ReturnType<typeof vtkDataArray.newInstance>
  stride: number
  userMatrix: Float32Array
  destroy(): void
}

export type SurfaceActorResult =
  | {
    kind: 'empty'
    stride: number
    thresholdHu: number
  }
  | {
    actor: ReturnType<typeof vtkActor.newInstance>
    destroy(): void
    kind: 'ready'
    stride: number
    thresholdHu: number
  }

function safeDelete(resource: { delete(): void } | null): void {
  if (resource === null) {
    return
  }
  try {
    resource.delete()
  } catch {
    // Continue releasing the rest of the independently owned pipeline.
  }
}

export function directionUserMatrix(
  direction: readonly number[],
  origin: readonly number[],
): Float32Array {
  return new Float32Array([
    direction[0], direction[1], direction[2], 0,
    direction[3], direction[4], direction[5], 0,
    direction[6], direction[7], direction[8], 0,
    origin[0], origin[1], origin[2], 1,
  ])
}

export function prepareSurfaceInput(input: SurfaceInput): PreparedSurfaceInput {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let index = 0; index < input.scalarData.length; index += 1) {
    const value = input.scalarData[index]
    if (!Number.isFinite(value)) {
      throw new Error('Surface scalar data contains non-finite values')
    }
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new Error('Surface scalar data has no finite values')
  }

  const stride = surfaceSampleStride(input.dimensions)
  const outputDimensions = sampledDimensions(input.dimensions, stride)
  const outputSpacing = input.spacing.map((value, axis) => {
    const outputSize = outputDimensions[axis]
    return outputSize <= 1
      ? value
      : ((input.dimensions[axis] - 1) * value) / (outputSize - 1)
  }) as [number, number, number]
  const sampledScalarData = new Float32Array(
    outputDimensions[0] * outputDimensions[1] * outputDimensions[2],
  )
  const [sourceWidth, sourceHeight] = input.dimensions
  function sourceCoordinate(
    outputIndex: number,
    sourceSize: number,
    outputSize: number,
  ): number {
    return outputSize <= 1
      ? 0
      : Math.round(outputIndex * (sourceSize - 1) / (outputSize - 1))
  }
  let targetIndex = 0
  for (let z = 0; z < outputDimensions[2]; z += 1) {
    const sourceZ = sourceCoordinate(z, input.dimensions[2], outputDimensions[2])
    for (let y = 0; y < outputDimensions[1]; y += 1) {
      const sourceY = sourceCoordinate(y, input.dimensions[1], outputDimensions[1])
      for (let x = 0; x < outputDimensions[0]; x += 1) {
        const sourceX = sourceCoordinate(x, input.dimensions[0], outputDimensions[0])
        const sourceIndex = sourceX +
          sourceY * sourceWidth +
          sourceZ * sourceWidth * sourceHeight
        sampledScalarData[targetIndex] = input.scalarData[sourceIndex]
        targetIndex += 1
      }
    }
  }

  const imageData = vtkImageData.newInstance()
  let scalars: ReturnType<typeof vtkDataArray.newInstance> | null = null
  try {
    imageData.setDimensions(outputDimensions)
    imageData.setSpacing(outputSpacing)
    imageData.setOrigin([0, 0, 0])
    imageData.setDirection([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ])
    scalars = vtkDataArray.newInstance({
      name: 'SurfaceScalars',
      numberOfComponents: 1,
      values: sampledScalarData,
    })
    imageData.getPointData().setScalars(scalars)
  } catch (error) {
    safeDelete(scalars)
    safeDelete(imageData)
    throw error
  }

  let destroyed = false
  const ownedScalars = scalars
  return {
    destroy: () => {
      if (destroyed) {
        return
      }
      destroyed = true
      safeDelete(imageData)
      safeDelete(ownedScalars)
    },
    imageData,
    sampledDimensions: outputDimensions,
    sampledScalarData,
    sampledSpacing: outputSpacing,
    scalarRange: [minimum, maximum],
    scalars: ownedScalars,
    stride,
    userMatrix: directionUserMatrix(input.direction, input.origin),
  }
}

export function createSurfaceActor(
  prepared: PreparedSurfaceInput,
  threshold: number,
): SurfaceActorResult {
  let filter: ReturnType<typeof vtkImageMarchingCubes.newInstance> | null = null
  let mapper: ReturnType<typeof vtkMapper.newInstance> | null = null
  let actor: ReturnType<typeof vtkActor.newInstance> | null = null

  try {
    filter = vtkImageMarchingCubes.newInstance()
    filter.setComputeNormals(true)
    filter.setMergePoints(true)
    filter.setContourValue(threshold)
    filter.setInputData(prepared.imageData)
    filter.update()

    const output = filter.getOutputData()
    if (output.getNumberOfCells() === 0 || output.getNumberOfPoints() === 0) {
      safeDelete(filter)
      prepared.destroy()
      return {
        kind: 'empty',
        stride: prepared.stride,
        thresholdHu: threshold,
      }
    }

    mapper = vtkMapper.newInstance()
    mapper.setInputConnection(filter.getOutputPort())
    actor = vtkActor.newInstance()
    actor.setMapper(mapper)
    actor.setUserMatrix(prepared.userMatrix)
    actor.getProperty().setColor(0.93, 0.86, 0.72)
    actor.getProperty().setOpacity(1)
  } catch (error) {
    safeDelete(actor)
    safeDelete(mapper)
    safeDelete(filter)
    prepared.destroy()
    throw error
  }

  let destroyed = false
  const ownedActor = actor
  const ownedFilter = filter
  const ownedMapper = mapper
  return {
    actor: ownedActor,
    destroy: () => {
      if (destroyed) {
        return
      }
      destroyed = true
      safeDelete(ownedActor)
      safeDelete(ownedMapper)
      safeDelete(ownedFilter)
      prepared.destroy()
    },
    kind: 'ready',
    stride: prepared.stride,
    thresholdHu: threshold,
  }
}
