import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ViewerAnnotationCallbacks } from '../model/viewerAnnotation'
import { scopedEraserToolClass } from './ScopedAnnotationEraserTool'
import {
  ANNOTATION_TOOL_NAMES,
  installViewerAnnotationTools,
} from './annotationTools'


function createHarness() {
  const eventTarget = new EventTarget()
  const elements = [document.createElement('div'), document.createElement('div')]
  const annotations = new Map<string, Array<Record<string, unknown>>>()
  const removed: string[] = []
  class BaseTool {
    supportedInteractionTypes: string[]
    toolGroupId: string

    constructor(
      toolProps: { toolGroupId?: string } = {},
      defaultToolProps: { supportedInteractionTypes?: string[] } = {},
    ) {
      this.toolGroupId = toolProps.toolGroupId ?? 'group'
      this.supportedInteractionTypes =
        defaultToolProps.supportedInteractionTypes ?? []
    }
  }
  const toolInstances = new Map<string, unknown>()
  const toolGroup = {
    addTool: vi.fn(),
    getToolInstance: vi.fn((name: string) => toolInstances.get(name)),
    setToolActive: vi.fn(),
    setToolPassive: vi.fn(),
  }
  const tools = {
    AngleTool: { toolName: 'Angle' },
    ArrowAnnotateTool: { toolName: 'ArrowAnnotate' },
    BaseTool,
    Enums: {
      Events: {
        ANNOTATION_COMPLETED: 'ANNOTATION_COMPLETED',
        ANNOTATION_MODIFIED: 'ANNOTATION_MODIFIED',
        ANNOTATION_REMOVED: 'ANNOTATION_REMOVED',
      },
      MouseBindings: { Primary: 1 },
    },
    LengthTool: { toolName: 'Length' },
    RectangleROITool: { toolName: 'RectangleROI' },
    ToolGroupManager: {
      getToolGroup: vi.fn(() => toolGroup),
      getToolGroupForViewport: vi.fn(() => toolGroup),
    },
    addTool: vi.fn(),
    annotation: {
      state: {
        getAnnotations: vi.fn((name: string, element: HTMLDivElement) =>
          annotations.get(`${name}:${elements.indexOf(element)}`) ?? []),
        removeAnnotation: vi.fn((uid: string) => removed.push(uid)),
      },
    },
    cancelActiveManipulations: vi.fn(),
    store: { hasTool: vi.fn(() => false) },
    utilities: {
      annotationHydration: vi.fn(() => {
        eventTarget.dispatchEvent(new Event('ANNOTATION_COMPLETED'))
        return { data: { handles: { points: [] } }, invalidated: false }
      }),
      triggerAnnotationRender: vi.fn(),
    },
  }
  const imagePlaneModules = new Map([
    ['a', { rowPixelSpacing: 0.7, columnPixelSpacing: 0.7 }],
    ['b', { rowPixelSpacing: 0.7, columnPixelSpacing: 0.7 }],
  ])
  const core = {
    eventTarget,
    getEnabledElement: vi.fn((element: HTMLDivElement) => ({
      viewport: {
        element,
        getCamera: () => ({ viewPlaneNormal: [0, 0, 1] }),
      },
    })),
    metaData: {
      get: vi.fn((_type: string, imageId: string) => imagePlaneModules.get(imageId)),
    },
  }
  const callbacks: ViewerAnnotationCallbacks = {
    onAnnotationCountChange: vi.fn(),
    onCalibrationChange: vi.fn(),
    onTextRequest: vi.fn(),
  }
  return {
    annotations,
    callbacks,
    core,
    elements,
    eventTarget,
    removed,
    toolGroup,
    toolInstances,
    tools,
  }
}

describe('viewer annotation controller', () => {
  beforeEach(() => vi.clearAllMocks())

  it('registers and installs five scoped tools with calibrated metadata', () => {
    const harness = createHarness()

    installViewerAnnotationTools({
      callbacks: harness.callbacks,
      core: harness.core as never,
      elements: harness.elements,
      imageIds: ['a', 'b'],
      toolGroup: harness.toolGroup,
      tools: harness.tools as never,
    })

    expect(harness.tools.addTool).toHaveBeenCalledTimes(5)
    expect(harness.toolGroup.addTool).toHaveBeenCalledTimes(5)
    expect(harness.callbacks.onCalibrationChange).toHaveBeenCalledWith({
      available: true,
      reason: null,
    })
    expect(harness.core.metaData.get).toHaveBeenCalledTimes(2)
  })

  it('bridges create and edit text without mutating cancelled edits', () => {
    const harness = createHarness()
    installViewerAnnotationTools({
      callbacks: harness.callbacks,
      core: harness.core as never,
      elements: harness.elements,
      imageIds: ['a', 'b'],
      toolGroup: harness.toolGroup,
      tools: harness.tools as never,
    })
    const arrowCall = harness.toolGroup.addTool.mock.calls.find(
      ([name]) => name === 'ArrowAnnotate',
    )
    const configuration = arrowCall?.[1] as {
      changeTextCallback: (
        annotation: { data: { label: string } },
        event: unknown,
        done: (value?: string) => void,
      ) => void
      getTextCallback: (done: (value?: string) => void) => void
    }
    const createDone = vi.fn()
    configuration.getTextCallback(createDone)
    const createRequest = vi.mocked(harness.callbacks.onTextRequest).mock.calls.at(-1)?.[0]
    expect(createRequest).toMatchObject({ initialValue: '', mode: 'create' })
    createRequest?.cancel()
    expect(createDone).toHaveBeenCalledWith(undefined)

    const editDone = vi.fn()
    configuration.changeTextCallback({ data: { label: 'old' } }, null, editDone)
    const editRequest = vi.mocked(harness.callbacks.onTextRequest).mock.calls.at(-1)?.[0]
    expect(editRequest).toMatchObject({ initialValue: 'old', mode: 'edit' })
    editRequest?.cancel()
    expect(editDone).not.toHaveBeenCalled()
  })

  it('counts and clears de-duplicated allowlisted annotations only', () => {
    const harness = createHarness()
    harness.annotations.set('Length:0', [
      { annotationUID: 'length-1' },
      { annotationUID: 'shared' },
    ])
    harness.annotations.set('Length:1', [{ annotationUID: 'shared' }])
    harness.annotations.set('ArrowAnnotate:1', [{ annotationUID: 'arrow-1' }])
    harness.annotations.set('Crosshairs:0', [{ annotationUID: 'crosshairs' }])
    const controller = installViewerAnnotationTools({
      callbacks: harness.callbacks,
      core: harness.core as never,
      elements: harness.elements,
      imageIds: ['a', 'b'],
      toolGroup: harness.toolGroup,
      tools: harness.tools as never,
    })

    harness.eventTarget.dispatchEvent(new Event('ANNOTATION_COMPLETED'))
    expect(harness.callbacks.onAnnotationCountChange).toHaveBeenLastCalledWith(3)

    controller.clearAnnotations()

    expect(new Set(harness.removed)).toEqual(new Set(['length-1', 'shared', 'arrow-1']))
    expect(harness.removed).not.toContain('crosshairs')
    expect(harness.tools.annotation.state.getAnnotations).not.toHaveBeenCalledWith(
      'Crosshairs',
      expect.anything(),
    )
    expect(harness.tools.utilities.triggerAnnotationRender).toHaveBeenCalledTimes(2)
    expect(harness.tools.utilities.triggerAnnotationRender).toHaveBeenCalledWith(
      harness.elements[0],
    )
    expect(harness.tools.utilities.triggerAnnotationRender).toHaveBeenCalledWith(
      harness.elements[1],
    )
  })

  it('activates one annotation tool and destroys idempotently', () => {
    const harness = createHarness()
    const controller = installViewerAnnotationTools({
      callbacks: harness.callbacks,
      core: harness.core as never,
      elements: harness.elements,
      imageIds: ['a', 'b'],
      toolGroup: harness.toolGroup,
      tools: harness.tools as never,
    })

    controller.activate('length')
    expect(harness.toolGroup.setToolPassive).toHaveBeenCalledTimes(5)
    expect(harness.toolGroup.setToolActive).toHaveBeenCalledWith('Length', {
      bindings: [{ mouseButton: 1 }],
    })

    controller.destroy()
    controller.destroy()
    expect(harness.tools.cancelActiveManipulations).toHaveBeenCalledTimes(2)
  })

  it('captures and restores through the safe adapter without save feedback', () => {
    const harness = createHarness()
    harness.annotations.set('Length:0', [{
      annotationUID: 'length-1',
      metadata: { referencedImageId: 'a', viewPlaneNormal: [0, 0, 1] },
      data: { handles: { points: [[0, 0, 0], [1, 1, 0]] } },
    }])
    const onAnnotationsChange = vi.fn()
    const controller = installViewerAnnotationTools({
      callbacks: { ...harness.callbacks, onAnnotationsChange },
      core: harness.core as never,
      elements: harness.elements,
      imageIds: ['a', 'b'],
      toolGroup: harness.toolGroup,
      tools: harness.tools as never,
    })

    const captured = controller.capture({ axial: harness.elements[0] })
    expect(captured).toEqual([expect.objectContaining({
      viewport: 'axial',
      tool_name: 'Length',
    })])

    const restored = controller.restore(
      { axial: { element: harness.elements[0] } } as never,
      captured,
    )
    expect(restored).toEqual({ restored: 1, skipped: 0 })
    expect(onAnnotationsChange).not.toHaveBeenCalled()

    harness.eventTarget.dispatchEvent(new Event('ANNOTATION_MODIFIED'))
    expect(onAnnotationsChange).toHaveBeenCalledOnce()
  })
})

it('scoped eraser deletes only the latest allowlisted hit', () => {
  const harness = createHarness()
  const lengthAnnotations = [
    { annotationUID: 'older' },
    { annotationUID: 'latest' },
  ]
  harness.annotations.set('Length:0', lengthAnnotations)
  harness.toolInstances.set('Length', {
    filterInteractableAnnotationsForElement: vi.fn((_element, values) => values),
    isPointNearTool: vi.fn(() => true),
  })
  const Eraser = scopedEraserToolClass(harness.tools as never)
  const eraser = new Eraser({ toolGroupId: 'group' } as never) as unknown as {
    preMouseDownCallback(event: unknown): boolean
    supportedInteractionTypes: string[]
  }
  const preventDefault = vi.fn()

  const deleted = eraser.preMouseDownCallback({
    detail: {
      currentPoints: { canvas: [10, 20] },
      element: harness.elements[0],
      renderingEngineId: 'engine',
      viewportId: 'viewport',
    },
    preventDefault,
  })

  expect(deleted).toBe(true)
  expect(eraser.supportedInteractionTypes).toEqual(['Mouse', 'Touch'])
  expect(harness.removed).toEqual(['latest'])
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(harness.tools.annotation.state.getAnnotations).not.toHaveBeenCalledWith(
    'Crosshairs',
    expect.anything(),
  )
  expect(harness.tools.utilities.triggerAnnotationRender).toHaveBeenCalledWith(
    harness.elements[0],
  )
  expect(ANNOTATION_TOOL_NAMES.eraseAnnotation).toBe('ScopedAnnotationEraser')
})
