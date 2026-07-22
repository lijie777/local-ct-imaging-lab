import { beforeEach, describe, expect, it, vi } from 'vitest'


const mocks = vi.hoisted(() => {
  const volume = {
    cancelLoading: vi.fn(),
    clearLoadCallbacks: vi.fn(),
    load: vi.fn((_callback: (result: {
      framesLoaded: number
      framesProcessed: number
      success: boolean
      totalNumFrames: number
    }) => void) => undefined),
  }
  const viewports = {
    axial: {
      getCamera: vi.fn(() => ({
        focalPoint: [0, 0, 0],
        viewPlaneNormal: [0, 0, 1],
      })),
      render: vi.fn(),
      resetCamera: vi.fn(),
      resetProperties: vi.fn(),
      setProperties: vi.fn(),
    },
    coronal: {
      getCamera: vi.fn(() => ({
        focalPoint: [0, 0, 0],
        viewPlaneNormal: [0, 1, 0],
      })),
      render: vi.fn(),
      resetCamera: vi.fn(),
      resetProperties: vi.fn(),
      setProperties: vi.fn(),
    },
    sagittal: {
      getCamera: vi.fn(() => ({
        focalPoint: [0, 0, 0],
        viewPlaneNormal: [1, 0, 0],
      })),
      render: vi.fn(),
      resetCamera: vi.fn(),
      resetProperties: vi.fn(),
      setProperties: vi.fn(),
    },
  }
  const renderingEngine = {
    destroy: vi.fn(),
    getViewport: vi.fn((viewportId: string) => {
      const key = (['axial', 'coronal', 'sagittal'] as const).find(
        (candidate) => viewportId.includes(candidate),
      )
      return key === undefined ? undefined : viewports[key]
    }),
    render: vi.fn(),
    resize: vi.fn(),
    setViewports: vi.fn((_viewports: Array<{
      defaultOptions: { orientation: string }
      element: HTMLDivElement
      type: string
      viewportId: string
    }>) => undefined),
  }
  const eventListeners = new Map<string, Set<EventListener>>()
  const eventTarget = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const listeners = eventListeners.get(type) ?? new Set<EventListener>()
      listeners.add(listener)
      eventListeners.set(type, listeners)
    }),
    dispatchEvent: vi.fn((event: Event) => {
      for (const listener of [...(eventListeners.get(event.type) ?? [])]) {
        listener(event)
      }
      return !event.defaultPrevented
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      eventListeners.get(type)?.delete(listener)
    }),
  }
  const crosshairsTool = { resetCrosshairs: vi.fn() }
  const toolGroup = {
    addTool: vi.fn(),
    addViewport: vi.fn(),
    getToolInstance: vi.fn(() => crosshairsTool),
    setToolActive: vi.fn(),
    setToolDisabled: vi.fn(),
    setToolEnabled: vi.fn(),
    setToolPassive: vi.fn(),
  }
  const core = {
    Enums: {
      Events: {
        CAMERA_MODIFIED: 'CAMERA_MODIFIED',
        IMAGE_LOAD_FAILED: 'IMAGE_LOAD_FAILED',
        IMAGE_LOAD_ERROR: 'IMAGE_LOAD_ERROR',
        IMAGE_VOLUME_LOADING_COMPLETED: 'IMAGE_VOLUME_LOADING_COMPLETED',
        VOLUME_LOADED_FAILED: 'VOLUME_LOADED_FAILED',
        VOLUME_NEW_IMAGE: 'VOLUME_NEW_IMAGE',
        VOI_MODIFIED: 'VOI_MODIFIED',
      },
      OrientationAxis: {
        AXIAL: 'axial',
        CORONAL: 'coronal',
        SAGITTAL: 'sagittal',
      },
      ViewportType: { ORTHOGRAPHIC: 'orthographic' },
    },
    RenderingEngine: vi.fn(function RenderingEngine(_renderingEngineId?: string) {
      return renderingEngine
    }),
    cache: {
      getImageLoadObject: vi.fn(() => ({ promise: Promise.resolve() })),
      getVolumeLoadObject: vi.fn(),
      removeImageLoadObject: vi.fn(),
      removeVolumeLoadObject: vi.fn(),
    },
    eventTarget,
    imageLoader: {
      loadImage: vi.fn(async (_imageId: string) => ({})),
    },
    setVolumesForViewports: vi.fn(async (
      _renderingEngine: unknown,
      _volumeInputs: Array<{ volumeId: string }>,
      _viewportIds: string[],
    ) => undefined),
    volumeLoader: {
      createAndCacheVolume: vi.fn(async (
        _volumeId: string,
        _options: { imageIds: string[] },
      ) => volume),
    },
  }
  const tools = {
    CrosshairsTool: { toolName: 'Crosshairs' },
    Enums: { MouseBindings: { Primary: 1, Wheel: 524288 } },
    PanTool: { toolName: 'Pan' },
    StackScrollTool: { toolName: 'StackScroll' },
    ToolGroupManager: {
      createToolGroup: vi.fn(() => toolGroup),
      destroyToolGroup: vi.fn(),
      getToolGroup: vi.fn(() => toolGroup),
    },
    WindowLevelTool: { toolName: 'WindowLevel' },
    ZoomTool: { toolName: 'Zoom' },
    addTool: vi.fn(),
  }

  return {
    abortPendingDicomLoads: vi.fn(),
    core,
    crosshairsTool,
    eventListeners,
    renderingEngine,
    toolGroup,
    tools,
    volume,
    viewports,
  }
})

vi.mock('../../axial-viewer/core/cornerstone', () => ({
  abortPendingDicomLoads: mocks.abortPendingDicomLoads,
  initializeCornerstone: vi.fn(async () => ({
    core: mocks.core,
    loader: {},
    tools: mocks.tools,
  })),
  toSafeViewerError: vi.fn(() => '无法构建三视图，请重试或返回轴位查看器'),
}))

function createElements() {
  const element = () => {
    const value = document.createElement('div')
    Object.defineProperties(value, {
      clientHeight: { configurable: true, value: 320 },
      clientWidth: { configurable: true, value: 480 },
    })
    return value
  }
  return {
    axial: element(),
    coronal: element(),
    sagittal: element(),
  }
}

function createCallbacks() {
  return {
    onActiveViewport: vi.fn(),
    onError: vi.fn(),
    onPosition: vi.fn(),
    onProgress: vi.fn(),
    onReady: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.eventListeners.clear()
  mocks.core.volumeLoader.createAndCacheVolume.mockResolvedValue(mocks.volume)
  mocks.core.imageLoader.loadImage.mockResolvedValue({})
  mocks.core.cache.getImageLoadObject.mockReturnValue({ promise: Promise.resolve() })
  mocks.core.cache.getVolumeLoadObject.mockReturnValue(undefined)
  mocks.viewports.axial.getCamera.mockReturnValue({
    focalPoint: [0, 0, 0],
    viewPlaneNormal: [0, 0, 1],
  })
  mocks.viewports.coronal.getCamera.mockReturnValue({
    focalPoint: [0, 0, 0],
    viewPlaneNormal: [0, 1, 0],
  })
  mocks.viewports.sagittal.getCamera.mockReturnValue({
    focalPoint: [0, 0, 0],
    viewPlaneNormal: [1, 0, 0],
  })
})

describe('MPR volume and viewport creation', () => {
  it('loads every metadata source without caching pixels and clears old stack images before volume creation', async () => {
    let releaseFirst!: (value: object) => void
    mocks.core.imageLoader.loadImage
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve }))
      .mockResolvedValue({})
    const { createMprRuntime } = await import('./mprCornerstone')

    const runtimePromise = createMprRuntime(
      createElements(),
      ['a', 'b', 'c'],
      createCallbacks(),
    )
    await vi.waitFor(() => {
      expect(mocks.core.imageLoader.loadImage).toHaveBeenCalledTimes(3)
    })
    expect(mocks.core.volumeLoader.createAndCacheVolume).not.toHaveBeenCalled()

    releaseFirst({})
    await runtimePromise
    expect(mocks.core.cache.removeImageLoadObject.mock.calls).toEqual([
      ['a', { force: true }],
      ['b', { force: true }],
      ['c', { force: true }],
    ])
    expect(mocks.core.volumeLoader.createAndCacheVolume).toHaveBeenCalledOnce()
    expect(mocks.core.cache.removeImageLoadObject.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.core.volumeLoader.createAndCacheVolume.mock.invocationCallOrder[0],
    )
  })

  it('creates one streaming volume from an imageIds copy and three orthographic orientations', async () => {
    const imageIds = ['a', 'b', 'c']
    const { createMprRuntime } = await import('./mprCornerstone')

    await createMprRuntime(createElements(), imageIds, createCallbacks())

    expect(mocks.core.volumeLoader.createAndCacheVolume).toHaveBeenCalledOnce()
    const [volumeId, options] = mocks.core.volumeLoader.createAndCacheVolume.mock.calls[0]
    expect(volumeId).toMatch(/^cornerstoneStreamingImageVolume:mpr-/)
    expect(options).toEqual({ imageIds })
    expect(options.imageIds).not.toBe(imageIds)
    expect(mocks.renderingEngine.setViewports).toHaveBeenCalledWith([
      expect.objectContaining({
        defaultOptions: { orientation: 'axial' },
        element: expect.any(HTMLDivElement),
        type: 'orthographic',
        viewportId: expect.stringContaining('axial'),
      }),
      expect.objectContaining({
        defaultOptions: { orientation: 'coronal' },
        element: expect.any(HTMLDivElement),
        type: 'orthographic',
        viewportId: expect.stringContaining('coronal'),
      }),
      expect.objectContaining({
        defaultOptions: { orientation: 'sagittal' },
        element: expect.any(HTMLDivElement),
        type: 'orthographic',
        viewportId: expect.stringContaining('sagittal'),
      }),
    ])
  })

  it('restores keyboard focusability after Cornerstone configures the viewport elements', async () => {
    const elements = createElements()
    for (const element of Object.values(elements)) {
      element.tabIndex = 0
    }
    mocks.renderingEngine.setViewports.mockImplementationOnce((viewports) => {
      for (const viewport of viewports) {
        viewport.element.tabIndex = -1
      }
    })
    const { createMprRuntime } = await import('./mprCornerstone')

    await createMprRuntime(elements, ['a', 'b', 'c'], createCallbacks())

    expect(Object.values(elements).map((element) => element.tabIndex)).toEqual([0, 0, 0])
  })

  it('keeps native Tab navigation available while the runtime is active and removes its guard on destroy', async () => {
    const elements = createElements()
    const { createMprRuntime } = await import('./mprCornerstone')
    const runtime = await createMprRuntime(elements, ['a', 'b', 'c'], createCallbacks())
    const cornerstoneKeydown = vi.fn((event: Event) => event.preventDefault())
    elements.axial.addEventListener('keydown', cornerstoneKeydown)

    const activeTab = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    })
    expect(elements.axial.dispatchEvent(activeTab)).toBe(true)
    expect(activeTab.defaultPrevented).toBe(false)
    expect(cornerstoneKeydown).not.toHaveBeenCalled()

    runtime.destroy()
    const afterDestroyTab = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Tab',
    })
    expect(elements.axial.dispatchEvent(afterDestroyTab)).toBe(false)
    expect(afterDestroyTab.defaultPrevented).toBe(true)
    expect(cornerstoneKeydown).toHaveBeenCalledOnce()
  })

  it('uses unique runtime and volume ids for separate sessions', async () => {
    const { createMprRuntime } = await import('./mprCornerstone')

    await createMprRuntime(createElements(), ['a', 'b'], createCallbacks())
    await createMprRuntime(createElements(), ['a', 'b'], createCallbacks())

    const volumeIds = mocks.core.volumeLoader.createAndCacheVolume.mock.calls.map(
      ([volumeId]) => volumeId,
    )
    expect(new Set(volumeIds).size).toBe(2)
    const renderingEngineIds = vi.mocked(mocks.core.RenderingEngine).mock.calls.map(
      ([renderingEngineId]) => renderingEngineId,
    )
    expect(new Set(renderingEngineIds).size).toBe(2)
  })
})

describe('MPR volume binding and progress', () => {
  it('binds the same volume to all viewports before one load call and the first render', async () => {
    const { createMprRuntime } = await import('./mprCornerstone')

    await createMprRuntime(createElements(), ['a', 'b', 'c'], createCallbacks())

    const volumeId = mocks.core.volumeLoader.createAndCacheVolume.mock.calls[0][0]
    const viewportIds = mocks.renderingEngine.setViewports.mock.calls[0][0].map(
      ({ viewportId }: { viewportId: string }) => viewportId,
    )
    expect(mocks.core.setVolumesForViewports).toHaveBeenCalledWith(
      mocks.renderingEngine,
      [{ volumeId }],
      viewportIds,
    )
    expect(mocks.volume.load).toHaveBeenCalledOnce()
    expect(mocks.renderingEngine.render).toHaveBeenCalledOnce()
    expect(mocks.viewports.axial.resetCamera).toHaveBeenCalledOnce()
    expect(mocks.viewports.coronal.resetCamera).toHaveBeenCalledOnce()
    expect(mocks.viewports.sagittal.resetCamera).toHaveBeenCalledOnce()
    expect(mocks.core.setVolumesForViewports.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.viewports.axial.resetCamera.mock.invocationCallOrder[0],
    )
    expect(mocks.viewports.axial.resetCamera.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.volume.load.mock.invocationCallOrder[0],
    )
    expect(mocks.volume.load.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.renderingEngine.render.mock.invocationCallOrder[0],
    )
  })

  it('reports loaded, processed, and total counts and becomes ready only on complete success', async () => {
    const callbacks = createCallbacks()
    const { createMprRuntime } = await import('./mprCornerstone')
    await createMprRuntime(createElements(), ['a', 'b', 'c'], callbacks)
    const loadCallback = mocks.volume.load.mock.calls[0][0]

    loadCallback({
      framesLoaded: 1,
      framesProcessed: 1,
      success: true,
      totalNumFrames: 3,
    })
    expect(callbacks.onProgress).toHaveBeenLastCalledWith({
      loaded: 1,
      processed: 1,
      total: 3,
    })
    expect(callbacks.onReady).not.toHaveBeenCalled()

    loadCallback({
      framesLoaded: 3,
      framesProcessed: 3,
      success: true,
      totalNumFrames: 3,
    })
    expect(callbacks.onReady).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('treats processed frames with any failed frame as a partial-load error', async () => {
    const callbacks = createCallbacks()
    const { createMprRuntime } = await import('./mprCornerstone')
    await createMprRuntime(createElements(), ['a', 'b', 'c'], callbacks)
    const loadCallback = mocks.volume.load.mock.calls[0][0]

    loadCallback({
      framesLoaded: 2,
      framesProcessed: 3,
      success: true,
      totalNumFrames: 3,
    })

    expect(callbacks.onProgress).toHaveBeenLastCalledWith({
      loaded: 2,
      processed: 3,
      total: 3,
    })
    expect(callbacks.onReady).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledWith(
      '部分影像加载失败，无法完整构建三视图，请重试或返回轴位查看器',
    )
  })

  it('rejects volume creation with a safe message and never leaks internal details', async () => {
    mocks.core.volumeLoader.createAndCacheVolume.mockRejectedValueOnce(
      new Error(String.raw`volume codec C:\private\series failed`),
    )
    const { createMprRuntime } = await import('./mprCornerstone')

    await expect(
      createMprRuntime(createElements(), ['a', 'b'], createCallbacks()),
    ).rejects.toThrow('无法构建三视图，请重试或返回轴位查看器')
  })
})

describe('MPR tools', () => {
  it('registers one tool group for all viewports with one Primary tool and Wheel scrolling', async () => {
    const { createMprRuntime } = await import('./mprCornerstone')

    await createMprRuntime(createElements(), ['a', 'b'], createCallbacks())

    expect(mocks.tools.addTool).toHaveBeenCalledTimes(5)
    expect(mocks.toolGroup.addTool).toHaveBeenCalledTimes(5)
    expect(mocks.toolGroup.addViewport).toHaveBeenCalledTimes(3)
    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('StackScroll', {
      bindings: [{ mouseButton: 524288 }],
    })
    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('Crosshairs', {
      bindings: [{ mouseButton: 1 }],
    })
    const primaryBindings = mocks.toolGroup.setToolActive.mock.calls.filter(
      ([, options]) => options?.bindings?.some(
        ({ mouseButton }: { mouseButton: number }) => mouseButton === 1,
      ),
    )
    expect(primaryBindings).toEqual([
      ['Crosshairs', { bindings: [{ mouseButton: 1 }] }],
    ])
    expect(mocks.toolGroup.setToolPassive).toHaveBeenCalledWith('WindowLevel', {
      removeAllBindings: true,
    })
    expect(mocks.toolGroup.setToolPassive).toHaveBeenCalledWith('Pan', {
      removeAllBindings: true,
    })
    expect(mocks.toolGroup.setToolPassive).toHaveBeenCalledWith('Zoom', {
      removeAllBindings: true,
    })
  })

  it('clears every old Primary binding and keeps non-active Crosshairs visible', async () => {
    const { createMprRuntime } = await import('./mprCornerstone')
    const runtime = await createMprRuntime(createElements(), ['a', 'b'], createCallbacks())
    mocks.toolGroup.setToolActive.mockClear()
    mocks.toolGroup.setToolEnabled.mockClear()
    mocks.toolGroup.setToolPassive.mockClear()

    runtime.activateTool('pan')

    expect(mocks.toolGroup.setToolEnabled).toHaveBeenCalledWith('Crosshairs')
    for (const toolName of ['WindowLevel', 'Pan', 'Zoom']) {
      expect(mocks.toolGroup.setToolPassive).toHaveBeenCalledWith(toolName, {
        removeAllBindings: true,
      })
    }
    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('Pan', {
      bindings: [{ mouseButton: 1 }],
    })
    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledTimes(1)
  })

  it('disables Crosshairs safely and re-enables it without stealing the Primary tool', async () => {
    const { createMprRuntime } = await import('./mprCornerstone')
    const runtime = await createMprRuntime(createElements(), ['a', 'b'], createCallbacks())
    mocks.toolGroup.setToolActive.mockClear()
    mocks.toolGroup.setToolDisabled.mockClear()
    mocks.toolGroup.setToolEnabled.mockClear()

    runtime.setCrosshairsVisible(false)

    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('WindowLevel', {
      bindings: [{ mouseButton: 1 }],
    })
    expect(mocks.toolGroup.setToolDisabled).toHaveBeenCalledWith('Crosshairs')

    mocks.toolGroup.setToolActive.mockClear()
    mocks.toolGroup.setToolEnabled.mockClear()
    runtime.setCrosshairsVisible(true)
    expect(mocks.toolGroup.setToolEnabled).toHaveBeenCalledWith('Crosshairs')
    expect(mocks.toolGroup.setToolActive).not.toHaveBeenCalled()
  })

  it('synchronizes VOI and invert to the other views without recursive camera synchronization', async () => {
    const elements = createElements()
    const { createMprRuntime } = await import('./mprCornerstone')
    await createMprRuntime(elements, ['a', 'b'], createCallbacks())
    for (const viewport of Object.values(mocks.viewports)) {
      viewport.setProperties.mockClear()
      viewport.render.mockClear()
    }
    mocks.viewports.coronal.setProperties.mockImplementationOnce(() => {
      elements.coronal.dispatchEvent(new CustomEvent('VOI_MODIFIED', {
        detail: { range: { lower: -100, upper: 300 } },
      }))
    })

    elements.axial.dispatchEvent(new CustomEvent('VOI_MODIFIED', {
      detail: {
        invert: true,
        invertStateChanged: true,
        range: { lower: -100, upper: 300 },
      },
    }))

    expect(mocks.viewports.axial.setProperties).not.toHaveBeenCalled()
    expect(mocks.viewports.coronal.setProperties).toHaveBeenCalledOnce()
    expect(mocks.viewports.sagittal.setProperties).toHaveBeenCalledOnce()
    expect(mocks.viewports.coronal.setProperties).toHaveBeenCalledWith({
      invert: true,
      voiRange: { lower: -100, upper: 300 },
    }, undefined, true)
    expect(mocks.viewports.sagittal.setProperties).toHaveBeenCalledWith({
      invert: true,
      voiRange: { lower: -100, upper: 300 },
    }, undefined, true)
    expect(mocks.viewports.coronal.render).toHaveBeenCalledOnce()
    expect(mocks.viewports.sagittal.render).toHaveBeenCalledOnce()

    elements.axial.dispatchEvent(new Event('CAMERA_MODIFIED'))
    expect(mocks.viewports.axial.setProperties).not.toHaveBeenCalled()
    expect(mocks.viewports.coronal.setProperties).toHaveBeenCalledOnce()
    expect(mocks.viewports.sagittal.setProperties).toHaveBeenCalledOnce()
  })

  it('removes the VOI listeners when the runtime is destroyed', async () => {
    const elements = createElements()
    const { createMprRuntime } = await import('./mprCornerstone')
    const runtime = await createMprRuntime(elements, ['a', 'b'], createCallbacks())
    runtime.destroy()
    mocks.viewports.coronal.setProperties.mockClear()
    mocks.viewports.sagittal.setProperties.mockClear()

    elements.axial.dispatchEvent(new CustomEvent('VOI_MODIFIED', {
      detail: { range: { lower: 1, upper: 2 } },
    }))

    expect(mocks.viewports.coronal.setProperties).not.toHaveBeenCalled()
    expect(mocks.viewports.sagittal.setProperties).not.toHaveBeenCalled()
  })

  it('resets properties, cameras, linked center, visibility, active viewport, and Primary tool', async () => {
    const callbacks = createCallbacks()
    const { createMprRuntime } = await import('./mprCornerstone')
    const runtime = await createMprRuntime(createElements(), ['a', 'b'], callbacks)
    runtime.activateTool('pan')
    runtime.setCrosshairsVisible(false)
    for (const viewport of Object.values(mocks.viewports)) {
      viewport.resetProperties.mockClear()
    }
    mocks.crosshairsTool.resetCrosshairs.mockClear()
    mocks.toolGroup.setToolActive.mockClear()
    mocks.toolGroup.setToolEnabled.mockClear()
    callbacks.onActiveViewport.mockClear()
    callbacks.onPosition.mockClear()

    runtime.reset()

    for (const viewport of Object.values(mocks.viewports)) {
      expect(viewport.resetProperties).toHaveBeenCalledOnce()
    }
    expect(mocks.toolGroup.setToolEnabled).toHaveBeenCalledWith('Crosshairs')
    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('Crosshairs', {
      bindings: [{ mouseButton: 1 }],
    })
    expect(mocks.crosshairsTool.resetCrosshairs).toHaveBeenCalledOnce()
    expect(callbacks.onActiveViewport).toHaveBeenCalledWith('axial')
    expect(callbacks.onPosition.mock.calls).toEqual([
      ['axial', [0, 0, 0]],
      ['coronal', [0, 0, 0]],
      ['sagittal', [0, 0, 0]],
    ])
    expect(mocks.core.volumeLoader.createAndCacheVolume).toHaveBeenCalledOnce()
  })

  it('centers the linked Crosshairs once after all three viewports are registered', async () => {
    const { createMprRuntime } = await import('./mprCornerstone')

    await createMprRuntime(createElements(), ['a', 'b'], createCallbacks())

    expect(mocks.toolGroup.getToolInstance).toHaveBeenCalledWith('Crosshairs')
    expect(mocks.crosshairsTool.resetCrosshairs).toHaveBeenCalledOnce()
    expect(mocks.toolGroup.addViewport.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.crosshairsTool.resetCrosshairs.mock.invocationCallOrder[0],
    )
  })

  it('reports the same three-plane world intersection after a camera change', async () => {
    const elements = createElements()
    const callbacks = createCallbacks()
    const { createMprRuntime } = await import('./mprCornerstone')
    await createMprRuntime(elements, ['a', 'b'], callbacks)
    callbacks.onPosition.mockClear()
    mocks.viewports.axial.getCamera.mockReturnValue({
      focalPoint: [0.5, 0.5, 2],
      viewPlaneNormal: [0, 0, 1],
    })
    mocks.viewports.coronal.getCamera.mockReturnValue({
      focalPoint: [0.5, 0.7, 2],
      viewPlaneNormal: [0, 1, 0],
    })
    mocks.viewports.sagittal.getCamera.mockReturnValue({
      focalPoint: [0.8, 0.5, 2],
      viewPlaneNormal: [1, 0, 0],
    })

    elements.axial.dispatchEvent(new Event('CAMERA_MODIFIED'))

    expect(callbacks.onPosition.mock.calls).toEqual([
      ['axial', [0.8, 0.7, 2]],
      ['coronal', [0.8, 0.7, 2]],
      ['sagittal', [0.8, 0.7, 2]],
    ])
  })
})

describe('MPR safe failures and cleanup', () => {
  it.each([
    [404, '未找到该影像实例，请返回轴位查看器'],
    [409, '该序列暂不可查看，请返回轴位查看器'],
    [410, '本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器'],
    [422, '影像请求无效，请返回轴位查看器'],
    [500, '本机影像服务异常，请重试或返回轴位查看器'],
    [0, '无法连接本机服务，请确认服务已启动'],
    [undefined, '无法构建三视图，请重试或返回轴位查看器'],
  ])('maps streaming image status %s to a stable safe message', async (status, expected) => {
    const callbacks = createCallbacks()
    const { createMprRuntime } = await import('./mprCornerstone')
    await createMprRuntime(createElements(), ['a', 'b'], callbacks)

    mocks.core.eventTarget.dispatchEvent(new CustomEvent('IMAGE_LOAD_ERROR', {
      detail: {
        error: status === undefined
          ? new Error(String.raw`codec C:\private\decoder.dll`)
          : { request: { status } },
        imageId: 'a',
      },
    }))

    expect(callbacks.onError).toHaveBeenCalledWith(expected)
    expect(callbacks.onError.mock.calls.flat().join(' ')).not.toMatch(
      /private|codec|volumeId|stack/i,
    )
  })

  it('handles IMAGE_LOAD_FAILED and the Cornerstone numeric IMAGE_LOAD_ERROR imageId without cross-talk', async () => {
    const firstCallbacks = createCallbacks()
    const { createMprRuntime } = await import('./mprCornerstone')
    const firstRuntime = await createMprRuntime(createElements(), ['a', 'b'], firstCallbacks)

    mocks.core.eventTarget.dispatchEvent(new CustomEvent('IMAGE_LOAD_FAILED', {
      detail: { error: { status: 410 }, imageId: 'b' },
    }))
    expect(firstCallbacks.onError).toHaveBeenLastCalledWith(
      '本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器',
    )
    firstRuntime.destroy()

    const secondCallbacks = createCallbacks()
    await createMprRuntime(createElements(), ['a', 'b'], secondCallbacks)
    mocks.core.eventTarget.dispatchEvent(new CustomEvent('IMAGE_LOAD_ERROR', {
      detail: { error: { status: 500 }, imageId: 1 },
    }))
    expect(secondCallbacks.onError).toHaveBeenLastCalledWith(
      '本机影像服务异常，请重试或返回轴位查看器',
    )

    secondCallbacks.onError.mockClear()
    mocks.core.eventTarget.dispatchEvent(new CustomEvent('IMAGE_LOAD_FAILED', {
      detail: { error: { status: 500 }, imageId: 'unrelated-image' },
    }))
    expect(secondCallbacks.onError).not.toHaveBeenCalled()
  })

  it('filters volume failures by runtime id and never exposes volume or WebGL internals', async () => {
    const callbacks = createCallbacks()
    const { createMprRuntime } = await import('./mprCornerstone')
    await createMprRuntime(createElements(), ['a', 'b'], callbacks)
    const volumeId = mocks.core.volumeLoader.createAndCacheVolume.mock.calls[0][0]

    mocks.core.eventTarget.dispatchEvent(new CustomEvent('VOLUME_LOADED_FAILED', {
      detail: {
        error: new Error(`WebGL failed for ${volumeId} at C:\\private`),
        volumeId: 'another-volume',
      },
    }))
    expect(callbacks.onError).not.toHaveBeenCalled()

    mocks.core.eventTarget.dispatchEvent(new CustomEvent('VOLUME_LOADED_FAILED', {
      detail: {
        error: new Error(`WebGL failed for ${volumeId} at C:\\private`),
        volumeId,
      },
    }))
    expect(callbacks.onError).toHaveBeenCalledWith(
      '无法构建三视图，请重试或返回轴位查看器',
    )
    expect(callbacks.onError.mock.calls.flat().join(' ')).not.toMatch(
      /WebGL|private|cornerstoneStreamingImageVolume/i,
    )
  })

  it.each(['decode', 'volume', 'render'] as const)(
    'rolls back a %s creation failure with only the generic safe message',
    async (failurePoint) => {
      if (failurePoint === 'decode') {
        mocks.core.imageLoader.loadImage.mockRejectedValueOnce(
          new Error(String.raw`codec C:\private\decoder.dll`),
        )
      } else if (failurePoint === 'volume') {
        mocks.core.volumeLoader.createAndCacheVolume.mockRejectedValueOnce(
          new Error(String.raw`volume C:\private\series failed`),
        )
      } else {
        mocks.renderingEngine.render.mockImplementationOnce(() => {
          throw new Error('WebGL context lost with private stack')
        })
      }
      const callbacks = createCallbacks()
      const { createMprRuntime } = await import('./mprCornerstone')

      await expect(
        createMprRuntime(createElements(), ['a', 'b'], callbacks),
      ).rejects.toThrow('无法构建三视图，请重试或返回轴位查看器')
      expect(callbacks.onError).toHaveBeenCalledWith(
        '无法构建三视图，请重试或返回轴位查看器',
      )
      expect(callbacks.onError.mock.calls.flat().join(' ')).not.toMatch(
        /private|codec|volume|WebGL|stack/i,
      )
    },
  )

  it('aborts pending requests and releases every owned resource exactly once', async () => {
    mocks.core.cache.getVolumeLoadObject.mockReturnValue({ promise: Promise.resolve() })
    const elements = createElements()
    const callbacks = createCallbacks()
    const { createMprRuntime } = await import('./mprCornerstone')
    const runtime = await createMprRuntime(elements, ['a', 'b'], callbacks)
    const volumeId = mocks.core.volumeLoader.createAndCacheVolume.mock.calls[0][0]
    callbacks.onError.mockClear()
    callbacks.onPosition.mockClear()

    runtime.destroy()
    runtime.destroy()

    expect(mocks.abortPendingDicomLoads).toHaveBeenCalledOnce()
    expect(mocks.abortPendingDicomLoads).toHaveBeenCalledWith(['a', 'b'])
    expect(mocks.volume.cancelLoading).toHaveBeenCalledOnce()
    expect(mocks.volume.clearLoadCallbacks).toHaveBeenCalledOnce()
    expect(mocks.toolGroup.setToolDisabled).toHaveBeenCalledWith('Crosshairs')
    expect(mocks.tools.ToolGroupManager.destroyToolGroup).toHaveBeenCalledOnce()
    expect(mocks.renderingEngine.destroy).toHaveBeenCalledOnce()
    expect(mocks.core.cache.removeVolumeLoadObject).toHaveBeenCalledOnce()
    expect(mocks.core.cache.removeVolumeLoadObject).toHaveBeenCalledWith(volumeId)
    expect(mocks.core.eventTarget.removeEventListener).toHaveBeenCalled()

    elements.axial.dispatchEvent(new Event('CAMERA_MODIFIED'))
    mocks.core.eventTarget.dispatchEvent(new CustomEvent('IMAGE_LOAD_ERROR', {
      detail: { error: { status: 500 }, imageId: 'a' },
    }))
    expect(callbacks.onPosition).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })
})
