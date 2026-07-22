import { beforeEach, expect, it, vi } from 'vitest'

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
    render: vi.fn(),
    resetCamera: vi.fn(),
    resetProperties: vi.fn(),
    setImageIdIndex: vi.fn(async () => ''),
    setStack: vi.fn(async () => ''),
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
  }
})

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    Events: {
      IMAGE_LOAD_ERROR: 'IMAGE_LOAD_ERROR',
      STACK_NEW_IMAGE: 'CORNERSTONE_STACK_NEW_IMAGE',
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
