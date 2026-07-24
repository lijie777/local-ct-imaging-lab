import { beforeEach, expect, it, vi } from 'vitest'

type InstallViewerAnnotationToolsOptions = Parameters<
  typeof import('../../viewer-annotations/core/annotationTools').installViewerAnnotationTools
>[0]

const mocks = vi.hoisted(() => {
  const eventListeners = new Map<string, Set<(event: Event) => void>>()
  const eventTarget = {
    addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
      const listeners = eventListeners.get(type) ?? new Set()
      listeners.add(listener)
      eventListeners.set(type, listeners)
    }),
    dispatchEvent: vi.fn((event: Event) => {
      eventListeners.get(event.type)?.forEach((listener) => listener(event))
      return true
    }),
    removeEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
      eventListeners.get(type)?.delete(listener)
    }),
  }
  const viewport = {
    getCurrentImageIdIndex: vi.fn(() => 1),
    getProperties: vi.fn(() => ({
      invert: false,
      voiRange: { lower: -100, upper: 300 },
    })),
    getViewPresentation: vi.fn(() => ({
      flipHorizontal: false,
      flipVertical: false,
      pan: [3, -2],
      rotation: 5,
      zoom: 1.5,
    })),
    render: vi.fn(),
    resetCamera: vi.fn(),
    resetProperties: vi.fn(),
    setImageIdIndex: vi.fn(async () => ''),
    setProperties: vi.fn(),
    setStack: vi.fn(async () => ''),
    setViewPresentation: vi.fn(),
  }
  const renderingEngine = {
    destroy: vi.fn(),
    enableElement: vi.fn(),
    getViewport: vi.fn(() => viewport),
    resize: vi.fn(),
  }
  const toolGroup = {
    addTool: vi.fn(),
    addViewport: vi.fn(),
    setToolActive: vi.fn(),
    setToolPassive: vi.fn(),
  }
  const annotationController = {
    activate: vi.fn(),
    capture: vi.fn(() => [{
      viewport: 'axial',
      tool_name: 'Length',
      referenced_image_id: 'a',
      points: [[0, 0, 0], [1, 1, 0]],
      label: null,
      text_box: null,
    }]),
    clearAnnotations: vi.fn(),
    destroy: vi.fn(),
    restore: vi.fn(() => ({ restored: 1, skipped: 0 })),
  }
  return {
    addTool: vi.fn(),
    cacheGetImageLoadObject: vi.fn(() => ({ promise: Promise.resolve() })),
    cacheRemoveImageLoadObject: vi.fn(),
    coreInit: vi.fn(),
    createToolGroup: vi.fn(() => toolGroup),
    destroyToolGroup: vi.fn(),
    eventListeners,
    eventTarget,
    loaderInit: vi.fn(),
    renderingEngine,
    toolGroup,
    toolsInit: vi.fn(),
    viewport,
    annotationController,
    installViewerAnnotationTools: vi.fn(
      (_options: InstallViewerAnnotationToolsOptions) => annotationController,
    ),
    loadAndCacheImages: vi.fn((imageIds: string[]) =>
      imageIds.map(() => Promise.resolve({})),
    ),
  }
})

vi.mock('../../viewer-annotations/core/annotationTools', () => ({
  ANNOTATION_TOOL_NAMES: {
    angle: 'Angle',
    arrowAnnotate: 'ArrowAnnotate',
    eraseAnnotation: 'ScopedAnnotationEraser',
    length: 'Length',
    rectangleRoi: 'RectangleROI',
  },
  installViewerAnnotationTools: mocks.installViewerAnnotationTools,
}))

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    Events: {
      IMAGE_LOAD_ERROR: 'IMAGE_LOAD_ERROR',
      CAMERA_MODIFIED: 'CAMERA_MODIFIED',
      STACK_NEW_IMAGE: 'CORNERSTONE_STACK_NEW_IMAGE',
      VOI_MODIFIED: 'VOI_MODIFIED',
    },
    ViewportType: { STACK: 'stack' },
  },
  RenderingEngine: vi.fn(function RenderingEngine() {
    return mocks.renderingEngine
  }),
  cache: {
    getImageLoadObject: mocks.cacheGetImageLoadObject,
    removeImageLoadObject: mocks.cacheRemoveImageLoadObject,
  },
  eventTarget: mocks.eventTarget,
  imageLoader: {
    loadAndCacheImages: mocks.loadAndCacheImages,
  },
  init: mocks.coreInit,
}))
vi.mock('@cornerstonejs/dicom-image-loader', () => ({ init: mocks.loaderInit }))
vi.mock('@cornerstonejs/tools', () => ({
  Enums: { MouseBindings: { Primary: 1, Wheel: 524288 } },
  PanTool: { toolName: 'Pan' },
  StackScrollTool: { toolName: 'StackScroll' },
  ToolGroupManager: {
    createToolGroup: mocks.createToolGroup,
    destroyToolGroup: mocks.destroyToolGroup,
  },
  WindowLevelTool: { toolName: 'WindowLevel' },
  ZoomTool: { toolName: 'Zoom' },
  addTool: mocks.addTool,
  init: mocks.toolsInit,
}))


beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.eventListeners.clear()
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    configurable: true,
    value: 16,
  })
})

it('loads and initializes Cornerstone libraries only once with bounded workers', async () => {
  const core = await import('@cornerstonejs/core')
  const loader = await import('@cornerstonejs/dicom-image-loader')
  const tools = await import('@cornerstonejs/tools')
  const { initializeCornerstone } = await import('./cornerstone')
  type CornerstoneModules = import('./cornerstone').CornerstoneModules

  const [modules]: CornerstoneModules[] = await Promise.all([
    initializeCornerstone(),
    initializeCornerstone(),
  ])

  expect(modules).toEqual({ core, loader, tools })
  expect(core.init).toHaveBeenCalledOnce()
  expect(loader.init).toHaveBeenCalledOnce()
  expect(loader.init).toHaveBeenCalledWith({
    beforeSend: expect.any(Function),
    maxWebWorkers: 2,
    onloadend: expect.any(Function),
  })
  expect(tools.init).toHaveBeenCalledOnce()
})

it('aborts only matching pending DICOM XHRs', async () => {
  const { abortPendingDicomLoads, initializeCornerstone } = await import('./cornerstone')
  await initializeCornerstone()
  const loaderOptions = mocks.loaderInit.mock.calls[0][0]
  const pending = { abort: vi.fn(), readyState: 1 } as unknown as XMLHttpRequest
  const completed = { abort: vi.fn(), readyState: 4 } as unknown as XMLHttpRequest
  const unrelated = { abort: vi.fn(), readyState: 1 } as unknown as XMLHttpRequest
  loaderOptions.beforeSend(pending, 'pending', {}, {})
  loaderOptions.beforeSend(completed, 'completed', {}, {})
  loaderOptions.beforeSend(unrelated, 'unrelated', {}, {})

  abortPendingDicomLoads(['pending', 'completed', 'missing'])

  expect(pending.abort).toHaveBeenCalledOnce()
  expect(completed.abort).not.toHaveBeenCalled()
  expect(unrelated.abort).not.toHaveBeenCalled()
})

it('aborts every pending DICOM XHR tracked for the same image id', async () => {
  const { abortPendingDicomLoads, initializeCornerstone } = await import('./cornerstone')
  await initializeCornerstone()
  const loaderOptions = mocks.loaderInit.mock.calls[0][0]
  const first = { abort: vi.fn(), readyState: 1 } as unknown as XMLHttpRequest
  const second = { abort: vi.fn(), readyState: 1 } as unknown as XMLHttpRequest
  loaderOptions.beforeSend(first, 'duplicate', {}, {})
  loaderOptions.beforeSend(second, 'duplicate', {}, {})

  abortPendingDicomLoads(['duplicate'])

  expect(first.abort).toHaveBeenCalledOnce()
  expect(second.abort).toHaveBeenCalledOnce()
})

it('removes only the XHR reported by onloadend for a shared image id', async () => {
  const { abortPendingDicomLoads, initializeCornerstone } = await import('./cornerstone')
  await initializeCornerstone()
  const loaderOptions = mocks.loaderInit.mock.calls[0][0]
  const first = { abort: vi.fn(), readyState: 1 } as unknown as XMLHttpRequest
  const second = { abort: vi.fn(), readyState: 1 } as unknown as XMLHttpRequest
  loaderOptions.beforeSend(first, 'duplicate', {}, {})
  loaderOptions.beforeSend(second, 'duplicate', {}, {})
  loaderOptions.onloadend({ currentTarget: first }, { imageId: 'duplicate' })

  abortPendingDicomLoads(['duplicate'])

  expect(first.abort).not.toHaveBeenCalled()
  expect(second.abort).toHaveBeenCalledOnce()
})

it('stops tracking an image id after its final XHR completes', async () => {
  const { abortPendingDicomLoads, initializeCornerstone } = await import('./cornerstone')
  await initializeCornerstone()
  const loaderOptions = mocks.loaderInit.mock.calls[0][0]
  const completed = { abort: vi.fn(), readyState: 4 } as unknown as XMLHttpRequest
  loaderOptions.beforeSend(completed, 'completed', {}, {})
  loaderOptions.onloadend({ currentTarget: completed }, { imageId: 'completed' })

  abortPendingDicomLoads(['completed'])

  expect(completed.abort).not.toHaveBeenCalled()
})

it('registers stack and display tools with wheel plus one primary binding', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const element = document.createElement('div')

  const runtime = await createAxialViewportRuntime(
    element,
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    vi.fn(),
  )
  runtime.activateTool('pan')

  expect(mocks.addTool).toHaveBeenCalledTimes(4)
  expect(mocks.toolGroup.addTool).toHaveBeenCalledTimes(4)
  expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('StackScroll', {
    bindings: [{ mouseButton: 524288 }],
  })
  expect(mocks.toolGroup.setToolActive).toHaveBeenLastCalledWith('Pan', {
    bindings: [{ mouseButton: 1 }],
  })
  expect(mocks.toolGroup.setToolPassive).toHaveBeenCalledWith('WindowLevel')
})

it('installs annotations, routes tools, clears, and resets without clearing', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const element = document.createElement('div')
  const callbacks = {
    onAnnotationCountChange: vi.fn(),
    onCalibrationChange: vi.fn(),
    onTextRequest: vi.fn(),
  }
  const runtime = await createAxialViewportRuntime(
    element,
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    vi.fn(),
    undefined,
    callbacks,
  )

  expect(mocks.installViewerAnnotationTools).toHaveBeenCalledWith(
    expect.objectContaining({
      callbacks: expect.objectContaining({
        onAnnotationCountChange: callbacks.onAnnotationCountChange,
        onCalibrationChange: expect.any(Function),
        onTextRequest: callbacks.onTextRequest,
      }),
      elements: [element],
      imageIds: ['a', 'b', 'c'],
      toolGroup: mocks.toolGroup,
    }),
  )
  expect(mocks.loadAndCacheImages).toHaveBeenCalledWith(['a', 'b', 'c'])
  expect(mocks.loadAndCacheImages.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.installViewerAnnotationTools.mock.invocationCallOrder[0],
  )

  runtime.activateTool('length')
  expect(mocks.annotationController.activate).toHaveBeenCalledWith('length')
  for (const toolName of ['Pan', 'WindowLevel', 'Zoom']) {
    expect(mocks.toolGroup.setToolPassive).toHaveBeenCalledWith(toolName)
  }

  runtime.activateTool('pan')
  for (const toolName of [
    'Angle',
    'ArrowAnnotate',
    'ScopedAnnotationEraser',
    'Length',
    'RectangleROI',
  ]) {
    expect(mocks.toolGroup.setToolPassive).toHaveBeenCalledWith(toolName, {
      removeAllBindings: true,
    })
  }

  runtime.clearAnnotations()
  await runtime.reset()
  expect(mocks.annotationController.clearAnnotations).toHaveBeenCalledOnce()
  expect(mocks.toolGroup.setToolActive).toHaveBeenLastCalledWith('WindowLevel', {
    bindings: [{ mouseButton: 1 }],
  })
  expect(mocks.annotationController.clearAnnotations).toHaveBeenCalledOnce()
})

it('captures public presentation, VOI, active tool, and safe annotations', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const element = document.createElement('div')
  const runtime = await createAxialViewportRuntime(
    element,
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    vi.fn(),
  )
  runtime.activateTool('pan')

  expect(runtime.captureState()).toEqual({
    state: {
      image_index: 1,
      active_tool: 'pan',
      presentation: {
        zoom: 1.5,
        pan: [3, -2],
        rotation: 5,
        flip_horizontal: false,
        flip_vertical: false,
      },
      voi: { lower: -100, upper: 300, invert: false },
    },
    annotations: [expect.objectContaining({ tool_name: 'Length' })],
  })
  expect(mocks.annotationController.capture).toHaveBeenCalledWith({ axial: element })
})

it('applies bounded state in public API order and restores annotations', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const runtime = await createAxialViewportRuntime(
    document.createElement('div'),
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    vi.fn(),
  )
  mocks.viewport.setImageIdIndex.mockClear()
  mocks.toolGroup.setToolActive.mockClear()

  await expect(runtime.applyState({
    image_index: 99,
    active_tool: 'pan',
    presentation: {
      zoom: 2,
      pan: [4, 5],
      rotation: 10,
      flip_horizontal: true,
      flip_vertical: false,
    },
    voi: { lower: -200, upper: 200, invert: true },
  }, [{
    viewport: 'axial',
    tool_name: 'Length',
    referenced_image_id: 'a',
    points: [[0, 0, 0], [1, 1, 0]],
    label: null,
    text_box: null,
  }])).resolves.toEqual({ restored: 1, skipped: 0 })

  expect(mocks.viewport.setImageIdIndex).toHaveBeenCalledWith(2)
  expect(mocks.viewport.setViewPresentation).toHaveBeenCalledWith({
    zoom: 2,
    pan: [4, 5],
    rotation: 10,
    flipHorizontal: true,
    flipVertical: false,
  })
  expect(mocks.viewport.setProperties).toHaveBeenCalledWith({
    voiRange: { lower: -200, upper: 200 },
    invert: true,
  })
  expect(mocks.annotationController.restore).toHaveBeenCalledOnce()
  expect(mocks.toolGroup.setToolActive).toHaveBeenLastCalledWith('Pan', {
    bindings: [{ mouseButton: 1 }],
  })
  expect(mocks.viewport.setViewPresentation.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.annotationController.restore.mock.invocationCallOrder[0],
  )
})

it('falls back from geometry tools without calibration and emits changes after restore', async () => {
  mocks.installViewerAnnotationTools.mockImplementationOnce(({ callbacks }) => {
    callbacks.onCalibrationChange({ available: false, reason: 'missing spacing' })
    return mocks.annotationController
  })
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const element = document.createElement('div')
  const onStateChange = vi.fn()
  const runtime = await createAxialViewportRuntime(
    element,
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    vi.fn(),
    undefined,
    undefined,
    onStateChange,
  )
  onStateChange.mockClear()

  await runtime.applyState({
    image_index: 1,
    active_tool: 'length',
    presentation: null,
    voi: null,
  }, [])
  expect(mocks.toolGroup.setToolActive).toHaveBeenLastCalledWith('WindowLevel', {
    bindings: [{ mouseButton: 1 }],
  })
  expect(onStateChange).not.toHaveBeenCalled()

  element.dispatchEvent(new Event('CAMERA_MODIFIED'))
  expect(onStateChange).toHaveBeenCalledOnce()
})

it('destroys the annotation controller before the tool group and engine', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const runtime = await createAxialViewportRuntime(
    document.createElement('div'),
    ['a'],
    0,
    vi.fn(),
    vi.fn(),
  )

  runtime.destroy()

  expect(mocks.annotationController.destroy).toHaveBeenCalledOnce()
  expect(mocks.annotationController.destroy.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.destroyToolGroup.mock.invocationCallOrder[0],
  )
  expect(mocks.destroyToolGroup.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.renderingEngine.destroy.mock.invocationCallOrder[0],
  )
})

it('resizes the rendering engine through the viewport runtime', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const runtime = await createAxialViewportRuntime(
    document.createElement('div'),
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    vi.fn(),
  )

  runtime.resize()

  expect(mocks.renderingEngine.resize).toHaveBeenCalledOnce()
})

it('sanitizes a single image failure without destroying the runtime', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const onError = vi.fn()
  const runtime = await createAxialViewportRuntime(
    document.createElement('div'),
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    onError,
  )
  mocks.viewport.setImageIdIndex.mockRejectedValueOnce(
    new Error(String.raw`codec C:\private\decoder.dll failed`),
  )

  await runtime.next()

  expect(onError).toHaveBeenCalledWith('无法解码该影像，请重试或返回病人管理')
  expect(mocks.renderingEngine.destroy).not.toHaveBeenCalled()
})

it('reports matching global image-load errors and removes the listener on destroy', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const onError = vi.fn()
  const runtime = await createAxialViewportRuntime(
    document.createElement('div'),
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    onError,
  )

  mocks.eventTarget.dispatchEvent(
    new CustomEvent('IMAGE_LOAD_ERROR', {
      detail: { imageId: 'b', error: new Error('private path') },
    }),
  )

  expect(onError).toHaveBeenCalledWith('无法解码该影像，请重试或返回病人管理')
  runtime.destroy()
  onError.mockClear()
  mocks.eventTarget.dispatchEvent(
    new CustomEvent('IMAGE_LOAD_ERROR', { detail: { imageId: 'b' } }),
  )
  expect(onError).not.toHaveBeenCalled()
})

it.each([
  [404, '未找到该影像实例，请返回病人管理'],
  [409, '该序列暂不可查看，请返回病人管理'],
  [410, '本机 DICOM 文件缺失，请恢复文件后重试或返回病人管理'],
  [422, '影像请求无效，请返回病人管理'],
  [500, '本机影像服务异常，请重试或返回病人管理'],
  [0, '无法连接本机服务，请确认服务已启动'],
  [undefined, '无法解码该影像，请重试或返回病人管理'],
])('maps image-load status %s to a stable safe message', async (status, expected) => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const onError = vi.fn()
  await createAxialViewportRuntime(
    document.createElement('div'),
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    onError,
  )

  mocks.eventTarget.dispatchEvent(
    new CustomEvent('IMAGE_LOAD_ERROR', {
      detail: {
        imageId: 'b',
        error: status === undefined ? new Error('codec private path') : { status },
      },
    }),
  )

  expect(onError).toHaveBeenCalledWith(expected)
})

it('retries the current image by reloading the stack', async () => {
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const runtime = await createAxialViewportRuntime(
    document.createElement('div'),
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    vi.fn(),
  )
  mocks.viewport.setStack.mockClear()
  mocks.eventTarget.dispatchEvent(
    new CustomEvent('IMAGE_LOAD_ERROR', { detail: { imageId: 'b' } }),
  )

  await runtime.retry()

  expect(mocks.cacheRemoveImageLoadObject).toHaveBeenCalledWith('b', {
    force: true,
  })
  expect(mocks.viewport.setStack).toHaveBeenCalledWith(['a', 'b', 'c'], 1)
})

it('aborts a pending DICOM XHR and destroys resources when creation is cancelled', async () => {
  let resolveStack!: (value: string) => void
  mocks.viewport.setStack.mockImplementationOnce(
    () => new Promise<string>((resolve) => {
      resolveStack = resolve
    }),
  )
  const controller = new AbortController()
  const { createAxialViewportRuntime } = await import('./cornerstone')
  const runtimePromise = createAxialViewportRuntime(
    document.createElement('div'),
    ['a', 'b', 'c'],
    1,
    vi.fn(),
    vi.fn(),
    controller.signal,
  )
  await vi.waitFor(() => expect(mocks.viewport.setStack).toHaveBeenCalled())
  const loaderOptions = mocks.loaderInit.mock.calls[0][0]
  const xhr = {
    abort: vi.fn(),
    DONE: 4,
    readyState: 1,
  } as unknown as XMLHttpRequest
  loaderOptions.beforeSend(xhr, 'b', {}, {})

  controller.abort()

  expect(xhr.abort).toHaveBeenCalledOnce()
  expect(mocks.renderingEngine.destroy).toHaveBeenCalledOnce()
  resolveStack('b')
  await expect(runtimePromise).rejects.toMatchObject({ name: 'AbortError' })
})
