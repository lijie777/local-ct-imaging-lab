import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const load = vi.fn()
  const scalarData = new Int16Array([0, 100, 200, 300, 400, 500, 600, 700])
  const volume = {
    cancelLoading: vi.fn(),
    clearLoadCallbacks: vi.fn(),
    dimensions: [100, 120, 80] as [number, number, number],
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number],
    getScalarData: vi.fn(() => scalarData),
    load,
    origin: [10, 20, 30] as [number, number, number],
    spacing: [0.7, 0.7, 1.5] as [number, number, number],
    voxelManager: {
      getCompleteScalarDataArray: vi.fn(() => scalarData),
      getRange: vi.fn(() => [-1024, 3071] as [number, number]),
    },
  }
  const volumeActor = { setVisibility: vi.fn() }
  const viewport = {
    addActor: vi.fn(),
    getCamera: vi.fn(() => ({
      focalPoint: [1, 2, 3],
      position: [4, 5, 6],
      viewPlaneNormal: [0, 1, 0],
      viewUp: [0, 0, 1],
    })),
    getDefaultActor: vi.fn(() => ({ actor: volumeActor })),
    removeActors: vi.fn(),
    render: vi.fn(),
    resetCamera: vi.fn(),
    setBlendMode: vi.fn(),
    setCamera: vi.fn(),
    setProperties: vi.fn(),
    setSlabThickness: vi.fn(),
  }
  const renderingEngine = {
    destroy: vi.fn(),
    getViewport: vi.fn(() => viewport),
    render: vi.fn(),
    resize: vi.fn(),
    setViewports: vi.fn(),
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
  const toolGroup = {
    addTool: vi.fn(),
    addViewport: vi.fn(),
    setToolActive: vi.fn(),
    setToolDisabled: vi.fn(),
  }
  const core = {
    Enums: {
      BlendModes: {
        COMPOSITE: 'composite',
        MAXIMUM_INTENSITY_BLEND: 'maximum',
      },
      Events: {
        IMAGE_LOAD_ERROR: 'IMAGE_LOAD_ERROR',
        IMAGE_LOAD_FAILED: 'IMAGE_LOAD_FAILED',
        VOLUME_LOADED_FAILED: 'VOLUME_LOADED_FAILED',
      },
      ViewportType: {
        ORTHOGRAPHIC: 'orthographic',
        VOLUME_3D: 'volume3d',
      },
    },
    RenderingEngine: vi.fn(function RenderingEngine() {
      return renderingEngine
    }),
    cache: {
      getImageLoadObject: vi.fn(() => ({ promise: Promise.resolve() })),
      getVolumeLoadObject: vi.fn<
        () => { promise: Promise<unknown> } | undefined
      >(() => ({ promise: Promise.resolve() })),
      removeImageLoadObject: vi.fn(),
      removeVolumeLoadObject: vi.fn(),
    },
    eventTarget,
    imageLoader: { loadImage: vi.fn(async () => ({})) },
    setVolumesForViewports: vi.fn(async () => undefined),
    volumeLoader: {
      createAndCacheVolume: vi.fn(async (
        _volumeId: string,
        _options: { imageIds: string[] },
      ) => volume),
    },
  }
  const tools = {
    Enums: {
      MouseBindings: {
        Auxiliary: 4,
        Primary: 1,
        Secondary: 2,
        Wheel: 524288,
      },
    },
    PanTool: { toolName: 'Pan' },
    ToolGroupManager: {
      createToolGroup: vi.fn(() => toolGroup),
      destroyToolGroup: vi.fn(),
      getToolGroup: vi.fn(() => toolGroup),
    },
    TrackballRotateTool: { toolName: 'TrackballRotate' },
    ZoomTool: { toolName: 'Zoom' },
    addTool: vi.fn(),
    store: { hasTool: vi.fn(() => false) },
  }
  const initializeCornerstone = vi.fn(async () => ({ core, loader: {}, tools }))
  const surfaceActors = [
    { setVisibility: vi.fn() },
    { setVisibility: vi.fn() },
    { setVisibility: vi.fn() },
  ]
  const surfaceDestroys = [vi.fn(), vi.fn(), vi.fn()]
  const prepareSurfaceInput = vi.fn((input: unknown) => ({ input }))
  const createSurfaceActor = vi.fn<(
    prepared: unknown,
    thresholdHu: number,
  ) => unknown>()
  createSurfaceActor.mockImplementation((_prepared: unknown, thresholdHu: number) => {
    const index = Math.min(createSurfaceActor.mock.calls.length - 1, 2)
    return {
      actor: surfaceActors[index],
      destroy: surfaceDestroys[index],
      kind: 'ready' as const,
      stride: index + 1,
      thresholdHu,
    }
  })

  return {
    abortPendingDicomLoads: vi.fn(),
    core,
    eventListeners,
    initializeCornerstone,
    renderingEngine,
    scalarData,
    createSurfaceActor,
    prepareSurfaceInput,
    surfaceActors,
    surfaceDestroys,
    toolGroup,
    tools,
    viewport,
    volume,
    volumeActor,
  }
})

vi.mock('../../axial-viewer/core/cornerstone', () => ({
  abortPendingDicomLoads: mocks.abortPendingDicomLoads,
  initializeCornerstone: mocks.initializeCornerstone,
}))

vi.mock('./surfaceReconstruction', () => ({
  createSurfaceActor: mocks.createSurfaceActor,
  prepareSurfaceInput: mocks.prepareSurfaceInput,
}))

function createElement(width = 480, height = 320): HTMLDivElement {
  const element = document.createElement('div')
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
  })
  return element
}

function createCallbacks() {
  return {
    onError: vi.fn(),
    onProgress: vi.fn(),
    onReady: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.eventListeners.clear()
  mocks.core.imageLoader.loadImage.mockImplementation(async () => ({}))
  mocks.core.volumeLoader.createAndCacheVolume.mockImplementation(async (
    _volumeId: string,
    _options: { imageIds: string[] },
  ) => mocks.volume)
  mocks.core.cache.getVolumeLoadObject.mockReturnValue({ promise: Promise.resolve() })
  mocks.core.cache.removeVolumeLoadObject.mockImplementation(() => undefined)
  mocks.initializeCornerstone.mockImplementation(async () => ({
    core: mocks.core,
    loader: {},
    tools: mocks.tools,
  }))
  mocks.renderingEngine.render.mockImplementation(() => undefined)
  mocks.renderingEngine.destroy.mockImplementation(() => undefined)
  mocks.viewport.removeActors.mockImplementation(() => undefined)
  mocks.viewport.render.mockImplementation(() => undefined)
  mocks.core.RenderingEngine.mockImplementation(function RenderingEngine() {
    return mocks.renderingEngine
  })
  mocks.tools.ToolGroupManager.createToolGroup.mockReturnValue(mocks.toolGroup)
  mocks.createSurfaceActor.mockImplementation((_prepared: unknown, thresholdHu: number) => {
    const index = Math.min(mocks.createSurfaceActor.mock.calls.length - 1, 2)
    return {
      actor: mocks.surfaceActors[index],
      destroy: mocks.surfaceDestroys[index],
      kind: 'ready' as const,
      stride: index + 1,
      thresholdHu,
    }
  })
})

describe('advanced 3D Cornerstone runtime', () => {
  it('creates one engine, one orthographic volume viewport, and one shared volume', async () => {
    const imageIds = ['a', 'b', 'c']
    const element = createElement()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')

    const runtime = await createAdvanced3dRuntime(
      { viewport: element },
      imageIds,
      createCallbacks(),
    )

    expect(mocks.core.RenderingEngine).toHaveBeenCalledOnce()
    expect(mocks.renderingEngine.setViewports).toHaveBeenCalledWith([
      expect.objectContaining({
        element,
        type: 'orthographic',
        viewportId: expect.stringMatching(/^advanced-3d-viewport-/),
      }),
    ])
    expect(mocks.core.volumeLoader.createAndCacheVolume).toHaveBeenCalledOnce()
    const [volumeId, options] = mocks.core.volumeLoader.createAndCacheVolume.mock.calls[0]
    expect(volumeId).toMatch(/^cornerstoneStreamingImageVolume:advanced-3d-/)
    expect(options).toEqual({ imageIds })
    expect(options.imageIds).not.toBe(imageIds)
    expect(mocks.core.setVolumesForViewports).toHaveBeenCalledWith(
      mocks.renderingEngine,
      [{ volumeId }],
      [expect.stringMatching(/^advanced-3d-viewport-/)],
    )

    await runtime.setMode('mip')
    await runtime.setMode('surface')
    await runtime.setMode('volume')
    expect(mocks.core.volumeLoader.createAndCacheVolume).toHaveBeenCalledOnce()
    expect(mocks.core.imageLoader.loadImage).toHaveBeenCalledTimes(imageIds.length)
  })

  it('defers the orthographic camera reset until the volume is ready', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const callbacks = createCallbacks()
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      callbacks,
    )

    runtime.resize()

    expect(mocks.renderingEngine.resize).toHaveBeenCalledOnce()
    expect(mocks.renderingEngine.resize).toHaveBeenCalledWith(true, false)
    expect(mocks.viewport.resetCamera).not.toHaveBeenCalled()

    mocks.volume.load.mock.calls[0][0]({
      framesLoaded: 2,
      framesProcessed: 2,
      totalNumFrames: 2,
    })

    expect(callbacks.onReady).toHaveBeenCalledOnce()
    expect(mocks.renderingEngine.resize).toHaveBeenCalledTimes(2)
    expect(mocks.viewport.resetCamera).toHaveBeenCalledTimes(2)

    runtime.resize()

    expect(mocks.renderingEngine.resize).toHaveBeenCalledTimes(3)
    expect(mocks.viewport.resetCamera).toHaveBeenCalledTimes(3)
  })

  it('uses the loaded volume range for MIP thickness and restores the last volume preset', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b', 'c'],
      createCallbacks(),
    )
    const maximum = Math.hypot(99 * 0.7, 119 * 0.7, 79 * 1.5)

    expect(runtime.getMipThicknessRange()).toEqual([0.7, maximum])

    runtime.setPreset('CT-Soft-Tissue')
    mocks.viewport.setProperties.mockClear()
    mocks.viewport.setSlabThickness.mockClear()

    runtime.setMipThickness(0.1)
    await runtime.setMode('mip')
    expect(mocks.viewport.setBlendMode).toHaveBeenLastCalledWith('maximum')
    expect(mocks.viewport.setProperties).toHaveBeenLastCalledWith({ preset: 'CT-MIP' })
    expect(mocks.viewport.setSlabThickness).toHaveBeenLastCalledWith(0.7)

    mocks.viewport.setProperties.mockClear()
    runtime.setPreset('CT-Lung')
    expect(mocks.viewport.setProperties).not.toHaveBeenCalled()

    runtime.setMipThickness(maximum + 100)
    expect(mocks.viewport.setSlabThickness).toHaveBeenLastCalledWith(maximum)

    await runtime.setMode('volume')
    expect(mocks.viewport.setBlendMode).toHaveBeenLastCalledWith('composite')
    expect(mocks.viewport.setProperties).toHaveBeenLastCalledWith({ preset: 'CT-Lung' })
    expect(mocks.viewport.setSlabThickness).toHaveBeenLastCalledWith(maximum)
    expect(mocks.core.volumeLoader.createAndCacheVolume).toHaveBeenCalledOnce()
    expect(mocks.core.imageLoader.loadImage).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['anterior', [0, 1, 0], [0, 0, 1]],
    ['posterior', [0, -1, 0], [0, 0, 1]],
    ['left', [1, 0, 0], [0, 0, 1]],
    ['right', [-1, 0, 0], [0, 0, 1]],
    ['superior', [0, 0, 1], [0, -1, 0]],
    ['inferior', [0, 0, -1], [0, 1, 0]],
  ] as const)('sets the %s DICOM LPS camera reproducibly', async (
    direction,
    viewPlaneNormal,
    viewUp,
  ) => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )

    mocks.viewport.resetCamera.mockClear()
    mocks.viewport.render.mockClear()
    runtime.setDirection(direction)

    expect(mocks.viewport.setCamera).toHaveBeenLastCalledWith({
      viewPlaneNormal,
      viewUp,
    })
    expect(mocks.viewport.resetCamera).toHaveBeenCalledOnce()
    expect(mocks.viewport.render).toHaveBeenCalledOnce()
  })

  it('reset restores anterior, full thickness, volume mode, and bone preset', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )
    const maximum = Math.hypot(99 * 0.7, 119 * 0.7, 79 * 1.5)

    await runtime.setMode('mip')
    runtime.setDirection('inferior')
    runtime.setMipThickness(20)
    runtime.setPreset('CT-Lung')
    mocks.viewport.setCamera.mockClear()

    runtime.reset()

    expect(mocks.viewport.setBlendMode).toHaveBeenLastCalledWith('composite')
    expect(mocks.viewport.setProperties).toHaveBeenLastCalledWith({ preset: 'CT-Bone' })
    expect(mocks.viewport.setSlabThickness).toHaveBeenLastCalledWith(maximum)
    expect(mocks.viewport.setCamera).toHaveBeenLastCalledWith({
      viewPlaneNormal: [0, 1, 0],
      viewUp: [0, 0, 1],
    })
  })

  it('enters surface by hiding the volume and showing an existing surface without computing automatically', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )

    await runtime.setMode('surface')

    expect(mocks.volumeActor.setVisibility).toHaveBeenLastCalledWith(false)
    expect(mocks.prepareSurfaceInput).not.toHaveBeenCalled()
    expect(mocks.createSurfaceActor).not.toHaveBeenCalled()

    await runtime.setSurfaceThreshold(300)
    await runtime.setMode('volume')
    expect(mocks.volumeActor.setVisibility).toHaveBeenLastCalledWith(true)
    expect(mocks.surfaceActors[0].setVisibility).toHaveBeenLastCalledWith(false)

    await runtime.setMode('surface')
    expect(mocks.volumeActor.setVisibility).toHaveBeenLastCalledWith(false)
    expect(mocks.surfaceActors[0].setVisibility).toHaveBeenLastCalledWith(true)
    expect(mocks.viewport.render).toHaveBeenCalled()
  })

  it('clamps the threshold, builds from the existing volume, and replaces only after adding the new actor', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )
    await runtime.setMode('surface')

    await expect(runtime.setSurfaceThreshold(9000)).resolves.toEqual({
      kind: 'ready',
      stride: 1,
      thresholdHu: 3071,
    })
    expect(mocks.prepareSurfaceInput).toHaveBeenCalledWith({
      dimensions: mocks.volume.dimensions,
      direction: mocks.volume.direction,
      origin: mocks.volume.origin,
      scalarData: mocks.scalarData,
      spacing: mocks.volume.spacing,
    })
    expect(mocks.createSurfaceActor).toHaveBeenCalledWith(
      expect.anything(),
      3071,
    )
    expect(mocks.viewport.getCamera).toHaveBeenCalledOnce()
    expect(mocks.viewport.setCamera).toHaveBeenCalledWith(
      mocks.viewport.getCamera.mock.results[0].value,
    )
    const firstAdd = mocks.viewport.addActor.mock.invocationCallOrder[0]

    await expect(runtime.setSurfaceThreshold(-9000)).resolves.toEqual({
      kind: 'ready',
      stride: 2,
      thresholdHu: -1024,
    })

    expect(mocks.viewport.addActor).toHaveBeenCalledTimes(2)
    const firstUid = mocks.viewport.addActor.mock.calls[0][0].uid
    const secondUid = mocks.viewport.addActor.mock.calls[1][0].uid
    expect(firstUid).not.toBe(secondUid)
    expect(mocks.viewport.addActor).toHaveBeenNthCalledWith(1, {
      actor: mocks.surfaceActors[0],
      uid: expect.stringMatching(/^advanced-3d-surface-/),
    })
    expect(mocks.viewport.addActor).toHaveBeenNthCalledWith(2, {
      actor: mocks.surfaceActors[1],
      uid: expect.stringMatching(/^advanced-3d-surface-/),
    })
    expect(mocks.viewport.removeActors).toHaveBeenCalledWith([firstUid])
    expect(mocks.surfaceDestroys[0]).toHaveBeenCalledOnce()
    expect(mocks.viewport.setCamera).toHaveBeenCalledTimes(3)
    expect(mocks.viewport.setCamera.mock.invocationCallOrder[2]).toBeGreaterThan(
      mocks.viewport.removeActors.mock.invocationCallOrder[0],
    )
    expect(mocks.viewport.addActor.mock.invocationCallOrder[1]).toBeGreaterThan(firstAdd)
    expect(mocks.viewport.addActor.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.viewport.removeActors.mock.invocationCallOrder[0],
    )
  })

  it('uses the streaming voxel manager when the volume has no contiguous scalar array', async () => {
    mocks.volume.getScalarData.mockImplementationOnce(() => {
      throw new Error('No scalar data available')
    })
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )

    await runtime.setSurfaceThreshold(300)

    expect(mocks.volume.voxelManager.getCompleteScalarDataArray).toHaveBeenCalledOnce()
    expect(mocks.prepareSurfaceInput).toHaveBeenCalledWith(
      expect.objectContaining({ scalarData: mocks.scalarData }),
    )
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite surface thresholds without allocating a surface pipeline',
    async (threshold) => {
      const callbacks = createCallbacks()
      const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
      const runtime = await createAdvanced3dRuntime(
        { viewport: createElement() },
        ['a', 'b'],
        callbacks,
      )

      await expect(runtime.setSurfaceThreshold(threshold)).rejects.toThrow(
        '无法重建表面，请调整阈值或切换其他模式',
      )
      expect(mocks.prepareSurfaceInput).not.toHaveBeenCalled()
      expect(mocks.createSurfaceActor).not.toHaveBeenCalled()
      expect(callbacks.onError).not.toHaveBeenCalled()
    },
  )

  it('keeps the old surface on empty output and isolates surface-specific failures from runtime callbacks', async () => {
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      callbacks,
    )
    await runtime.setMode('surface')
    await runtime.setSurfaceThreshold(300)
    const firstUid = mocks.viewport.addActor.mock.calls[0][0].uid

    mocks.createSurfaceActor.mockReturnValueOnce({
      kind: 'empty',
      stride: 2,
      thresholdHu: 400,
    })
    await expect(runtime.setSurfaceThreshold(400)).resolves.toEqual({
      kind: 'empty',
      stride: 2,
      thresholdHu: 400,
    })
    expect(mocks.viewport.removeActors).not.toHaveBeenCalledWith([firstUid])
    expect(mocks.surfaceDestroys[0]).not.toHaveBeenCalled()

    mocks.prepareSurfaceInput.mockImplementationOnce(() => {
      throw new Error('private scalar failure')
    })
    await expect(runtime.setSurfaceThreshold(500)).rejects.toThrow(
      '无法重建表面，请调整阈值或切换其他模式',
    )
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(mocks.volume.cancelLoading).not.toHaveBeenCalled()
    expect(mocks.viewport.removeActors).not.toHaveBeenCalledWith([firstUid])
    expect(mocks.surfaceDestroys[0]).not.toHaveBeenCalled()

    mocks.viewport.render.mockImplementationOnce(() => {
      throw new Error('private surface render failure')
    })
    await expect(runtime.setSurfaceThreshold(600)).rejects.toThrow(
      '无法重建表面，请调整阈值或切换其他模式',
    )
    expect(mocks.viewport.removeActors).not.toHaveBeenCalledWith([firstUid])
    expect(mocks.surfaceDestroys[0]).not.toHaveBeenCalled()
    expect(mocks.surfaceDestroys[2]).toHaveBeenCalledOnce()

    await runtime.setMode('mip')
    expect(mocks.volumeActor.setVisibility).toHaveBeenLastCalledWith(true)
  })

  it('reset removes the surface and destroy releases it before tools and engine', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )
    await runtime.setMode('surface')
    await runtime.setSurfaceThreshold(300)
    const firstUid = mocks.viewport.addActor.mock.calls[0][0].uid

    runtime.reset()

    expect(mocks.viewport.removeActors).toHaveBeenCalledWith([firstUid])
    expect(mocks.surfaceDestroys[0]).toHaveBeenCalledOnce()
    expect(mocks.volumeActor.setVisibility).toHaveBeenLastCalledWith(true)
    expect(mocks.viewport.setProperties).toHaveBeenLastCalledWith({ preset: 'CT-Bone' })

    await runtime.setMode('surface')
    await runtime.setSurfaceThreshold(300)
    runtime.destroy()

    expect(mocks.surfaceDestroys[1]).toHaveBeenCalledOnce()
    expect(mocks.surfaceDestroys[1].mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tools.ToolGroupManager.destroyToolGroup.mock.invocationCallOrder[0],
    )
    expect(mocks.surfaceDestroys[1].mock.invocationCallOrder[0]).toBeLessThan(
      mocks.renderingEngine.destroy.mock.invocationCallOrder[0],
    )
  })

  it('defers a new surface after render and detach both fail, while preserving the old surface', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )
    await runtime.setMode('surface')
    await runtime.setSurfaceThreshold(300)

    mocks.viewport.render.mockImplementationOnce(() => {
      throw new Error('surface render failed')
    })
    mocks.viewport.removeActors.mockImplementationOnce(() => {
      throw new Error('surface detach failed')
    })

    await expect(runtime.setSurfaceThreshold(400)).rejects.toThrow(
      '无法重建表面，请调整阈值或切换其他模式',
    )
    expect(mocks.surfaceActors[1].setVisibility).toHaveBeenLastCalledWith(false)
    expect(mocks.surfaceDestroys[0]).not.toHaveBeenCalled()
    expect(mocks.surfaceDestroys[1]).not.toHaveBeenCalled()

    runtime.destroy()

    expect(mocks.surfaceDestroys[0]).toHaveBeenCalledOnce()
    expect(mocks.renderingEngine.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.surfaceDestroys[1].mock.invocationCallOrder[0],
    )
  })

  it('hides and defers an old surface when replacement detach fails', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )
    await runtime.setMode('surface')
    await runtime.setSurfaceThreshold(300)
    mocks.viewport.removeActors.mockImplementationOnce(() => {
      throw new Error('old surface detach failed')
    })

    await runtime.setSurfaceThreshold(400)

    expect(mocks.surfaceActors[0].setVisibility).toHaveBeenLastCalledWith(false)
    expect(mocks.surfaceDestroys[0]).not.toHaveBeenCalled()

    runtime.destroy()

    expect(mocks.surfaceDestroys[1]).toHaveBeenCalledOnce()
    expect(mocks.renderingEngine.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.surfaceDestroys[0].mock.invocationCallOrder[0],
    )
  })

  it('defers a surface on reset detach failure until after engine destruction', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )
    await runtime.setMode('surface')
    await runtime.setSurfaceThreshold(300)
    mocks.viewport.removeActors.mockImplementationOnce(() => {
      throw new Error('reset detach failed')
    })

    runtime.reset()

    expect(mocks.surfaceActors[0].setVisibility).toHaveBeenLastCalledWith(false)
    expect(mocks.surfaceDestroys[0]).not.toHaveBeenCalled()

    runtime.destroy()

    expect(mocks.renderingEngine.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.surfaceDestroys[0].mock.invocationCallOrder[0],
    )
  })

  it('destroys a surface only after the engine when final detach fails', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )
    await runtime.setMode('surface')
    await runtime.setSurfaceThreshold(300)
    mocks.viewport.removeActors.mockImplementationOnce(() => {
      throw new Error('destroy detach failed')
    })

    runtime.destroy()

    expect(mocks.surfaceActors[0].setVisibility).toHaveBeenLastCalledWith(false)
    expect(mocks.renderingEngine.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.surfaceDestroys[0].mock.invocationCallOrder[0],
    )
  })

  it('reports progress, waits for every loaded frame, then applies the default volume rendering', async () => {
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b', 'c'],
      callbacks,
    )
    const loadCallback = mocks.volume.load.mock.calls[0][0]

    loadCallback({ framesLoaded: 1, framesProcessed: 1, totalNumFrames: 3 })
    expect(callbacks.onProgress).toHaveBeenLastCalledWith({
      loaded: 1,
      processed: 1,
      total: 3,
    })
    expect(callbacks.onReady).not.toHaveBeenCalled()

    loadCallback({ framesLoaded: 3, framesProcessed: 3, totalNumFrames: 3 })
    expect(mocks.viewport.setBlendMode).toHaveBeenCalledWith('composite')
    expect(mocks.viewport.setProperties).toHaveBeenCalledWith({ preset: 'CT-Bone' })
    expect(mocks.viewport.setSlabThickness).toHaveBeenCalledWith(
      Math.hypot(99 * 0.7, 119 * 0.7, 79 * 1.5),
    )
    expect(mocks.viewport.resetCamera).toHaveBeenCalledTimes(2)
    expect(callbacks.onReady).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('treats fully processed but partially loaded frames as a safe runtime error', async () => {
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b', 'c'],
      callbacks,
    )

    mocks.volume.load.mock.calls[0][0]({
      framesLoaded: 2,
      framesProcessed: 3,
      totalNumFrames: 3,
    })

    expect(callbacks.onReady).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenCalledWith(
      '无法构建高级 3D，请重试或返回轴位查看器',
    )
  })

  it('binds TrackballRotate to left, Pan to middle, and Zoom to right plus wheel', async () => {
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      createCallbacks(),
    )

    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('TrackballRotate', {
      bindings: [{ mouseButton: 1 }],
    })
    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('Pan', {
      bindings: [{ mouseButton: 4 }],
    })
    expect(mocks.toolGroup.setToolActive).toHaveBeenCalledWith('Zoom', {
      bindings: [{ mouseButton: 2 }, { mouseButton: 524288 }],
    })
  })

  it.each([
    [{ status: 410 }, '本机 DICOM 文件缺失，请恢复文件后重试'],
    [{ request: { status: 0 } }, '无法连接本机服务，请确认服务已启动'],
    [new Error(String.raw`WebGL codec C:\private\stack`), '无法构建高级 3D，请重试或返回轴位查看器'],
  ])('maps runtime failures to a stable safe message', async (error, expected) => {
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      callbacks,
    )

    mocks.core.eventTarget.dispatchEvent(new CustomEvent('IMAGE_LOAD_FAILED', {
      detail: { error, imageId: 'b' },
    }))

    expect(callbacks.onError).toHaveBeenCalledWith(expected)
    expect(callbacks.onError.mock.calls.flat().join(' ')).not.toMatch(
      /private|volume.?id|webgl|codec|stack/i,
    )
  })

  it('filters volume errors by the owned id', async () => {
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      callbacks,
    )
    const volumeId = mocks.core.volumeLoader.createAndCacheVolume.mock.calls[0][0]

    mocks.core.eventTarget.dispatchEvent(new CustomEvent('VOLUME_LOADED_FAILED', {
      detail: { error: new Error('WebGL failed'), volumeId: 'another-volume' },
    }))
    expect(callbacks.onError).not.toHaveBeenCalled()

    mocks.core.eventTarget.dispatchEvent(new CustomEvent('VOLUME_LOADED_FAILED', {
      detail: { error: new Error('WebGL failed'), volumeId },
    }))
    expect(callbacks.onError).toHaveBeenCalledWith(
      '无法构建高级 3D，请重试或返回轴位查看器',
    )
  })

  it('rejects empty or zero-size elements without exposing internal details', async () => {
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')

    await expect(createAdvanced3dRuntime(
      { viewport: createElement(0, 320) },
      ['a'],
      callbacks,
    )).rejects.toThrow('无法构建高级 3D，请重试或返回轴位查看器')
    expect(callbacks.onError).toHaveBeenCalledWith(
      '无法构建高级 3D，请重试或返回轴位查看器',
    )
    expect(mocks.core.RenderingEngine).not.toHaveBeenCalled()
  })

  it('maps RenderingEngine constructor failures to the generic safe error', async () => {
    mocks.core.RenderingEngine.mockImplementationOnce(function RenderingEngine() {
      throw new Error(String.raw`WebGL failed at C:\private\renderer`)
    })
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')

    await expect(createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a'],
      callbacks,
    )).rejects.toThrow('无法构建高级 3D，请重试或返回轴位查看器')
    expect(callbacks.onError).toHaveBeenCalledWith(
      '无法构建高级 3D，请重试或返回轴位查看器',
    )
    const visibleErrors = [
      callbacks.onError.mock.calls.flat().join(' '),
    ].join(' ')
    expect(visibleErrors).not.toMatch(/private|webgl|renderer|\\/i)
  })

  it('honors AbortSignal before creation and suppresses runtime errors', async () => {
    const controller = new AbortController()
    controller.abort()
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')

    await expect(createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a'],
      callbacks,
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.core.RenderingEngine).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('retries pending cache removal after an aborted volume resolves', async () => {
    let cacheEntryPresent = true
    let volumeResolved = false
    let resolveVolume!: (volume: typeof mocks.volume) => void
    const deferredVolume = new Promise<typeof mocks.volume>((resolve) => {
      resolveVolume = resolve
    })
    mocks.core.volumeLoader.createAndCacheVolume.mockImplementationOnce(
      (_volumeId: string, _options: { imageIds: string[] }) => deferredVolume,
    )
    mocks.core.cache.getVolumeLoadObject.mockImplementation(
      () => cacheEntryPresent ? { promise: deferredVolume } : undefined,
    )
    mocks.core.cache.removeVolumeLoadObject.mockImplementation(() => {
      if (volumeResolved) {
        cacheEntryPresent = false
      }
    })
    const controller = new AbortController()
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')

    const runtimePromise = createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      callbacks,
      controller.signal,
    )
    const aborted = expect(runtimePromise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => {
      expect(mocks.core.volumeLoader.createAndCacheVolume).toHaveBeenCalledOnce()
    })
    const volumeId = mocks.core.volumeLoader.createAndCacheVolume.mock.calls[0][0]

    controller.abort()
    expect(mocks.core.cache.removeVolumeLoadObject).toHaveBeenCalledOnce()
    expect(cacheEntryPresent).toBe(true)
    volumeResolved = true
    resolveVolume(mocks.volume)
    await aborted

    expect(mocks.volume.cancelLoading).toHaveBeenCalledOnce()
    expect(mocks.volume.clearLoadCallbacks).toHaveBeenCalledOnce()
    expect(mocks.core.cache.removeVolumeLoadObject).toHaveBeenCalledTimes(2)
    expect(mocks.core.cache.removeVolumeLoadObject).toHaveBeenNthCalledWith(1, volumeId)
    expect(mocks.core.cache.removeVolumeLoadObject).toHaveBeenNthCalledWith(2, volumeId)
    expect(cacheEntryPresent).toBe(false)
    expect(mocks.renderingEngine.destroy).toHaveBeenCalledOnce()
    expect(callbacks.onProgress).not.toHaveBeenCalled()
    expect(callbacks.onReady).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('destroys all owned resources idempotently and ignores late callbacks', async () => {
    const controller = new AbortController()
    const callbacks = createCallbacks()
    const { createAdvanced3dRuntime } = await import('./advanced3dCornerstone')
    const runtime = await createAdvanced3dRuntime(
      { viewport: createElement() },
      ['a', 'b'],
      callbacks,
      controller.signal,
    )
    const volumeId = mocks.core.volumeLoader.createAndCacheVolume.mock.calls[0][0]
    const loadCallback = mocks.volume.load.mock.calls[0][0]

    controller.abort()
    runtime.destroy()
    runtime.destroy()
    loadCallback({ framesLoaded: 2, framesProcessed: 2, totalNumFrames: 2 })
    mocks.core.eventTarget.dispatchEvent(new CustomEvent('IMAGE_LOAD_ERROR', {
      detail: { error: { status: 410 }, imageId: 'a' },
    }))

    expect(mocks.abortPendingDicomLoads).toHaveBeenCalledOnce()
    expect(mocks.abortPendingDicomLoads).toHaveBeenCalledWith(['a', 'b'])
    expect(mocks.volume.cancelLoading).toHaveBeenCalledOnce()
    expect(mocks.volume.clearLoadCallbacks).toHaveBeenCalledOnce()
    expect(mocks.tools.ToolGroupManager.destroyToolGroup).toHaveBeenCalledOnce()
    expect(mocks.renderingEngine.destroy).toHaveBeenCalledOnce()
    expect(mocks.core.cache.removeVolumeLoadObject).toHaveBeenCalledOnce()
    expect(mocks.core.cache.removeVolumeLoadObject).toHaveBeenCalledWith(volumeId)
    expect(mocks.core.eventTarget.removeEventListener).toHaveBeenCalledTimes(3)
    expect(callbacks.onReady).not.toHaveBeenCalled()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })
})
