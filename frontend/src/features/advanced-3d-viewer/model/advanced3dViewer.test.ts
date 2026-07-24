import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ADVANCED_3D_STATE,
  MAX_SURFACE_SAMPLE_POINTS,
  clampSurfaceThreshold,
  defaultSurfaceThreshold,
  sampledDimensions,
  surfaceSampleStride,
  volumeDiagonalMm,
} from './advanced3dViewer'


describe('advanced 3D viewer model', () => {
  it('defines the safe default session state', () => {
    expect(DEFAULT_ADVANCED_3D_STATE).toEqual({
      direction: 'anterior',
      mode: 'volume',
      preset: 'CT-Bone',
    })
  })

  it('uses 300 HU when available and the midpoint otherwise', () => {
    expect(defaultSurfaceThreshold([-1024, 3071])).toBe(300)
    expect(defaultSurfaceThreshold([500, 900])).toBe(700)
  })

  it('clamps finite thresholds to the actual scalar range', () => {
    expect(clampSurfaceThreshold(4000, [-1024, 3071])).toBe(3071)
    expect(clampSurfaceThreshold(-2000, [-1024, 3071])).toBe(-1024)
    expect(clampSurfaceThreshold(250, [-1024, 3071])).toBe(250)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite surface threshold at the model boundary',
    (threshold) => {
      expect(() => clampSurfaceThreshold(threshold, [-1024, 3071]))
        .toThrow(RangeError)
    },
  )

  it('derives a uniform stride and sampled dimensions under the point cap', () => {
    expect(MAX_SURFACE_SAMPLE_POINTS).toBe(4_000_000)
    expect(surfaceSampleStride([512, 512, 300])).toBe(3)
    expect(sampledDimensions([512, 512, 300], 3)).toEqual([171, 171, 100])
    expect(171 * 171 * 100).toBeLessThanOrEqual(MAX_SURFACE_SAMPLE_POINTS)
  })

  it('keeps small inputs at full resolution', () => {
    expect(surfaceSampleStride([100, 100, 100])).toBe(1)
    expect(sampledDimensions([100, 100, 100], 1)).toEqual([100, 100, 100])
  })

  it('calculates the physical volume diagonal from voxel-center extents', () => {
    expect(volumeDiagonalMm([100, 120, 80], [0.7, 0.7, 1.5]))
      .toBeCloseTo(Math.hypot(69.3, 83.3, 118.5))
  })
})
