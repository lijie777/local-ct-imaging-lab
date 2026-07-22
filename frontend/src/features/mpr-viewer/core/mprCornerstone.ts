import {
  abortPendingDicomLoads,
  initializeCornerstone,
} from '../../axial-viewer/core/cornerstone'
import type {
  MprTool,
  MprViewportId,
  MprViewportOrientation,
  Point3,
} from '../model/mprViewer'


export interface MprRuntimeElements {
  axial: HTMLDivElement
  coronal: HTMLDivElement
  sagittal: HTMLDivElement
}

export interface MprRuntimeProgress {
  loaded: number
  processed: number
  total: number
}

export interface MprRuntimeCallbacks {
  onActiveViewport(viewport: MprViewportId): void
  onError(message: string): void
  onOrientation?(
    viewport: MprViewportId,
    orientation: MprViewportOrientation,
  ): void
  onPosition(viewport: MprViewportId, point: Point3): void
  onProgress(progress: MprRuntimeProgress): void
  onReady(): void
}

export interface MprRuntime {
  activateTool(tool: MprTool): void
  destroy(): void
  reset(): void
  resize(): void
  setCrosshairsVisible(visible: boolean): void
}

interface VolumeLoadResult {
  framesLoaded?: number
  framesProcessed?: number
  totalNumFrames?: number
}

interface StreamingVolume {
  cancelLoading?(): void
  clearLoadCallbacks?(): void
  load(callback: (result: VolumeLoadResult) => void): void
}

interface VoiRange {
  lower: number
  upper: number
}

const VIEWPORTS = ['axial', 'coronal', 'sagittal'] as const
const RENDERING_ENGINE_PREFIX = 'mpr-rendering-'
const VIEWPORT_PREFIX = 'mpr-viewport-'
const TOOL_GROUP_PREFIX = 'mpr-tools-'
const VOLUME_PREFIX = 'cornerstoneStreamingImageVolume:mpr-'
const partialLoadMessage = '部分影像加载失败，无法完整构建三视图，请重试或返回轴位查看器'
const runtimeErrorMessage = '无法构建三视图，请重试或返回轴位查看器'
const runtimeErrorByStatus: Record<number, string> = {
  0: '无法连接本机服务，请确认服务已启动',
  404: '未找到该影像实例，请返回轴位查看器',
  409: '该序列暂不可查看，请返回轴位查看器',
  410: '本机 DICOM 文件缺失，请恢复文件后重试或返回轴位查看器',
  422: '影像请求无效，请返回轴位查看器',
  500: '本机影像服务异常，请重试或返回轴位查看器',
}
const registeredTools = new Set<string>()
let runtimeSequence = 0

const DEFAULT_ORIENTATIONS: Record<MprViewportId, MprViewportOrientation> = {
  axial: { top: 'A', right: 'L', bottom: 'P', left: 'R' },
  coronal: { top: 'S', right: 'L', bottom: 'I', left: 'R' },
  sagittal: { top: 'S', right: 'P', bottom: 'I', left: 'A' },
}

function abortError(): DOMException {
  return new DOMException('MPR runtime creation cancelled', 'AbortError')
}

function safeCall(action: () => void): void {
  try {
    action()
  } catch {
    // Resource cleanup is best-effort and must continue through later owners.
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
  return status === undefined
    ? runtimeErrorMessage
    : (runtimeErrorByStatus[status] ?? runtimeErrorByStatus[500])
}

function hasNonZeroSize(element: HTMLDivElement): boolean {
  return element.clientWidth > 0 && element.clientHeight > 0
}

function point3(value: unknown): Point3 | null {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((component) => typeof component === 'number' && Number.isFinite(component))
  ) {
    return null
  }
  return [value[0], value[1], value[2]]
}

function dot(left: Point3, right: Point3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: Point3, right: Point3): Point3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function intersectCameraPlanes(cameras: Array<{
  focalPoint?: unknown
  viewPlaneNormal?: unknown
}>): Point3 | null {
  if (cameras.length !== 3) {
    return null
  }
  const planes = cameras.map((camera) => ({
    normal: point3(camera.viewPlaneNormal),
    point: point3(camera.focalPoint),
  }))
  if (planes.some(({ normal, point }) => normal === null || point === null)) {
    return null
  }
  const [first, second, third] = planes as Array<{
    normal: Point3
    point: Point3
  }>
  const secondCrossThird = cross(second.normal, third.normal)
  const denominator = dot(first.normal, secondCrossThird)
  if (Math.abs(denominator) < 1e-8) {
    return null
  }
  const thirdCrossFirst = cross(third.normal, first.normal)
  const firstCrossSecond = cross(first.normal, second.normal)
  const distances = planes.map(({ normal, point }) => dot(normal!, point!))
  const coordinate = (component: 0 | 1 | 2) => {
    const value = (
      distances[0] * secondCrossThird[component] +
      distances[1] * thirdCrossFirst[component] +
      distances[2] * firstCrossSecond[component]
    ) / denominator
    return Object.is(value, -0) ? 0 : value
  }
  const intersection: Point3 = [coordinate(0), coordinate(1), coordinate(2)]
  return intersection.every(Number.isFinite) ? intersection : null
}

function voiRange(value: unknown): VoiRange | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('lower' in value) ||
    !('upper' in value) ||
    typeof value.lower !== 'number' ||
    typeof value.upper !== 'number' ||
    !Number.isFinite(value.lower) ||
    !Number.isFinite(value.upper)
  ) {
    return null
  }
  return { lower: value.lower, upper: value.upper }
}

export async function createMprRuntime(
  elements: MprRuntimeElements,
  imageIds: readonly string[],
  callbacks: MprRuntimeCallbacks,
  signal?: AbortSignal,
): Promise<MprRuntime> {
  const { core, tools } = await initializeCornerstone()
  if (signal?.aborted) {
    throw abortError()
  }
  if (imageIds.length === 0 || VIEWPORTS.some((id) => !hasNonZeroSize(elements[id]))) {
    throw new Error(runtimeErrorMessage)
  }

  runtimeSequence += 1
  const suffix = `${runtimeSequence}`
  const renderingEngineId = `${RENDERING_ENGINE_PREFIX}${suffix}`
  const volumeId = `${VOLUME_PREFIX}${suffix}`
  const toolGroupId = `${TOOL_GROUP_PREFIX}${suffix}`
  const viewportIds = Object.fromEntries(
    VIEWPORTS.map((id) => [id, `${VIEWPORT_PREFIX}${id}-${suffix}`]),
  ) as Record<MprViewportId, string>
  const renderingEngine = new core.RenderingEngine(renderingEngineId)
  let volume: StreamingVolume | null = null
  let toolGroupCreated = false
  let destroyed = false
  let cancelled = false
  let loadSettled = false
  let activeTool: MprTool = 'crosshairs'
  let crosshairsVisible = true
  let failureMessage: string | null = null
  let syncingVoi = false
  const elementListeners: Array<{
    capture?: boolean
    element: HTMLDivElement
    listener: EventListener
    type: string
  }> = []
  const runtimeEventListeners: Array<{
    listener: EventListener
    type: string
  }> = []

  function destroyRuntime(): void {
    if (destroyed) {
      return
    }
    destroyed = true
    signal?.removeEventListener('abort', cancelAndDestroy)
    for (const { capture, element, listener, type } of elementListeners) {
      safeCall(() => element.removeEventListener(type, listener, capture))
    }
    for (const { listener, type } of runtimeEventListeners) {
      safeCall(() => core.eventTarget.removeEventListener(type, listener))
    }
    safeCall(() => abortPendingDicomLoads(imageIds))
    safeCall(() => volume?.cancelLoading?.())
    safeCall(() => volume?.clearLoadCallbacks?.())
    if (toolGroupCreated) {
      safeCall(() => {
        const group = tools.ToolGroupManager.getToolGroup(toolGroupId)
        group?.setToolDisabled(tools.CrosshairsTool.toolName)
      })
      safeCall(() => tools.ToolGroupManager.destroyToolGroup(toolGroupId))
    }
    safeCall(() => renderingEngine.destroy())
    safeCall(() => {
      if (core.cache.getVolumeLoadObject(volumeId) !== undefined) {
        core.cache.removeVolumeLoadObject(volumeId)
      }
    })
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

  signal?.addEventListener('abort', cancelAndDestroy, { once: true })

  function reportRuntimeFailure(message: string): void {
    if (destroyed || failureMessage !== null) {
      return
    }
    failureMessage = message
    callbacks.onError(message)
  }

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
    const orientationByViewport = {
      axial: core.Enums.OrientationAxis.AXIAL,
      coronal: core.Enums.OrientationAxis.CORONAL,
      sagittal: core.Enums.OrientationAxis.SAGITTAL,
    }
    renderingEngine.setViewports(
      VIEWPORTS.map((id) => ({
        defaultOptions: { orientation: orientationByViewport[id] },
        element: elements[id],
        type: core.Enums.ViewportType.ORTHOGRAPHIC,
        viewportId: viewportIds[id],
      })),
    )
    for (const id of VIEWPORTS) {
      elements[id].tabIndex = 0
      const preserveTabNavigation: EventListener = (event) => {
        if (event instanceof KeyboardEvent && event.key === 'Tab') {
          event.stopImmediatePropagation()
        }
      }
      elements[id].addEventListener('keydown', preserveTabNavigation, true)
      elementListeners.push({
        capture: true,
        element: elements[id],
        listener: preserveTabNavigation,
        type: 'keydown',
      })
    }

    await Promise.all(
      imageIds.map((imageId) => core.imageLoader.loadImage(imageId)),
    )
    ensureActive()
    for (const imageId of imageIds) {
      if (core.cache.getImageLoadObject(imageId) !== undefined) {
        core.cache.removeImageLoadObject(imageId, { force: true })
      }
    }
    volume = await core.volumeLoader.createAndCacheVolume(volumeId, {
      imageIds: [...imageIds],
    }) as StreamingVolume
    ensureActive()
    await core.setVolumesForViewports(
      renderingEngine,
      [{ volumeId }],
      VIEWPORTS.map((id) => viewportIds[id]),
    )
    ensureActive()
    for (const id of VIEWPORTS) {
      renderingEngine.getViewport<{ resetCamera(): void }>(viewportIds[id]).resetCamera()
    }

    const toolClasses = [
      tools.CrosshairsTool,
      tools.WindowLevelTool,
      tools.PanTool,
      tools.ZoomTool,
      tools.StackScrollTool,
    ]
    for (const toolClass of toolClasses) {
      const globallyRegistered = typeof tools.store?.hasTool === 'function' &&
        tools.store.hasTool(toolClass.toolName)
      if (!globallyRegistered && !registeredTools.has(toolClass.toolName)) {
        tools.addTool(toolClass)
      }
      registeredTools.add(toolClass.toolName)
    }
    const createdToolGroup = tools.ToolGroupManager.createToolGroup(toolGroupId)
    if (createdToolGroup === undefined) {
      throw new Error(runtimeErrorMessage)
    }
    const toolGroup = createdToolGroup
    toolGroupCreated = true
    for (const toolClass of toolClasses) {
      toolGroup.addTool(toolClass.toolName)
    }
    for (const id of VIEWPORTS) {
      toolGroup.addViewport(viewportIds[id], renderingEngineId)
    }
    const toolNameByMprTool: Record<MprTool, string> = {
      crosshairs: tools.CrosshairsTool.toolName,
      pan: tools.PanTool.toolName,
      windowLevel: tools.WindowLevelTool.toolName,
      zoom: tools.ZoomTool.toolName,
    }
    const primaryTools = Object.entries(toolNameByMprTool) as Array<[MprTool, string]>

    function activatePrimaryTool(tool: MprTool): void {
      if (destroyed) {
        return
      }
      if (tool === 'crosshairs' && !crosshairsVisible) {
        toolGroup.setToolEnabled(tools.CrosshairsTool.toolName)
        crosshairsVisible = true
      }
      for (const [candidate, toolName] of primaryTools) {
        if (candidate === 'crosshairs' && candidate !== tool) {
          if (crosshairsVisible) {
            toolGroup.setToolEnabled(toolName)
          }
          continue
        }
        toolGroup.setToolPassive(toolName, { removeAllBindings: true })
      }
      toolGroup.setToolActive(toolNameByMprTool[tool], {
        bindings: [{ mouseButton: tools.Enums.MouseBindings.Primary }],
      })
      activeTool = tool
    }

    function setCrosshairsVisibility(visible: boolean): void {
      if (destroyed || visible === crosshairsVisible) {
        return
      }
      if (!visible) {
        if (activeTool === 'crosshairs') {
          activatePrimaryTool('windowLevel')
        }
        toolGroup.setToolDisabled(tools.CrosshairsTool.toolName)
        crosshairsVisible = false
        return
      }
      toolGroup.setToolEnabled(tools.CrosshairsTool.toolName)
      crosshairsVisible = true
    }

    toolGroup.setToolActive(tools.StackScrollTool.toolName, {
      bindings: [{ mouseButton: tools.Enums.MouseBindings.Wheel }],
    })
    activatePrimaryTool('crosshairs')
    const crosshairsTool = toolGroup.getToolInstance(
      tools.CrosshairsTool.toolName,
    ) as { resetCrosshairs?(): void } | undefined
    crosshairsTool?.resetCrosshairs?.()

    function emitLinkedPosition(): void {
      if (destroyed) {
        return
      }
      const cameras = VIEWPORTS.map((id) => renderingEngine.getViewport<{
        getCamera(): { focalPoint?: unknown; viewPlaneNormal?: unknown }
      }>(viewportIds[id]).getCamera())
      const position = intersectCameraPlanes(cameras)
      if (position === null) {
        return
      }
      for (const id of VIEWPORTS) {
        callbacks.onPosition(id, position)
      }
    }

    function syncVoiFrom(source: MprViewportId, event: Event): void {
      if (destroyed || syncingVoi) {
        return
      }
      const detail = (event as CustomEvent<{
        invert?: unknown
        invertStateChanged?: boolean
        range?: unknown
      }>).detail
      const range = voiRange(detail?.range)
      if (range === null) {
        return
      }
      const properties: { invert?: boolean; voiRange: VoiRange } = { voiRange: range }
      if (detail.invertStateChanged && typeof detail.invert === 'boolean') {
        properties.invert = detail.invert
      }
      syncingVoi = true
      try {
        for (const id of VIEWPORTS) {
          if (id === source) {
            continue
          }
          const viewport = renderingEngine.getViewport<{
            render(): void
            setProperties(
              properties: { invert?: boolean; voiRange: VoiRange },
              volumeId?: string,
              suppressEvents?: boolean,
            ): void
          }>(viewportIds[id])
          viewport.setProperties(properties, undefined, true)
          viewport.render()
        }
      } finally {
        syncingVoi = false
      }
    }

    for (const id of VIEWPORTS) {
      const activate = () => {
        if (!destroyed) {
          callbacks.onActiveViewport(id)
          emitLinkedPosition()
        }
      }
      const updatePosition = () => emitLinkedPosition()
      for (const type of ['pointerdown', 'focusin']) {
        elements[id].addEventListener(type, activate)
        elementListeners.push({ element: elements[id], listener: activate, type })
      }
      for (const type of [
        core.Enums.Events.CAMERA_MODIFIED,
        core.Enums.Events.VOLUME_NEW_IMAGE,
      ]) {
        elements[id].addEventListener(type, updatePosition)
        elementListeners.push({ element: elements[id], listener: updatePosition, type })
      }
      const syncVoi = (event: Event) => syncVoiFrom(id, event)
      elements[id].addEventListener(core.Enums.Events.VOI_MODIFIED, syncVoi)
      elementListeners.push({
        element: elements[id],
        listener: syncVoi,
        type: core.Enums.Events.VOI_MODIFIED,
      })
      callbacks.onOrientation?.(id, DEFAULT_ORIENTATIONS[id])
    }
    emitLinkedPosition()

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
      if (loaded === total) {
        callbacks.onReady()
      } else {
        callbacks.onError(partialLoadMessage)
      }
    })
    renderingEngine.render()

    function resetRuntime(): void {
      if (destroyed) {
        return
      }
      syncingVoi = true
      try {
        for (const id of VIEWPORTS) {
          renderingEngine.getViewport<{ resetProperties(): void }>(
            viewportIds[id],
          ).resetProperties()
        }
      } finally {
        syncingVoi = false
      }
      if (!crosshairsVisible) {
        toolGroup.setToolEnabled(tools.CrosshairsTool.toolName)
        crosshairsVisible = true
      }
      activatePrimaryTool('crosshairs')
      crosshairsTool?.resetCrosshairs?.()
      callbacks.onActiveViewport('axial')
      emitLinkedPosition()
    }

    return {
      activateTool: activatePrimaryTool,
      destroy: cancelAndDestroy,
      reset: resetRuntime,
      resize: () => renderingEngine.resize(),
      setCrosshairsVisible: setCrosshairsVisibility,
    }
  } catch (error) {
    const aborted = cancelled || signal?.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    const message = failureMessage ?? toSafeRuntimeError(error)
    destroyRuntime()
    if (aborted) {
      throw abortError()
    }
    if (failureMessage === null) {
      failureMessage = message
      callbacks.onError(message)
    }
    throw new Error(message)
  }
}
