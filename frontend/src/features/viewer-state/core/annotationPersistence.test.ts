import { describe, expect, it, vi } from 'vitest'

import {
  capturePersistedAnnotations,
  restorePersistedAnnotations,
} from './annotationPersistence'


function harness() {
  const axial = document.createElement('div')
  const coronal = document.createElement('div')
  const sagittal = document.createElement('div')
  const annotations = new Map<string, unknown[]>()
  const hydrated: Array<Record<string, any>> = []
  const viewports = {
    axial: {
      element: axial,
      getCamera: () => ({ viewPlaneNormal: [0, 0, 1], viewUp: [0, -1, 0] }),
    },
    coronal: {
      element: coronal,
      getCamera: () => ({ viewPlaneNormal: [0, 1, 0], viewUp: [0, 0, 1] }),
    },
    sagittal: {
      element: sagittal,
      getCamera: () => ({ viewPlaneNormal: [1, 0, 0], viewUp: [0, 0, 1] }),
    },
  }
  const tools = {
    annotation: {
      state: {
        getAnnotations: vi.fn((name: string, element: HTMLDivElement) => {
          const viewport = element === axial
            ? 'axial'
            : element === coronal ? 'coronal' : 'sagittal'
          return annotations.get(`${name}:${viewport}`) ?? []
        }),
      },
    },
    utilities: {
      annotationHydration: vi.fn((
        _viewport,
        toolName: string,
        points: number[][],
        metadata?: Record<string, unknown>,
      ) => {
        const value = {
          annotationUID: `generated-${hydrated.length}`,
          metadata: { toolName, privateImage: 'not persisted', ...metadata },
          data: { handles: { points }, cachedStats: { old: true } },
          invalidated: false,
        }
        hydrated.push(value)
        return value
      }),
      triggerAnnotationRender: vi.fn(),
    },
  }
  return { annotations, axial, coronal, hydrated, sagittal, tools, viewports }
}

describe('annotation persistence adapter', () => {
  it('captures only four allowlisted tools and strips runtime/internal fields', () => {
    const value = harness()
    value.annotations.set('Length:axial', [{
      annotationUID: 'length-1',
      metadata: {
        toolName: 'Length',
        referencedImageId: 'image-axial',
        viewPlaneNormal: [0, 0, 1],
        viewUp: [0, -1, 0],
      },
      highlighted: true,
      data: {
        cachedStats: { target: { length: 4 } },
        handles: {
          points: [[0, 0, 0], [1, 1, 0]],
          textBox: {
            hasMoved: true,
            worldPosition: [1, 2, 3],
            worldBoundingBox: {
              topLeft: [0, 1, 0],
              topRight: [1, 1, 0],
              bottomLeft: [0, 0, 0],
              bottomRight: [1, 0, 0],
            },
          },
        },
      },
    }])
    value.annotations.set('ArrowAnnotate:coronal', [{
      annotationUID: 'arrow-1',
      metadata: {
        referencedImageId: 'image-coronal',
        viewPlaneNormal: [0, 1, 0],
        viewUp: [0, 0, 1],
      },
      data: {
        label: '  教学箭头  ',
        handles: { points: [[2, 2, 2], [3, 3, 3]] },
      },
    }])
    value.annotations.set('Crosshairs:axial', [{ annotationUID: 'crosshairs' }])

    const captured = capturePersistedAnnotations(
      value.tools as never,
      value.viewports,
      ['image-axial', 'image-coronal'],
    )

    expect(captured).toHaveLength(2)
    expect(captured[0]).toEqual({
      viewport: 'axial',
      tool_name: 'Length',
      referenced_image_id: 'image-axial',
      points: [[0, 0, 0], [1, 1, 0]],
      label: null,
      text_box: {
        has_moved: true,
        world_position: [1, 2, 3],
        world_bounding_box: {
          top_left: [0, 1, 0],
          top_right: [1, 1, 0],
          bottom_left: [0, 0, 0],
          bottom_right: [1, 0, 0],
        },
      },
    })
    expect(captured[1].label).toBe('教学箭头')
    expect(JSON.stringify(captured)).not.toContain('cachedStats')
    expect(JSON.stringify(captured)).not.toContain('annotationUID')
    expect(value.tools.annotation.state.getAnnotations).not.toHaveBeenCalledWith(
      'Crosshairs',
      expect.anything(),
    )
  })

  it('skips malformed annotations instead of leaking them into saved state', () => {
    const value = harness()
    value.annotations.set('Angle:axial', [{
      annotationUID: 'bad',
      data: { handles: { points: [[0, 0, 0], [1, 1, 1]] } },
    }])

    expect(capturePersistedAnnotations(
      value.tools as never,
      { axial: value.viewports.axial },
      ['image-axial'],
    )).toEqual([])
  })

  it('uses annotation orientation when MPR elements share one Frame of Reference', () => {
    const value = harness()
    const shared = [
      {
        annotationUID: 'axial-length',
        metadata: {
          referencedImageId: 'image-axial',
          viewPlaneNormal: [0, 0, 1],
          viewUp: [0, -1, 0],
        },
        data: { handles: { points: [[0, 0, 0], [1, 1, 0]] } },
      },
      {
        annotationUID: 'coronal-length',
        metadata: {
          referencedImageId: 'image-coronal',
          viewPlaneNormal: [0, 1, 0],
          viewUp: [0, 0, 1],
        },
        data: { handles: { points: [[2, 2, 2], [3, 3, 2]] } },
      },
      {
        annotationUID: 'sagittal-length',
        metadata: {
          referencedImageId: 'image-sagittal',
          viewPlaneNormal: [1, 0, 0],
          viewUp: [0, 0, 1],
        },
        data: { handles: { points: [[4, 4, 4], [5, 5, 4]] } },
      },
    ]
    for (const viewport of ['axial', 'coronal', 'sagittal']) {
      value.annotations.set(`Length:${viewport}`, shared)
    }

    const captured = capturePersistedAnnotations(
      value.tools as never,
      value.viewports,
      ['image-axial', 'image-coronal', 'image-sagittal'],
    )

    expect(captured.map((annotation) => annotation.viewport)).toEqual([
      'axial',
      'coronal',
      'sagittal',
    ])
  })

  it('uses a deterministic Series image anchor for volume annotations', () => {
    const value = harness()
    value.annotations.set('Length:coronal', [{
      annotationUID: 'coronal-volume-length',
      metadata: {
        volumeId: 'cornerstoneStreamingImageVolume:mpr-1',
        viewPlaneNormal: [0, 1, 0],
        viewUp: [0, 0, 1],
      },
      data: { handles: { points: [[0, 0, 0], [1, 0, 1]] } },
    }])

    expect(capturePersistedAnnotations(
      value.tools as never,
      value.viewports,
      ['image-first', 'image-last'],
    )).toEqual([
      expect.objectContaining({
        viewport: 'coronal',
        referenced_image_id: 'image-first',
      }),
    ])
  })

  it('returns an explicit over-limit snapshot instead of silently truncating to 500', () => {
    const value = harness()
    value.annotations.set('Length:axial', Array.from({ length: 501 }, (_, index) => ({
      annotationUID: `length-${index}`,
      metadata: {
        referencedImageId: 'image-axial',
        viewPlaneNormal: [0, 0, 1],
      },
      data: { handles: { points: [[0, 0, 0], [1, 1, 0]] } },
    })))

    expect(capturePersistedAnnotations(
      value.tools as never,
      { axial: value.viewports.axial },
      ['image-axial'],
    )).toHaveLength(501)
  })

  it('hydrates safe data, regenerates runtime metadata, and requests recomputation/render', () => {
    const value = harness()
    const axialViewport = { element: value.axial }
    const coronalViewport = { element: value.coronal }
    const annotations = [
      {
        viewport: 'axial' as const,
        tool_name: 'Length' as const,
        referenced_image_id: 'image-axial',
        points: [[0, 0, 0], [1, 1, 0]] as [number, number, number][],
        label: null,
        text_box: null,
      },
      {
        viewport: 'coronal' as const,
        tool_name: 'ArrowAnnotate' as const,
        referenced_image_id: 'image-coronal',
        points: [[2, 2, 2], [3, 3, 3]] as [number, number, number][],
        label: '教学箭头',
        text_box: null,
      },
    ]

    const result = restorePersistedAnnotations(
      value.tools as never,
      { axial: axialViewport, coronal: coronalViewport } as never,
      annotations,
      ['image-axial', 'image-coronal'],
    )

    expect(result).toEqual({ restored: 2, skipped: 0 })
    expect(value.tools.utilities.annotationHydration).toHaveBeenNthCalledWith(
      1,
      axialViewport,
      'Length',
      [[0, 0, 0], [1, 1, 0]],
    )
    expect(value.hydrated[0].invalidated).toBe(true)
    expect(value.hydrated[0].metadata.referencedImageId).toBe('image-axial')
    expect(value.hydrated[1].data.label).toBe('教学箭头')
    expect(value.tools.utilities.triggerAnnotationRender).toHaveBeenCalledWith(value.axial)
    expect(value.tools.utilities.triggerAnnotationRender).toHaveBeenCalledWith(value.coronal)
  })

  it('skips an annotation whose persisted image identity is no longer available', () => {
    const value = harness()
    const annotations = [
      {
        viewport: 'axial' as const,
        tool_name: 'Length' as const,
        referenced_image_id: 'missing-image',
        points: [[0, 0, 0], [1, 1, 0]] as [number, number, number][],
        label: null,
        text_box: null,
      },
      {
        viewport: 'axial' as const,
        tool_name: 'Length' as const,
        referenced_image_id: 'image-axial',
        points: [[2, 2, 0], [3, 3, 0]] as [number, number, number][],
        label: null,
        text_box: null,
      },
    ]

    expect(restorePersistedAnnotations(
      value.tools as never,
      { axial: { element: value.axial } } as never,
      annotations,
      ['image-axial'],
    )).toEqual({ restored: 1, skipped: 1 })
    expect(value.tools.utilities.annotationHydration).toHaveBeenCalledOnce()
  })
})
