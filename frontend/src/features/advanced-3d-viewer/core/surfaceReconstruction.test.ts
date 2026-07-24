import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const pointData = { setScalars: vi.fn() }
  const imageData = {
    delete: vi.fn(),
    getPointData: vi.fn(() => pointData),
    setDimensions: vi.fn(),
    setDirection: vi.fn(),
    setOrigin: vi.fn(),
    setSpacing: vi.fn(),
  }
  const scalars = { delete: vi.fn() }
  const output = {
    getNumberOfCells: vi.fn(() => 1),
    getNumberOfPoints: vi.fn(() => 3),
  }
  const filter = {
    delete: vi.fn(),
    getOutputData: vi.fn(() => output),
    getOutputPort: vi.fn(() => 'surface-output-port'),
    setComputeNormals: vi.fn(),
    setContourValue: vi.fn(),
    setInputData: vi.fn(),
    setMergePoints: vi.fn(),
    update: vi.fn(),
  }
  const mapper = {
    delete: vi.fn(),
    setInputConnection: vi.fn(),
  }
  const property = {
    setColor: vi.fn(),
    setOpacity: vi.fn(),
  }
  const actor = {
    delete: vi.fn(),
    getProperty: vi.fn(() => property),
    setMapper: vi.fn(),
    setUserMatrix: vi.fn(),
  }

  return {
    actor,
    dataArrayNewInstance: vi.fn(() => scalars),
    filter,
    imageData,
    imageDataNewInstance: vi.fn(() => imageData),
    mapper,
    mapperNewInstance: vi.fn(() => mapper),
    output,
    pointData,
    property,
    scalars,
    actorNewInstance: vi.fn(() => actor),
    filterNewInstance: vi.fn(() => filter),
  }
})

vi.mock('@kitware/vtk.js/Common/DataModel/ImageData', () => ({
  default: { newInstance: mocks.imageDataNewInstance },
}))

vi.mock('@kitware/vtk.js/Common/Core/DataArray', () => ({
  default: { newInstance: mocks.dataArrayNewInstance },
}))

vi.mock('@kitware/vtk.js/Filters/General/ImageMarchingCubes', () => ({
  default: { newInstance: mocks.filterNewInstance },
}))

vi.mock('@kitware/vtk.js/Rendering/Core/Mapper', () => ({
  default: { newInstance: mocks.mapperNewInstance },
}))

vi.mock('@kitware/vtk.js/Rendering/Core/Actor', () => ({
  default: { newInstance: mocks.actorNewInstance },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.output.getNumberOfCells.mockReturnValue(1)
  mocks.output.getNumberOfPoints.mockReturnValue(3)
})

describe('surface reconstruction input', () => {
  it('samples finite x-fastest source data without modifying it', async () => {
    const { prepareSurfaceInput } = await import('./surfaceReconstruction')
    const source = new Float64Array(16).map((_, index) => index)
    const original = source.slice()

    const prepared = prepareSurfaceInput({
      dimensions: [4, 2, 2],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      origin: [10, 20, 30],
      scalarData: source,
      spacing: [0.5, 1, 2],
    })

    expect(prepared.stride).toBe(1)
    expect(prepared.sampledDimensions).toEqual([4, 2, 2])
    expect(prepared.sampledSpacing).toEqual([0.5, 1, 2])
    expect(prepared.scalarRange).toEqual([0, 15])
    expect(prepared.sampledScalarData).toBeInstanceOf(Float32Array)
    expect(Array.from(prepared.sampledScalarData)).toEqual(Array.from(source))
    expect(source).toEqual(original)
    expect(mocks.dataArrayNewInstance).toHaveBeenCalledWith({
      name: 'SurfaceScalars',
      numberOfComponents: 1,
      values: prepared.sampledScalarData,
    })
    expect(mocks.imageData.setDimensions).toHaveBeenCalledWith([4, 2, 2])
    expect(mocks.imageData.setSpacing).toHaveBeenCalledWith([0.5, 1, 2])
    expect(mocks.imageData.setOrigin).toHaveBeenCalledWith([0, 0, 0])
    expect(mocks.imageData.setDirection).toHaveBeenCalledWith([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ])
    expect(mocks.pointData.setScalars).toHaveBeenCalledWith(mocks.scalars)
  })

  it('uses one stride until sampled dimensions are at most four million points', async () => {
    const { prepareSurfaceInput } = await import('./surfaceReconstruction')
    const dimensions = [400, 400, 26] as const
    const source = new Int16Array(dimensions[0] * dimensions[1] * dimensions[2])
    source[0] = -1000
    source[201] = 1234
    source[source.length - 1] = 2000

    const prepared = prepareSurfaceInput({
      dimensions,
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      origin: [0, 0, 0],
      scalarData: source,
      spacing: [0.7, 0.8, 1.5],
    })

    expect(prepared.stride).toBe(2)
    expect(prepared.sampledDimensions).toEqual([200, 200, 13])
    expect(prepared.sampledDimensions.reduce((total, size) => total * size, 1))
      .toBeLessThanOrEqual(4_000_000)
    prepared.sampledSpacing.forEach((sampledSpacing, axis) => {
      expect(sampledSpacing * (prepared.sampledDimensions[axis] - 1)).toBeCloseTo(
        (dimensions[axis] - 1) * [0.7, 0.8, 1.5][axis],
      )
    })
    expect(prepared.scalarRange).toEqual([-1000, 2000])
    expect(prepared.sampledScalarData).toHaveLength(200 * 200 * 13)
    expect(prepared.sampledScalarData[0]).toBe(-1000)
    expect(prepared.sampledScalarData[100]).toBe(1234)
    expect(prepared.sampledScalarData.at(-1)).toBe(2000)
  })

  it('builds the documented column-major direction and origin user matrix', async () => {
    const { prepareSurfaceInput } = await import('./surfaceReconstruction')

    const prepared = prepareSurfaceInput({
      dimensions: [3, 3, 3],
      direction: [0, 1, 0, 1, 0, 0, 0, 0, -1],
      origin: [10, 20, 30],
      scalarData: new Int16Array(27).map((_, index) => index),
      spacing: [1, 2, 3],
    })

    expect(Array.from(prepared.userMatrix)).toEqual([
      0, 1, 0, 0,
      1, 0, 0, 0,
      0, 0, -1, 0,
      10, 20, 30, 1,
    ])
  })

  it.each([
    new Float32Array([Number.NaN, 1]),
    new Float32Array([Number.POSITIVE_INFINITY, 1]),
    new Float32Array([Number.NEGATIVE_INFINITY, 1]),
  ])('throws before allocating vtk resources when any scalar is non-finite', async (scalarData) => {
    const { prepareSurfaceInput } = await import('./surfaceReconstruction')

    expect(() => prepareSurfaceInput({
      dimensions: [2, 1, 1],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      origin: [0, 0, 0],
      scalarData,
      spacing: [1, 1, 1],
    })).toThrow('Surface scalar data contains non-finite values')
    expect(mocks.imageDataNewInstance).not.toHaveBeenCalled()
  })
})

describe('surface actor', () => {
  it('destroys prepared input when the marching-cubes constructor throws', async () => {
    const { createSurfaceActor, prepareSurfaceInput } = await import('./surfaceReconstruction')
    const prepared = prepareSurfaceInput({
      dimensions: [2, 2, 2],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      origin: [0, 0, 0],
      scalarData: new Int16Array(8),
      spacing: [1, 1, 1],
    })
    mocks.filterNewInstance.mockImplementationOnce(() => {
      throw new Error('filter allocation failed')
    })

    expect(() => createSurfaceActor(prepared, 300)).toThrow('filter allocation failed')
    expect(mocks.imageData.delete).toHaveBeenCalledOnce()
    expect(mocks.scalars.delete).toHaveBeenCalledOnce()
    expect(mocks.mapperNewInstance).not.toHaveBeenCalled()
    expect(mocks.actorNewInstance).not.toHaveBeenCalled()
  })

  it('configures marching cubes, physical transform, and material then destroys every owned resource once', async () => {
    const { createSurfaceActor, prepareSurfaceInput } = await import('./surfaceReconstruction')
    const prepared = prepareSurfaceInput({
      dimensions: [3, 3, 3],
      direction: [0, 1, 0, 1, 0, 0, 0, 0, -1],
      origin: [10, 20, 30],
      scalarData: new Int16Array(27).map((_, index) => index),
      spacing: [1, 2, 3],
    })

    const result = createSurfaceActor(prepared, 12)

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') {
      throw new Error('Expected a ready surface')
    }
    expect(result.actor).toBe(mocks.actor)
    expect(result.thresholdHu).toBe(12)
    expect(result.stride).toBe(1)
    expect(mocks.filter.setComputeNormals).toHaveBeenCalledWith(true)
    expect(mocks.filter.setMergePoints).toHaveBeenCalledWith(true)
    expect(mocks.filter.setContourValue).toHaveBeenCalledWith(12)
    expect(mocks.filter.setInputData).toHaveBeenCalledWith(mocks.imageData)
    expect(mocks.filter.update).toHaveBeenCalledOnce()
    expect(mocks.mapper.setInputConnection).toHaveBeenCalledWith('surface-output-port')
    expect(mocks.actor.setMapper).toHaveBeenCalledWith(mocks.mapper)
    expect(mocks.actor.setUserMatrix).toHaveBeenCalledWith(prepared.userMatrix)
    expect(mocks.property.setColor).toHaveBeenCalledWith(0.93, 0.86, 0.72)
    expect(mocks.property.setOpacity).toHaveBeenCalledWith(1)

    result.destroy()
    result.destroy()

    expect(mocks.actor.delete).toHaveBeenCalledOnce()
    expect(mocks.mapper.delete).toHaveBeenCalledOnce()
    expect(mocks.filter.delete).toHaveBeenCalledOnce()
    expect(mocks.imageData.delete).toHaveBeenCalledOnce()
    expect(mocks.scalars.delete).toHaveBeenCalledOnce()
  })

  it.each([
    ['cells', 0, 3],
    ['points', 1, 0],
  ])('returns empty and releases the new pipeline for zero %s', async (
    _label,
    cells,
    points,
  ) => {
    mocks.output.getNumberOfCells.mockReturnValue(cells)
    mocks.output.getNumberOfPoints.mockReturnValue(points)
    const { createSurfaceActor, prepareSurfaceInput } = await import('./surfaceReconstruction')
    const prepared = prepareSurfaceInput({
      dimensions: [2, 2, 2],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      origin: [0, 0, 0],
      scalarData: new Int16Array(8),
      spacing: [1, 1, 1],
    })

    expect(createSurfaceActor(prepared, 300)).toEqual({
      kind: 'empty',
      stride: 1,
      thresholdHu: 300,
    })
    expect(mocks.filter.delete).toHaveBeenCalledOnce()
    expect(mocks.imageData.delete).toHaveBeenCalledOnce()
    expect(mocks.scalars.delete).toHaveBeenCalledOnce()
    expect(mocks.mapperNewInstance).not.toHaveBeenCalled()
    expect(mocks.actorNewInstance).not.toHaveBeenCalled()
  })
})
