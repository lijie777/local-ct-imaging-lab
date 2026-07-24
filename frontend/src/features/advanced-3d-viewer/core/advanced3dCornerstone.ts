import {
  abortPendingDicomLoads,
  initializeCornerstone,
} from '../../axial-viewer/core/cornerstone'
import {
  clampSurfaceThreshold,
  volumeDiagonalMm,
  type Advanced3dMode,
  type StandardViewDirection,
  type VolumePreset,
} from '../model/advanced3dViewer'
import {
  createSurfaceActor,
  prepareSurfaceInput,
  type SurfaceActorResult,
} from './surfaceReconstruction'
import type {
  Advanced3dRuntime,
  Advanced3dRuntimeCallbacks,
  Advanced3dRuntimeElements,
  SurfaceResult,
} from './advanced3dRuntimeTypes'

export type {
  Advanced3dRuntime,
  Advanced3dRuntimeCallbacks,
  Advanced3dRuntimeElements,
  Advanced3dRuntimeProgress,
  SurfaceResult,
} from './advanced3dRuntimeTypes'

interface VolumeLoadResult {
  framesLoaded?: number
  framesProcessed?: number
  totalNumFrames?: number
}

interface StreamingVolume {
  cancelLoading?(): void
  clearLoadCallbacks?(): void
  dimensions: readonly number[]
  direction: readonly number[]
  getScalarData(): ArrayLike<number>
  load(callback: (result: VolumeLoadResult) => void): void
  origin: readonly number[]
  spacing: readonly number[]
  voxelManager?: {
    getCompleteScalarDataArray?(): ArrayLike<number>
    getRange?(): readonly [number, number]
  }
}

interface VisibilityActor {
  setVisibility(visible: boolean): void
}

interface Advanced3dCamera {
  [key: string]: unknown
  viewPlaneNormal: readonly [number, number, number]
  viewUp: readonly [number, number, number]
}

interface Advanced3dViewport {
  addActor(entry: { actor: unknown; uid: string }): void
  getCamera(): Advanced3dCamera
  getDefaultActor(): { actor?: VisibilityActor } | undefined
  removeActors(actorUids: string[]): void
  render(): void
  resetCamera(): void
  setBlendMode(mode: unknown): void
  setCamera(camera: Advanced3dCamera): void
  setProperties(properties: { preset?: string }): void
  setSlabThickness(thickness: number): void
}

const MIP_CAMERAS: Record<StandardViewDirection, {
  viewPlaneNormal: readonly [number, number, number]
  viewUp: readonly [number, number, number]
}> = {
  anterior: { viewPlaneNormal: [0, 1, 0], viewUp: [0, 0, 1] },
  inferior: { viewPlaneNormal: [0, 0, -1], viewUp: [0, 1, 0] },
  left: { viewPlaneNormal: [1, 0, 0], viewUp: [0, 0, 1] },
  posterior: { viewPlaneNormal: [0, -1, 0], viewUp: [0, 0, 1] },
  right: { viewPlaneNormal: [-1, 0, 0], viewUp: [0, 0, 1] },
  superior: { viewPlaneNormal: [0, 0, 1], viewUp: [0, -1, 0] },
}

const RENDERING_ENGINE_PREFIX = 'advanced-3d-rendering-'
const VIEWPORT_PREFIX = 'advanced-3d-viewport-'
const TOOL_GROUP_PREFIX = 'advanced-3d-tools-'
const VOLUME_PREFIX = 'cornerstoneStreamingImageVolume:advanced-3d-'
const runtimeErrorMessage = '无法构建高级 3D，请重试或返回轴位查看器'
const missingFileMessage = '本机 DICOM 文件缺失，请恢复文件后重试'
const serviceUnavailableMessage = '无法连接本机服务，请确认服务已启动'
const surfaceErrorMessage = '无法重建表面，请调整阈值或切换其他模式'
const registeredTools = new Set<string>()
let runtimeSequence = 0

function abortError(): DOMException {
  return new DOMException('Advanced 3D runtime creation cancelled', 'AbortError')
}

function safeCall(action: () => void): void {
  try {
    action()
  } catch {
    // Cleanup is best-effort and later resource owners must still run.
  }
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  const directStatus = (error as { status?: unknown }).status
  if (typeof directStatus === 'number') {
    return directStatus
  }
  const requestStatus = (error as { request?: { status?: unknown } }).request?.status
  return typeof requestStatus === 'number' ? requestStatus : undefined
}

function toSafeRuntimeError(error: unknown): string {
  const status = errorStatus(error)
  if (status === 410) {
    return missingFileMessage
  }
  if (status === 0) {
    return serviceUnavailableMessage
  }
  return runtimeErrorMessage
}

function validElement(element: HTMLDivElement): boolean {
  return element.clientWidth > 0 && element.clientHeight > 0
}

function validRange(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item)) &&
    value[0] <= value[1]
}

function surfaceScalarData(volume: StreamingVolume): ArrayLike<number> {
  return volume.voxelManager?.getCompleteScalarDataArray?.() ?? volume.getScalarData()
}

export async function createAdvanced3dRuntime(
  elements: Advanced3dRuntimeElements,
  imageIds: readonly string[],
  callbacks: Advanced3dRuntimeCallbacks,
  signal?: AbortSignal,
): Promise<Advanced3dRuntime> {
  if (signal?.aborted) {
    throw abortError()
  }
  if (imageIds.length === 0 || !validElement(elements.viewport)) {
    callbacks.onError(runtimeErrorMessage)
    throw new Error(runtimeErrorMessage)
  }

  let modules: Awaited<ReturnType<typeof initializeCornerstone>>
  try {
    modules = await initializeCornerstone()
  } catch (error) {
    if (signal?.aborted) {
      throw abortError()
    }
    const message = toSafeRuntimeError(error)
    callbacks.onError(message)
    throw new Error(message)
  }
  if (signal?.aborted) {
    throw abortError()
  }

  const { core, tools } = modules
  runtimeSequence += 1
  const suffix = `${runtimeSequence}`
  const renderingEngineId = `${RENDERING_ENGINE_PREFIX}${suffix}`
  const viewportId = `${VIEWPORT_PREFIX}${suffix}`
  const toolGroupId = `${TOOL_GROUP_PREFIX}${suffix}`
  const volumeId = `${VOLUME_PREFIX}${suffix}`
  let renderingEngine: import('@cornerstonejs/core').RenderingEngine | null = null
  let runtimeViewport: Advanced3dViewport | null = null
  let volume: StreamingVolume | null = null
  let toolGroupCreated = false
  let destroyed = false
  let cancelled = false
  let loadSettled = false
  let failureMessage: string | null = null
  let mode: Advanced3dMode = 'volume'
  let preset: VolumePreset = 'CT-Bone'
  let direction: StandardViewDirection = 'anterior'
  let mipThicknessMm = 0
  let surfaceSequence = 0
  type SurfaceResource = Extract<SurfaceActorResult, { kind: 'ready' }>
  interface OwnedSurface {
    resource: SurfaceResource
    uid: string
  }
  let surface: OwnedSurface | null = null
  const deferredSurfaceResources = new Set<SurfaceResource>()
  const runtimeEventListeners: Array<{
    listener: EventListener
    type: string
  }> = []

  function removeVolumeCache(): void {
    safeCall(() => {
      if (core.cache.getVolumeLoadObject(volumeId) !== undefined) {
        core.cache.removeVolumeLoadObject(volumeId)
      }
    })
  }

  function releaseVolume(
    target: StreamingVolume,
    removeCacheAfterRelease = true,
  ): void {
    safeCall(() => target.cancelLoading?.())
    safeCall(() => target.clearLoadCallbacks?.())
    if (removeCacheAfterRelease) {
      removeVolumeCache()
    }
  }

  function detachSurface(target: OwnedSurface): void {
    let detached = false
    try {
      if (runtimeViewport !== null) {
        runtimeViewport.removeActors([target.uid])
        detached = true
      }
    } catch {
      // Keep the actor alive until its owning rendering engine is destroyed.
    }
    if (detached) {
      safeCall(() => target.resource.destroy())
      return
    }
    safeCall(() => target.resource.actor.setVisibility(false))
    deferredSurfaceResources.add(target.resource)
  }

  function destroyRuntime(): void {
    if (destroyed) {
      return
    }
    destroyed = true
    signal?.removeEventListener('abort', cancelAndDestroy)
    for (const { listener, type } of runtimeEventListeners) {
      safeCall(() => core.eventTarget.removeEventListener(type, listener))
    }
    safeCall(() => abortPendingDicomLoads(imageIds))
    const ownedSurface = surface
    surface = null
    if (ownedSurface !== null) {
      detachSurface(ownedSurface)
    }
    const ownedVolume = volume
    volume = null
    if (ownedVolume !== null) {
      releaseVolume(ownedVolume, false)
    }
    if (toolGroupCreated) {
      for (const toolName of [
        tools.TrackballRotateTool.toolName,
        tools.PanTool.toolName,
        tools.ZoomTool.toolName,
      ]) {
        safeCall(() => tools.ToolGroupManager.getToolGroup(toolGroupId)?.setToolDisabled(toolName))
      }
      safeCall(() => tools.ToolGroupManager.destroyToolGroup(toolGroupId))
    }
    const ownedRenderingEngine = renderingEngine
    renderingEngine = null
    safeCall(() => ownedRenderingEngine?.destroy())
    for (const deferredResource of deferredSurfaceResources) {
      safeCall(() => deferredResource.destroy())
    }
    deferredSurfaceResources.clear()
    removeVolumeCache()
  }

  function cancelAndDestroy(): void {
    cancelled = true
    destroyRuntime()
  }

  function ensureActive(): void {
    if (cancelled || signal?.aborted) {
      throw abortError()
    }
  }

  function reportRuntimeFailure(message: string): void {
    if (destroyed || failureMessage !== null) {
      return
    }
    failureMessage = message
    callbacks.onError(message)
  }

  signal?.addEventListener('abort', cancelAndDestroy, { once: true })

  const handleImageFailure: EventListener = (event) => {
    const detail = (event as CustomEvent<{
      error?: unknown
      imageId?: unknown
    }>).detail
    const failedImageId = detail?.imageId
    const belongsToRuntime = typeof failedImageId === 'number'
      ? Number.isFinite(failedImageId)
      : typeof failedImageId === 'string' && imageIds.includes(failedImageId)
    if (belongsToRuntime) {
      reportRuntimeFailure(toSafeRuntimeError(detail?.error))
    }
  }

  const handleVolumeFailure: EventListener = (event) => {
    const detail = (event as CustomEvent<{
      error?: unknown
      volumeId?: unknown
    }>).detail
    if (detail?.volumeId === volumeId) {
      reportRuntimeFailure(toSafeRuntimeError(detail.error))
    }
  }

  for (const [type, listener] of [
    [core.Enums.Events.IMAGE_LOAD_FAILED, handleImageFailure],
    [core.Enums.Events.IMAGE_LOAD_ERROR, handleImageFailure],
    [core.Enums.Events.VOLUME_LOADED_FAILED, handleVolumeFailure],
  ] as const) {
    core.eventTarget.addEventListener(type, listener)
    runtimeEventListeners.push({ listener, type })
  }

  try {
    renderingEngine = new core.RenderingEngine(renderingEngineId)
    const activeRenderingEngine = renderingEngine
    activeRenderingEngine.setViewports([{
      defaultOptions: { background: [0, 0, 0] as [number, number, number] },
      element: elements.viewport,
      type: core.Enums.ViewportType.ORTHOGRAPHIC,
      viewportId,
    }])

    await Promise.all(imageIds.map((imageId) => core.imageLoader.loadImage(imageId)))
    ensureActive()
    for (const imageId of imageIds) {
      if (core.cache.getImageLoadObject(imageId) !== undefined) {
        core.cache.removeImageLoadObject(imageId, { force: true })
      }
    }

    const createdVolume = await core.volumeLoader.createAndCacheVolume(volumeId, {
      imageIds: [...imageIds],
    }) as unknown as StreamingVolume
    if (destroyed || cancelled || signal?.aborted) {
      releaseVolume(createdVolume)
      throw abortError()
    }
    volume = createdVolume
    await core.setVolumesForViewports(
      activeRenderingEngine,
      [{ volumeId }],
      [viewportId],
    )
    ensureActive()

    const viewport = activeRenderingEngine.getViewport<Advanced3dViewport>(viewportId)
    runtimeViewport = viewport
    const volumeActor = viewport.getDefaultActor()?.actor
    if (volumeActor === undefined) {
      throw new Error(runtimeErrorMessage)
    }
    const ownedVolumeActor: VisibilityActor = volumeActor
    const maxThickness = volumeDiagonalMm(volume.dimensions, volume.spacing)
    const positiveSpacing = volume.spacing.filter(
      (value) => Number.isFinite(value) && value > 0,
    )
    const minThickness = positiveSpacing.length > 0
      ? Math.min(...positiveSpacing)
      : maxThickness
    const mipThicknessRange = [minThickness, maxThickness] as const
    mipThicknessMm = maxThickness

    const toolClasses = [
      tools.TrackballRotateTool,
      tools.PanTool,
      tools.ZoomTool,
    ]
    for (const toolClass of toolClasses) {
      const globallyRegistered = typeof tools.store?.hasTool === 'function' &&
        tools.store.hasTool(toolClass.toolName)
      if (!globallyRegistered && !registeredTools.has(toolClass.toolName)) {
        tools.addTool(toolClass)
      }
      registeredTools.add(toolClass.toolName)
    }
    const toolGroup = tools.ToolGroupManager.createToolGroup(toolGroupId)
    if (toolGroup === undefined) {
      throw new Error(runtimeErrorMessage)
    }
    toolGroupCreated = true
    for (const toolClass of toolClasses) {
      toolGroup.addTool(toolClass.toolName)
    }
    toolGroup.addViewport(viewportId, renderingEngineId)
    toolGroup.setToolActive(tools.TrackballRotateTool.toolName, {
      bindings: [{ mouseButton: tools.Enums.MouseBindings.Primary }],
    })
    toolGroup.setToolActive(tools.PanTool.toolName, {
      bindings: [{ mouseButton: tools.Enums.MouseBindings.Auxiliary }],
    })
    toolGroup.setToolActive(tools.ZoomTool.toolName, {
      bindings: [
        { mouseButton: tools.Enums.MouseBindings.Secondary },
        { mouseButton: tools.Enums.MouseBindings.Wheel },
      ],
    })

    function setViewportDirection(value: StandardViewDirection): void {
      viewport.setCamera(MIP_CAMERAS[value])
      viewport.resetCamera()
    }

    function applyDefaultVolume(): void {
      ownedVolumeActor.setVisibility(true)
      surface?.resource.actor.setVisibility(false)
      viewport.setBlendMode(core.Enums.BlendModes.COMPOSITE)
      viewport.setProperties({ preset })
      viewport.setSlabThickness(maxThickness)
      setViewportDirection(direction)
      viewport.render()
    }

    function clampedMipThickness(value: number): number {
      if (Number.isNaN(value)) {
        return mipThicknessMm
      }
      return Math.min(maxThickness, Math.max(minThickness, value))
    }

    function removeSurface(): void {
      const ownedSurface = surface
      surface = null
      if (ownedSurface === null) {
        return
      }
      detachSurface(ownedSurface)
    }

    function resizeViewport(): void {
      activeRenderingEngine.resize(true, false)
      if (loadSettled) {
        viewport.resetCamera()
        viewport.render()
      }
    }

    volume.load((result) => {
      if (destroyed || failureMessage !== null || loadSettled) {
        return
      }
      const loaded = result.framesLoaded ?? 0
      const processed = result.framesProcessed ?? 0
      const total = result.totalNumFrames ?? imageIds.length
      callbacks.onProgress({ loaded, processed, total })
      if (processed !== total) {
        return
      }
      loadSettled = true
      if (loaded !== total) {
        reportRuntimeFailure(runtimeErrorMessage)
        return
      }
      try {
        applyDefaultVolume()
        resizeViewport()
        callbacks.onReady()
      } catch {
        reportRuntimeFailure(runtimeErrorMessage)
      }
    })
    activeRenderingEngine.render()

    function getSurfaceRange(): readonly [number, number] {
      const range = volume?.voxelManager?.getRange?.()
      return validRange(range) ? [range[0], range[1]] : [0, 0]
    }

    return {
      destroy: cancelAndDestroy,
      getMipThicknessRange: () => mipThicknessRange,
      getSurfaceRange,
      reset: () => {
        if (destroyed) {
          return
        }
        mode = 'volume'
        preset = 'CT-Bone'
        direction = 'anterior'
        mipThicknessMm = maxThickness
        removeSurface()
        applyDefaultVolume()
      },
      resize: () => {
        if (!destroyed) {
          resizeViewport()
        }
      },
      setDirection: (value) => {
        if (destroyed) {
          return
        }
        direction = value
        setViewportDirection(value)
        viewport.render()
      },
      setMipThickness: (value) => {
        if (destroyed) {
          return
        }
        mipThicknessMm = clampedMipThickness(value)
        if (mode === 'mip') {
          viewport.setSlabThickness(mipThicknessMm)
          viewport.render()
        }
      },
      setMode: async (value) => {
        if (destroyed) {
          return
        }
        mode = value
        if (mode === 'mip') {
          ownedVolumeActor.setVisibility(true)
          surface?.resource.actor.setVisibility(false)
          viewport.setBlendMode(core.Enums.BlendModes.MAXIMUM_INTENSITY_BLEND)
          viewport.setProperties({ preset: 'CT-MIP' })
          viewport.setSlabThickness(mipThicknessMm)
          viewport.render()
        } else if (mode === 'volume') {
          ownedVolumeActor.setVisibility(true)
          surface?.resource.actor.setVisibility(false)
          viewport.setBlendMode(core.Enums.BlendModes.COMPOSITE)
          viewport.setProperties({ preset })
          viewport.setSlabThickness(maxThickness)
          viewport.render()
        } else {
          ownedVolumeActor.setVisibility(false)
          surface?.resource.actor.setVisibility(true)
          viewport.render()
        }
      },
      setPreset: (value) => {
        if (destroyed) {
          return
        }
        preset = value
        if (mode === 'volume') {
          viewport.setProperties({ preset })
          viewport.render()
        }
      },
      setSurfaceThreshold: async (threshold): Promise<SurfaceResult> => {
        if (destroyed || volume === null) {
          throw new Error(surfaceErrorMessage)
        }
        const range = getSurfaceRange()
        try {
          const thresholdHu = clampSurfaceThreshold(threshold, range)
          const prepared = prepareSurfaceInput({
            dimensions: volume.dimensions,
            direction: volume.direction,
            origin: volume.origin,
            scalarData: surfaceScalarData(volume),
            spacing: volume.spacing,
          })
          const result = createSurfaceActor(prepared, thresholdHu)
          if (result.kind === 'empty') {
            return {
              kind: 'empty',
              stride: result.stride,
              thresholdHu: result.thresholdHu,
            }
          }

          surfaceSequence += 1
          const uid = `advanced-3d-surface-${suffix}-${surfaceSequence}`
          const nextSurface = { resource: result, uid }
          result.actor.setVisibility(mode === 'surface')
          try {
            viewport.addActor({ actor: result.actor, uid })
            viewport.setCamera(viewport.getCamera())
            viewport.render()
          } catch (error) {
            detachSurface(nextSurface)
            throw error
          }

          const oldSurface = surface
          surface = nextSurface
          if (oldSurface !== null) {
            detachSurface(oldSurface)
            safeCall(() => viewport.setCamera(viewport.getCamera()))
            safeCall(() => viewport.render())
          }
          return {
            kind: 'ready',
            stride: result.stride,
            thresholdHu: result.thresholdHu,
          }
        } catch {
          throw new Error(surfaceErrorMessage)
        }
      },
    }
  } catch (error) {
    destroyRuntime()
    if (cancelled || signal?.aborted) {
      throw abortError()
    }
    const message = toSafeRuntimeError(error)
    callbacks.onError(message)
    throw new Error(message)
  }
}
