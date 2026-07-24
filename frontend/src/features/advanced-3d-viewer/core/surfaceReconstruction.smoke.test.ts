import { expect, it } from 'vitest'

import {
  createSurfaceActor,
  prepareSurfaceInput,
} from './surfaceReconstruction'


it('creates and destroys a non-empty surface with the real vtk pipeline', () => {
  const dimensions = [5, 5, 5] as const
  const scalarData = new Float32Array(
    dimensions[0] * dimensions[1] * dimensions[2],
  )
  let index = 0
  for (let z = 0; z < dimensions[2]; z += 1) {
    for (let y = 0; y < dimensions[1]; y += 1) {
      for (let x = 0; x < dimensions[0]; x += 1) {
        const distanceSquared = (x - 2) ** 2 + (y - 2) ** 2 + (z - 2) ** 2
        scalarData[index] = 4 - distanceSquared
        index += 1
      }
    }
  }

  const prepared = prepareSurfaceInput({
    dimensions,
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    origin: [0, 0, 0],
    scalarData,
    spacing: [1, 1, 1],
  })
  const result = createSurfaceActor(prepared, 0)

  expect(result.kind).toBe('ready')
  if (result.kind !== 'ready') {
    throw new Error('Expected real vtk marching cubes to create a surface')
  }
  const mapper = result.actor.getMapper()
  if (mapper === null) {
    throw new Error('Expected the real vtk actor to retain its mapper')
  }
  const output = mapper.getInputData()
  if (output === null) {
    throw new Error('Expected the real vtk mapper to expose surface output')
  }
  expect(output.getNumberOfPoints()).toBeGreaterThan(0)
  expect(output.getNumberOfCells()).toBeGreaterThan(0)

  expect(() => {
    result.destroy()
    result.destroy()
  }).not.toThrow()
})
